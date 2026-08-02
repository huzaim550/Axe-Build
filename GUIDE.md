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
| `--type` | `apk`, `aab`, `update` | `apk` | `aab` is for Play Store upload; `apk` is for sideloading/testing; `update` is an OTA-only publish (see §5) |
| `--profile` | `release`, `debug` | `release` | debug builds are faster but larger/unoptimized |
| `--abi` | `arm64-v8a`, `arm64-v8a,armeabi-v7a`, `all` | `arm64-v8a` | see below — this is the biggest speed lever |
| `--ota` | flag | off | also export an OTA bundle alongside the APK, so this build can push JS updates later |
| `--release` | flag | off | promote the build to the update channels as soon as it succeeds |

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

## 5. Shipping updates to phones that already have the app

Two different mechanisms, because they cover different kinds of change:

| You changed | Use | How long | What the user does |
|---|---|---|---|
| JS / React components / images / config | **OTA update** | ~90 s | Nothing — app updates itself on next launch |
| Native code, a new native module, Expo SDK, `versionCode` | **New APK** | full build | Taps through an install prompt |

Nothing is served to phones until you **release** it, so a green build is never automatically live:

```bash
build-cli release <buildId>          # promote whatever that build produced
build-cli release <buildId> --undo   # roll back
```

### One-time setup for OTA

In your `app.json`:

```json
{
  "expo": {
    "version": "1.4.0",
    "runtimeVersion": { "policy": "appVersion" },
    "updates": {
      "url": "http://192.168.1.50:3000/api/updates/<your-slug>/manifest",
      "requestHeaders": { "expo-channel-name": "production" }
    }
  }
}
```

Then `npx expo install expo-updates`, and **build and install a fresh APK**:

```bash
build-cli build --type apk --ota --release
```

OTA can't bootstrap itself — the phone has to be running a binary that already knows the update URL.

### Publishing an OTA update

After that, a JS-only change ships without touching Gradle:

```bash
build-cli build --type update --release
```

Open the app twice: expo-updates downloads in the background on the first launch and applies on the second. That's standard expo-updates behaviour, not a quirk of this server.

### The runtimeVersion rule (the one that bites)

An update is only ever served to an app reporting the **exact same `runtimeVersion`**. With `"policy": "appVersion"` that's your `expo.version` string.

This is a safety feature: it stops a JS bundle from landing on a binary that lacks the native code it needs. The practical consequence is that **the moment you change anything native, bump `expo.version` and ship a new APK** — old phones keep getting the old bundle until they install it, which is what you want.

### The APK update channel

Once an APK build is released, this is always the current one:

```
GET http://<server-ip>:3000/api/apps/<slug>/latest
```

```json
{
  "versionName": "1.4.0",
  "versionCode": 41,
  "downloadUrl": "http://192.168.1.50:3000/api/apps/<slug>/latest/download",
  "sizeBytes": 61234567
}
```

To prompt users in-app, compare `versionCode` against the running build and open the URL:

```tsx
import * as Application from "expo-application";
import { Alert, Linking } from "react-native";

export async function checkForApkUpdate() {
  const res = await fetch("http://192.168.1.50:3000/api/apps/<slug>/latest");
  if (!res.ok) return;
  const latest = await res.json();
  const current = Number(Application.nativeBuildVersion ?? 0);
  if (latest.versionCode > current) {
    Alert.alert("Update available", `Version ${latest.versionName} is ready.`, [
      { text: "Later" },
      { text: "Install", onPress: () => Linking.openURL(latest.downloadUrl) },
    ]);
  }
}
```

Opening the URL hands off to Android's download manager, which offers to install it — deliberately avoiding the `REQUEST_INSTALL_PACKAGES` permission and custom native code. The user taps through "install unknown apps" once.

> These update endpoints are **unauthenticated** — an installed app can't carry your `LOCAL_TOKEN`, and baking the token into a published APK would be worse. They're read-only. Never port-forward 3000; if you need them reachable from outside your LAN, use the tunnel setup below instead.

### Reaching phones outside your home network

A LAN URL only works while the phone is on your wifi. To update apps anywhere, publish the
build server through a Cloudflare tunnel and point the app at the public hostname:

```bash
cloudflared tunnel create mybuild-updates
cloudflared tunnel route dns mybuild-updates updates.example.com
cp cloudflared.example.yml ~/.cloudflared/config.yml    # then edit it
cloudflared tunnel run mybuild-updates
```

In `cloudflared.example.yml`, point `service:` at wherever the web container listens — that is
`http://localhost:3000` if cloudflared runs on the Docker host, or `http://<server-lan-ip>:3000`
if it runs on another machine. A wrong address here surfaces as **502**; a 404 on everything
means no ingress rule matched the hostname.

Then set `PUBLIC_HOSTNAME=updates.example.com` in `docker-compose.yml` and `make up`. That is
what keeps the dashboard private: it embeds your `LOCAL_TOKEN` in its HTML, so exposing it would
hand build access to anyone who loads the page.

Verify the lockdown right after you set it up:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://updates.example.com/            # expect 404
curl -s -o /dev/null -w '%{http_code}\n' https://updates.example.com/api/builds  # expect 404
curl -s -o /dev/null -w '%{http_code}\n' https://updates.example.com/api/health  # expect 200

# Devices may read notifications through the tunnel, but never write one:
curl -s -o /dev/null -w '%{http_code}\n' \
  https://updates.example.com/api/notifications/<slug>          # expect 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://updates.example.com/api/notifications/<slug>          # expect 404
```

Switching to HTTPS also avoids a real trap: Expo release builds set `usesCleartextTraffic` to
false, so a plain `http://` update URL is silently blocked in production builds.

## 6. Sending a notification to installed apps

Open `http://<server-ip>:3000/notifications`, pick the app, type a title and a message, press
**Send**. That is the whole flow — no build, no release, no OTA.

Apps **pull** these: the app asks `GET /api/notifications/<slug>` when it starts and when it
comes back to the foreground (rate-limited to one request every five minutes), and shows what
comes back in its own inbox. Consequences worth knowing before you use it:

- A **closed app shows nothing** until someone opens it. This is not a tray notification; making
  it one would need Firebase, a device token, a native module and a new APK for every user.
- **Retract** stops a message being served to apps that have not fetched it yet. Anyone whose app
  already downloaded it keeps their copy — nothing can reach into a phone and delete it.
- **Expiry** is the cleaner tool for anything time-bound ("maintenance tonight at 9"): set it and
  the message stops showing itself.
- The **channel** field must match the channel the app is on (`production` unless you changed it),
  otherwise nobody sees it.
- Apps only ever see the newest 50 live messages. Older ones stay in the database and on the
  dashboard.

Same thing from a shell:

```bash
curl -X POST http://<server-ip>:3000/api/notifications/<slug> \
  -H "authorization: Bearer $LOCAL_TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Maintenance tonight","body":"The server restarts at 21:00.","level":"warning"}'
```

A `linkUrl` must be `http(s)` — both the server and the app refuse anything else, because the app
hands that URL to the system browser.

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
