# Expo_Build_Tool_Local

A local, open-source mini-clone of Expo Application Services (EAS):

- **Android only.** iOS is out of scope (needs macOS/Xcode).
- **Home network only.** Single server, single user, one hardcoded token. The dashboard listens on port 3000 for your LAN — never port-forward it on your router. (Set `BIND_ADDR=127.0.0.1` to restrict it to the server machine itself.)
- **Fully containerized.** The host needs **only Docker** (or Podman). Android SDK, JDK 17, Node, Gradle — all live inside containers and named volumes, never on the host. `docker compose down -v` leaves the machine exactly as it was.

You run a small CLI inside an Expo project; it uploads the source (no `node_modules`) to the server; a worker container runs `npm ci` → `expo prebuild` → Gradle and gives you a downloadable APK/AAB.

```
CLI ─┐
     ├─► Next.js API (web) ─► Redis + BullMQ ─► Worker container
Web ─┘        │                                (Android SDK + JDK17 + Gradle,
              │                                 builds in ephemeral workspace)
           SQLite                                     │
        (db-data vol)                     artifacts vol (APK/AAB + logs)
```

## Machine safety

- No Docker-in-Docker, no `privileged`, no docker socket mounts.
- Worker is hard-capped at **9 GB RAM / 3 CPUs** (`docker-compose.yml`) and Gradle's JVM at 4 GB, so a runaway build cannot freeze the host.
- Every build runs in a fresh workspace directory that is **always deleted afterwards**, success or failure.
- All mutable state is in named volumes: `redis-data`, `db-data`, `uploads`, `artifacts`, `workspaces`, `android-sdk`, `gradle-cache`, `npm-cache`, `ccache`.

## The Android SDK lives on a volume, not in the image

The worker image ships Node + JDK 17 only. The Android SDK/NDK is downloaded **once**, by `apps/worker/entrypoint.sh`, into the `android-sdk` volume. The first `make up` therefore takes several minutes with the worker logging `==> Installing Android SDK packages`; every start after that is instant, and rebuilding the image never re-downloads it.

Change the package set with `ANDROID_SDK_PACKAGES` in `docker-compose.yml` — `sdkmanager` is idempotent, so the next start pulls only what's missing. `make nuke` keeps this volume on purpose; `make nuke-sdk` drops it.

## Requirements (server machine)

- Docker Engine + Compose plugin, **or** Podman with a compose provider (`make up DOCKER=podman`).
- ~15 GB free disk for the Android SDK + NDK volume plus caches. 8 GB+ RAM recommended for release builds.

## Run the server

```bash
# optional: set your own token (defaults to dev-local-token)
export LOCAL_TOKEN=$(openssl rand -hex 16)

make up          # builds images + starts redis, web, worker
make logs        # follow logs — the FIRST start downloads the Android SDK/NDK
                 # into the android-sdk volume (several minutes, one time only)
```

Dashboard: `http://<server-ip>:3000` from any machine at home (or <http://localhost:3000> on the server itself).

## Use the CLI (on the machine where your Expo project lives)

The CLI needs Node 20+. Build it once:

```bash
cd packages/cli
npm install && npm run build
npm link            # makes `build-cli` available globally (or use node dist/index.js)
```

Then, inside any Expo project:

```bash
build-cli login http://<server-ip>:3000 --token dev-local-token
build-cli init                          # creates the project, writes mybuild.json
build-cli build --type apk --profile release
```

The CLI tars only your source (excludes `node_modules`, `.git`, `android/`, `ios/`, `.expo`), uploads it, and polls until the build finishes. The first build downloads all npm + Gradle dependencies and takes a long time (20–40 min on modest hardware); later builds reuse the `gradle-cache`/`npm-cache` volumes and are much faster.

Output types: `--type apk|aab`, `--profile release|debug`, `--abi arm64-v8a|all`. Phase 0 builds are **unsigned-release/debug-keystore** APKs — fine for sideloading and testing. Keystore signing is Phase 2.

### Build speed

Builds target only `arm64-v8a` by default and skip Android lint, and the worker uses `ccache` so
repeat native compilation is nearly free. A first build of a project takes ~20–30 min; later builds
of the same project land around 8–15 min. Pass `--abi all` when you need an APK that also runs on
x86 emulators or 32-bit phones, at the cost of a much longer build.

## Updates

Installed apps can be updated two ways: an **OTA update** (JS/assets only, self-hosted
[expo-updates](https://docs.expo.dev/technical-specs/expo-updates-1/), ~90 s and no Gradle at all) or a
new **APK** via a stable "latest" endpoint. Builds are never live until you promote them with
`build-cli release <buildId>`. Full walkthrough in [GUIDE.md](GUIDE.md#5-shipping-updates-to-phones-that-already-have-the-app).

### Publishing updates to the internet

To reach phones that are not on your LAN, publish this server through a tunnel
(`cloudflared.example.yml` is a working Cloudflare Tunnel config).

> **The dashboard must never be exposed.** It renders `LOCAL_TOKEN` into its HTML so download
> links work — anyone who loads `/` on a public hostname could read that token and queue
> arbitrary builds on this machine.

Two independent layers prevent that; use both:

1. **`PUBLIC_HOSTNAME`** (docker-compose.yml). Set it to the public name, e.g.
   `updates.example.com`. `apps/web/src/middleware.ts` then serves only the four read-only
   update endpoints on that hostname and 404s everything else. Requests on LAN addresses are
   unaffected, so the dashboard keeps working at `http://<server-ip>:3000`.
2. **Tunnel ingress `path` rules**, so non-public paths are refused before they reach the app.

Neither layer is a substitute for the other: one is config you could forget to apply, the other
lives in a file you could overwrite.

## API (token required unless marked public)

| Route | What |
|---|---|
| `POST /api/projects` | `{ name }` → `{ id, slug }` |
| `GET /api/projects` | list projects |
| `POST /api/builds` | multipart: `projectSlug`, `buildType`, `profile`, `abi`, `ota`, file `tarball` → `{ buildId }` |
| `GET /api/builds/:id` | build status + metadata |
| `GET /api/builds/:id/artifact` | download APK/AAB (also accepts `?token=`) |
| `POST /api/builds/:id/release` | `{ apk?, update? }` — promote/retire a build |
| `GET /api/updates/:slug/manifest` | **public** — Expo Updates protocol v1 manifest |
| `GET /api/updates/:slug/assets` | **public** — one file from a released update bundle |
| `GET /api/apps/:slug/latest` | **public** — current released APK version + download URL |
| `GET /api/apps/:slug/latest/download` | **public** — that APK |
| `GET /api/health` | **public** — liveness |

The four update routes are unauthenticated because an app installed on a phone cannot carry
`LOCAL_TOKEN`, and embedding it in a published APK would be worse. They are read-only; everything
that changes state still needs the token. One more reason not to port-forward 3000.

## Housekeeping

```bash
make down          # stop containers, keep volumes (builds/caches survive)
make clean-cache   # wipe ONLY gradle+npm caches when disk gets tight
make nuke          # containers + images + state volumes gone, SDK volume kept
make nuke-sdk      # same, but drop the Android SDK too → host fully pristine
```

`make nuke` deliberately keeps the `android-sdk` volume so the next `make up` doesn't re-download several GB over your home connection. `make nuke-sdk` is the true full teardown: nothing remains on the machine except this source tree.

## Repo layout

```
docker-compose.yml     redis + web + worker, named volumes, resource limits
Makefile               up / down / logs / nuke / nuke-sdk / clean-cache
scripts/nuke.sh        full teardown (keeps android-sdk unless --sdk)
apps/web/              Next.js dashboard + API routes (+ Dockerfile)
apps/worker/           BullMQ consumer + Android build runner (+ Dockerfile,
                       entrypoint.sh bootstraps the SDK volume)
packages/db/           Prisma schema + shared client (SQLite on db-data volume)
packages/cli/          build-cli (login / init / build)
```

## Notes

- No `pnpm-lock.yaml` is committed yet; images run `pnpm install` against the version ranges in the package manifests. After your first successful image build you can generate and commit a lockfile for reproducibility.
- Concurrency is fixed at 1 build at a time on purpose.
- Live log streaming (SSE) and a per-build log console + progress bar are in — click "view" next to any build on the dashboard. Cancel button and Phase 2 (signing) are not built yet; the worker still writes the full build log to the `artifacts` volume (`build.log` next to each artifact) regardless.
