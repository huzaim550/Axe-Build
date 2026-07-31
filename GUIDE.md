# Using mybuild — day-to-day guide

This assumes your server is already up (`docker compose up -d --build` / `make up` has run
and the worker image finished building). This guide is just: how do I turn an Expo project
into an APK from here on out.

## 0. One-time: install the CLI (on your dev machine)

You need Node 20+ on whatever machine you write your Expo app on (NOT the server — that
already has everything it needs inside its containers).

```bash
cd android_app_builder/packages/cli
npm install
npm run build
npm link            # gives you the global `build-cli` command
```

Check it worked:

```bash
build-cli --help
```

(If you don't want a global link, you can always run it as `node /path/to/android_app_builder/packages/cli/dist/index.js ...` instead of `build-cli`.)

## 1. One-time: point the CLI at your server

```bash
build-cli login http://<server-ip>:3000 --token <LOCAL_TOKEN>
```

- `<server-ip>` — your home server's LAN IP (e.g. `192.168.1.50`). Use `localhost` only if you're running the CLI on the server itself.
- `<LOCAL_TOKEN>` — whatever you set for `LOCAL_TOKEN` when you started the server (defaults to `dev-local-token` if you didn't set one).

This writes `~/.mybuild/config.json`. You only do this once per dev machine — every project reuses it.

## 2. Per-project: link it to the server

```bash
cd /path/to/your-expo-app     # the folder with package.json, App.tsx, app.json
build-cli init
```

This creates a project on the server and writes a small `mybuild.json` file into your project root recording its slug. Commit it or gitignore it, your call — it has no secrets in it.

If you already created the project before (e.g. from another machine) and just want to link to it instead of making a duplicate:

```bash
build-cli init --slug your-existing-project-slug
```

## 3. Build an APK

From inside the project folder:

```bash
build-cli build --type apk --profile release
```

What you'll see:

```
Packing project (source only — no node_modules)...
Tarball: 4.2 MB
Build queued: cly3x9k...
Dashboard: http://192.168.1.50:3000
[0s] status: queued
[2s] status: running
[612s] status: success

Build succeeded! Download your artifact:
  http://192.168.1.50:3000/api/builds/cly3x9k.../artifact?token=...
```

Just open that URL in a browser (or `curl -OJ ...` it) to get the `.apk` file. You can also watch it from the dashboard at `http://<server-ip>:3000` while it runs.

Options:

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--type` | `apk`, `aab` | `apk` | `aab` is for Play Store upload; `apk` is for sideloading/testing |
| `--profile` | `release`, `debug` | `release` | debug builds are faster but larger/unoptimized |
| `--abi` | `arm64-v8a`, `arm64-v8a,armeabi-v7a`, `all` | `arm64-v8a` | see below — this is the biggest speed lever |

### About `--abi`

Every extra CPU architecture means compiling the app's entire C++ module graph again, so the
default builds only `arm64-v8a` — the architecture essentially every Android phone from ~2019
onward uses. That alone cuts native compilation to roughly a quarter.

Use `--abi all` when you need a universal APK, specifically:

- running on an **x86/x86_64 Android emulator**, or
- installing on a **very old 32-bit-only phone**.

Those builds take considerably longer.

## 4. Install the APK on your phone

Copy the downloaded `.apk` to your Android phone (USB, or just download the link directly
in the phone's browser since it's on your home network) and tap it to install. You'll need
"install from unknown sources" allowed for whichever app you use to open it — this is a
Phase 0 **unsigned** build, so Android will flag it as such; that's expected until keystore
signing (Phase 2) is added.

## Timing expectations

- **First build ever** for a project: ~20–30 min. It downloads every npm and Maven dependency
  over your home connection and compiles all native code from scratch, with nothing cached.
- **Every build after that**: roughly **8–15 min**. Three separate caches make this happen and
  they all persist on the server between builds:
  - `npm-cache` — dependencies aren't re-downloaded
  - `gradle-cache` — Maven artifacts plus Gradle's build cache for Kotlin/Java tasks
  - `ccache` — compiled C++ is reused, so native modules barely rebuild at all
- Only **one build runs at a time** by design (the hardware can't handle more) — if you
  queue a second build while one is running, it just waits.
- The build is capped at **2 hours** before being killed as stuck.

If a build ever feels inexplicably slow, check whether the caches were recently wiped
(`make clean-cache` empties all three, making the next build behave like a first build).

## If something goes wrong

- Check the dashboard (`http://<server-ip>:3000`) — failed builds show a status of `failed`
  and a short error message.
- The full build log is kept on the server even after failure (in the `artifacts` volume) —
  ask whoever manages the server to pull `build.log` for that build ID if the short error
  isn't enough.
- Common causes: your project's `app.json` is missing `expo.android.package`, or a native
  module needs a config plugin not present in a bare `npx expo prebuild`.

## Freeing up server disk (if it gets tight)

This is a server-admin action, not something the CLI does:

```bash
make clean-cache     # wipes only the npm/gradle caches — build history and APKs untouched
```

## Full reset (server-admin only)

```bash
make nuke            # removes containers, ALL volumes (including every past build), and images
```
