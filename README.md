# Expo_Build_Tool_Local

A local, open-source mini-clone of Expo Application Services (EAS):

- **Android only.** iOS is out of scope (needs macOS/Xcode).
- **Home network only.** Single server, single user, one hardcoded token. The dashboard listens on port 3000 for your LAN — never port-forward it on your router. (Set `BIND_ADDR=127.0.0.1` to restrict it to the server machine itself.)
- **Fully containerized.** The host needs **only Docker** (or Podman). Android SDK, JDK 17, Node, Gradle — all live inside images. All state lives in named volumes. `docker compose down -v` leaves the machine exactly as it was.

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
- Worker is hard-capped at **8 GB RAM / 3 CPUs** (`docker-compose.yml`) and Gradle's JVM at 3 GB, so a runaway build cannot freeze the host.
- Every build runs in a fresh workspace directory that is **always deleted afterwards**, success or failure.
- All mutable state is in named volumes: `redis-data`, `db-data`, `uploads`, `artifacts`, `workspaces`, `gradle-cache`, `npm-cache`.

## Requirements (server machine)

- Docker Engine + Compose plugin, **or** Podman with a compose provider (`make up DOCKER=podman`).
- ~15 GB free disk for the worker image (Android SDK + NDK) plus caches. 8 GB+ RAM recommended for release builds.

## Run the server

```bash
# optional: set your own token (defaults to dev-local-token)
export LOCAL_TOKEN=$(openssl rand -hex 16)

make up          # builds images + starts redis, web, worker
                 # first build takes a while: it downloads the Android SDK/NDK
make logs        # follow logs
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

Output types: `--type apk|aab`, `--profile release|debug`. Phase 0 builds are **unsigned-release/debug-keystore** APKs — fine for sideloading and testing. Keystore signing is Phase 2.

## API (all requests need `Authorization: Bearer $LOCAL_TOKEN`)

| Route | What |
|---|---|
| `POST /api/projects` | `{ name }` → `{ id, slug }` |
| `GET /api/projects` | list projects |
| `POST /api/builds` | multipart: `projectSlug`, `buildType`, `profile`, file `tarball` → `{ buildId }` |
| `GET /api/builds/:id` | build status + metadata |
| `GET /api/builds/:id/artifact` | download APK/AAB (also accepts `?token=`) |
| `GET /api/health` | liveness (no auth) |

## Housekeeping

```bash
make down          # stop containers, keep volumes (builds/caches survive)
make clean-cache   # wipe ONLY gradle+npm caches when disk gets tight
make nuke          # containers + ALL volumes + images gone → host pristine
```

`make nuke` (or `docker compose down -v --remove-orphans` + removing the two images) is the full teardown: nothing remains on the machine except this source tree.

## Repo layout

```
docker-compose.yml     redis + web + worker, named volumes, resource limits
Makefile               up / down / logs / nuke / clean-cache
scripts/nuke.sh        full teardown
apps/web/              Next.js dashboard + API routes (+ Dockerfile)
apps/worker/           BullMQ consumer + Android build runner (+ heavy Dockerfile)
packages/db/           Prisma schema + shared client (SQLite on db-data volume)
packages/cli/          build-cli (login / init / build)
```

## Notes

- No `pnpm-lock.yaml` is committed yet; images run `pnpm install` against the version ranges in the package manifests. After your first successful image build you can generate and commit a lockfile for reproducibility.
- Concurrency is fixed at 1 build at a time on purpose.
- Live log streaming (SSE) and a per-build log console + progress bar are in — click "view" next to any build on the dashboard. Cancel button and Phase 2 (signing) are not built yet; the worker still writes the full build log to the `artifacts` volume (`build.log` next to each artifact) regardless.
