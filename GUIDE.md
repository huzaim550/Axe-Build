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

## 4. Install the APK on your phone

Copy the downloaded `.apk` to your Android phone (USB, or just download the link directly
in the phone's browser since it's on your home network) and tap it to install. You'll need
"install from unknown sources" allowed for whichever app you use to open it — this is a
Phase 0 **unsigned** build, so Android will flag it as such; that's expected until keystore
signing (Phase 2) is added.

## Timing expectations

- **First build ever** for a project: slow (10–30+ min) — it's doing a full `npm ci` and a
  cold Gradle build with nothing cached yet.
- **Every build after that**: much faster, because `gradle-cache` and `npm-cache` persist
  on the server between builds.
- Only **one build runs at a time** by design (the hardware can't handle more) — if you
  queue a second build while one is running, it just waits.

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
