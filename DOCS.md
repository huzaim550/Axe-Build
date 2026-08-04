# Axe Build — complete documentation

A self-hosted alternative to Expo's cloud build service (EAS Build). You run it on your own
machine; it turns an Expo project into an Android APK, ships over-the-air updates to phones that
already have your app, and sends those phones in-app notifications.

This document assumes **no prior knowledge** of build servers. If you can run `docker compose up`
and you have an Expo app, you can follow it start to finish.

---

## Contents

1. [What it does, and what it doesn't](#1-what-it-does-and-what-it-doesnt)
2. [How it works](#2-how-it-works)
3. [Requirements](#3-requirements)
4. [Set up the server](#4-set-up-the-server)
5. [Install the CLI](#5-install-the-cli)
6. [Add your first app](#6-add-your-first-app)
7. [Build an APK](#7-build-an-apk)
8. [Install it on a phone](#8-install-it-on-a-phone)
9. [Release: what "live" means](#9-release-what-live-means)
10. [Over-the-air updates](#10-over-the-air-updates)
11. [Telling users a new APK exists](#11-telling-users-a-new-apk-exists)
12. [In-app notifications](#12-in-app-notifications)
13. [Deleting builds and freeing disk](#13-deleting-builds-and-freeing-disk)
14. [Reaching phones outside your network](#14-reaching-phones-outside-your-network)
15. [CLI reference](#15-cli-reference)
16. [HTTP API reference](#16-http-api-reference)
17. [Configuration reference](#17-configuration-reference)
18. [Maintenance and backups](#18-maintenance-and-backups)
19. [Troubleshooting](#19-troubleshooting)
20. [Glossary](#20-glossary)

---

## 1. What it does, and what it doesn't

**It does:**

- Build Android **APK** and **AAB** files from an Expo project, on hardware you own.
- Publish **OTA updates** (JavaScript, assets, config) that installed apps download themselves.
- Serve a **"latest APK" endpoint** so your app can tell users a new version exists.
- Send **in-app notifications** that your app fetches and displays.
- Show all of it on a dashboard with live build logs.

**It does not:**

- Build for **iOS**. That needs macOS and Xcode; it is out of scope.
- Sign with a **production keystore** yet. Builds are signed with the standard Android debug
  keystore — perfect for sideloading and for updating your own installs, not accepted by the
  Play Store. (Keystore support is planned; see `Keystore` in `packages/db/prisma/schema.prisma`.)
- Run **more than one build at a time**. The queue is deliberately serial; consumer hardware
  cannot do two Gradle builds at once without swapping itself to death.
- Provide **user accounts**. There is one server, one token, one person: you.

---

## 2. How it works

### The pieces

```
your laptop                            your server (Docker)
┌──────────────┐                ┌──────────────────────────────────────┐
│ Expo project │   axe build    │  web        Next.js dashboard + API  │
│  + axe CLI   │ ─────────────► │   │         (port 3000)              │
└──────────────┘   source.tgz   │   ▼                                  │
                                │  redis      job queue (BullMQ)       │
       phone                    │   │                                  │
┌──────────────┐                │   ▼                                  │
│ your app     │ ◄───────────── │  worker     Android SDK + JDK + Gradle│
│              │  APK / OTA /   │             one build at a time      │
└──────────────┘  notifications └──────────────────────────────────────┘
                                     SQLite (build history)
                                     volumes (artifacts, caches, SDK)
```

- **web** — the dashboard you look at, and every API endpoint. Owns the database.
- **redis** — the queue. A build you submit is a job; the worker takes one at a time.
- **worker** — the machine that actually compiles. Has the Android SDK, NDK, JDK and Gradle
  inside it, none of which are ever installed on your host.

### What happens during a build

1. The CLI tars **your source only** — no `node_modules`, no `android/`, no `ios/`, no `.git`.
   (This is the same trick EAS uses. Uploading `node_modules` would be gigabytes of the wrong
   thing.)
2. The web API stores the tarball, writes a `queued` build row, and pushes a job to Redis.
3. The worker picks it up and, in a throwaway workspace directory:
   - extracts the tarball
   - runs `npm ci` (or `npm install` if there is no lockfile)
   - reads your app config to learn `version`, `versionCode`, `runtimeVersion`, `package`
   - if asked, exports the OTA bundle (`expo export`)
   - runs `expo prebuild` to generate the native `android/` project
   - runs Gradle (`assembleRelease` and friends)
4. Every log line is streamed to Redis, so the dashboard shows it live, and appended to a log
   file, so it is still there tomorrow.
5. On success the APK/AAB and the OTA bundle are copied to the artifacts volume; the workspace is
   deleted **whether the build succeeded or failed**.

A build is `queued` → `running` → `success` | `failed` | `canceled`. Nothing reaches a phone at
any point in this — that only happens when you **release** it (section 9).

### Where things are kept

All state lives in Docker named volumes, never on your host filesystem:

| Volume | Holds | Lose it and… |
|---|---|---|
| `db-data` | SQLite database: projects, builds, notifications | you lose build history and release state |
| `artifacts` | APKs/AABs, build logs, OTA bundles | installed apps stop finding updates |
| `uploads` | uploaded source tarballs | nothing important; they are per-build |
| `android-sdk` | Android SDK + NDK (several GB) | next start re-downloads it (slow) |
| `gradle-cache`, `npm-cache`, `ccache` | build caches | next build is slow again |
| `workspaces` | in-progress build directories | nothing; always cleaned up |
| `redis-data` | the queue | nothing important |

---

## 3. Requirements

### Server machine (where builds run)

| | Minimum | Comfortable |
|---|---|---|
| OS | Anything running Docker (Linux recommended) | Linux |
| RAM | 8 GB | 16 GB |
| CPU | 4 cores | 4+ cores |
| Disk | 25 GB free | 50 GB free |

- **Docker Engine + Compose plugin**, or **Podman** with a compose provider
  (`make up DOCKER=podman` works).
- Nothing else. No Java, no Android SDK, no Node on the host — it is all inside containers.

Disk breakdown: ~10 GB Android SDK + NDK, ~5–10 GB Gradle/npm/ccache caches once warm, plus
~60 MB per APK you keep. The worker is capped at **9 GB RAM and 3 CPUs** in `docker-compose.yml`
so a runaway Gradle can never freeze the host — lower it if your machine is smaller.

### Development machine (where you write the app)

- **Node 20+** (for the `axe` CLI).
- An **Expo project** (SDK 50+ recommended; anything `expo prebuild` can handle).
- Network access to the server (same LAN, VPN, or a tunnel).

It can be the same machine as the server. It usually isn't.

### Phone

- Android 6+ for sideloading, with "install unknown apps" allowed for your browser or file manager.
- For OTA updates, your app needs `expo-updates` (section 10).

---

## 4. Set up the server

### 4.1 Get the code

```bash
git clone <your-fork-url> axebuild
cd axebuild
```

### 4.2 Choose a token

Every write operation needs a token. The default is `dev-local-token`, which is fine on a laptop
and not fine on a machine other people can reach.

```bash
# Create .env in the repo root:
echo "LOCAL_TOKEN=$(openssl rand -hex 16)" > .env
cat .env      # keep this — the CLI needs it
```

### 4.3 Start it

```bash
make up          # builds the images and starts redis, web, worker
make logs        # follow along
```

**The first start is slow.** The worker downloads the Android SDK and NDK (several GB) into the
`android-sdk` volume, logging `==> Installing Android SDK packages`. This happens once, ever —
not once per build, and not again when you rebuild the images.

### 4.4 Check it

```bash
curl http://localhost:3000/api/health      # {"ok":true}
```

Open the dashboard at **`http://<server-ip>:3000`** from any machine on your network. You should
see the Axe Build header and an empty projects list. The dashboard is organised the way Expo is:
the home page lists **projects**, and a project's builds and its live release live inside it at
`/projects/<slug>`.

> **Never port-forward port 3000 on your router.** The dashboard embeds your token in its HTML so
> download links work. Section 14 covers the supported way to reach the server from outside.

### 4.5 Useful server commands

```bash
make ps           # what is running
make logs         # follow all logs
make down         # stop containers, keep all data
make up           # start again (also picks up code changes)
```

---

## 5. Install the CLI

On your **development** machine (not the server), with Node 20+:

```bash
cd axebuild/packages/cli
npm install
npm run build
npm link          # gives you a global `axe` command
```

Check it:

```bash
axe --help
```

If you would rather not link globally, every command below also works as
`node /path/to/axebuild/packages/cli/dist/index.js <command>`.

Now point it at your server — **once per development machine**:

```bash
axe login http://192.168.1.50:3000 --token <your LOCAL_TOKEN>
```

- Use your server's LAN IP, not `localhost`, unless the CLI runs on the server itself.
- This writes `~/.axebuild/config.json`. Every project on this machine reuses it.

---

## 6. Add your first app

A **project** on the server is just a name and a **slug** (a URL-safe id like
`my-cool-app`). Builds, releases and notifications all hang off it.

### 6.1 Create it

From inside your Expo project folder — the one with `package.json` and `app.json`:

```bash
cd ~/code/my-cool-app
axe init
```

```
Created project 'my-cool-app' (slug: my-cool-app). Wrote axe.json.
```

That wrote **`axe.json`** into your project:

```json
{
  "projectSlug": "my-cool-app"
}
```

That file is how the CLI knows which project to build. It contains no secrets — commit it or
gitignore it, your call. The CLI never uploads it.

Give the project a different display name with `axe init --name "My Cool App"`.

### 6.2 Add more apps

There is nothing else to it: go to the next project's folder and run `axe init` again. Each app
gets its own slug, its own build history, its own release state and its own notifications. One
server happily holds as many as you like.

```bash
cd ~/code/another-app && axe init
cd ~/code/third-app   && axe init
```

### 6.3 Link an app you already created

Building the same app from a second machine (or after re-cloning)? Don't run plain `axe init`,
which would create a *duplicate* project. Link to the existing slug instead:

```bash
axe init --slug my-cool-app
```

You can see every slug on the dashboard, or with:

```bash
curl -H "authorization: Bearer $LOCAL_TOKEN" http://192.168.1.50:3000/api/projects
```

If a duplicate already slipped through — you'll see it on the projects page as a second row with
the same name, an `empty` pill and a suffixed slug like `my-cool-app-w1ch` — press **Delete** on
it. That button only appears on projects with no builds and no notifications, and the API refuses
anything else, so it can't take a real app's history with it.

### 6.4 One thing to check in your app config

`expo prebuild` runs non-interactively on the worker, so set an Android package id yourself
rather than letting it guess:

```json
{
  "expo": {
    "name": "My Cool App",
    "version": "1.0.0",
    "android": {
      "package": "com.example.mycoolapp",
      "versionCode": 1
    }
  }
}
```

- **`package`** — never change it after you ship. Android treats a different package id as a
  completely different app, so every existing install would be orphaned.
- **`versionCode`** — an integer you increase for every APK you release. If you leave it out,
  prebuild hardcodes `1`, and the "new version available" check in section 11 can never fire.

The CLI warns you if `expo.android.package` is missing.

---

## 7. Build an APK

```bash
cd ~/code/my-cool-app
axe build --type apk --profile release
```

What you will see:

```
Packing project (source only — no node_modules)...
Tarball: 2.4 MB
Build queued: cmsc7msul000fijlf
Dashboard: http://192.168.1.50:3000
[2s] status: running
[812s] status: success

Build succeeded! Download your artifact:
  http://192.168.1.50:3000/api/builds/cmsc7msul000fijlf/artifact?token=...

Not live yet. Promote it with:  axe release cmsc7msul000fijlf
```

The CLI blocks until the build finishes and exits non-zero if it fails, so it works in a script.
Meanwhile the dashboard shows the same build with a live log and a progress bar; you can close the
terminal and the build carries on.

### Options

| Flag | Values | Default | What it means |
|---|---|---|---|
| `--type` | `apk`, `aab`, `update` | `apk` | `aab` is for the Play Store; `update` is OTA-only and skips Gradle entirely (~90 s) |
| `--profile` | `release`, `debug` | `release` | `debug` is bigger and slower but keeps dev tooling |
| `--abi` | `arm64-v8a`, `arm64-v8a,armeabi-v7a`, `all` | `arm64-v8a` | CPU architectures to compile. Each extra one recompiles the whole native graph |
| `--ota` | flag | off | also export an OTA bundle alongside the APK (needed for the first OTA-capable build) |
| `--release` | flag | off | promote it automatically if it succeeds |

`arm64-v8a` covers essentially every Android phone made in the last several years. Use `--abi all`
only when you need x86 emulators or 32-bit devices, and expect a much longer build.

### How long it takes

- **First build of a project: 20–30 minutes.** Every npm and Maven dependency is downloaded over
  your connection, and all native C++ compiles from scratch.
- **Every build after that: 8–15 minutes**, thanks to three persistent caches (`npm-cache`,
  `gradle-cache`, `ccache`).
- **OTA-only builds (`--type update`): about 90 seconds.** No Gradle at all.

A build is killed after 2 hours (`BUILD_TIMEOUT_MS`). Only one runs at a time; extra builds wait
in the queue.

### Getting the file

Three ways, all equivalent:

- the **APK** button on the dashboard row, or **Download artifact** on the build page
- the URL the CLI printed
- `curl -OJ -H "Authorization: Bearer $LOCAL_TOKEN" http://<server>:3000/api/builds/<id>/artifact`

---

## 8. Install it on a phone

Because the server is on your network, the simplest route is to open the download URL **in the
phone's browser** and tap the downloaded file.

1. Open `http://<server-ip>:3000` on the phone.
2. Tap **APK** on the build you want.
3. Tap the downloaded file; Android asks you to allow "install unknown apps" for your browser the
   first time.
4. Android will warn that the app is not from the Play Store. That is expected — these builds are
   signed with the standard Android debug keystore.

Installing a newer build **over** an older one works, as long as both came from here. Going the
other way (installing an older `versionCode` over a newer one) does not; uninstall first.

---

## 9. Release: what "live" means

A successful build sits there doing nothing until you **release** it. That is deliberate: a green
build is not automatically something you want thousands of phones to install.

Releasing sets one or both of two switches:

| Switch | Endpoint it feeds | Who consumes it |
|---|---|---|
| **APK** | `/api/apps/<slug>/latest` | your in-app "new version available" check (section 11) |
| **OTA** | `/api/updates/<slug>/manifest` | `expo-updates` inside your installed app (section 10) |

They are separate switches, because one build can carry both, and promoting a later OTA-only build
must not silently retire the APK that phones download.

From the dashboard: open the build, press **Release**. From the CLI:

```bash
axe release <buildId>          # release whatever this build produced
axe release <buildId> --apk    # only the APK channel
axe release <buildId> --ota    # only the OTA channel
axe release <buildId> --undo   # retire it from both — nothing is served from it
```

Exactly one build per channel is live at a time. Releasing a new one automatically retires the
previous one (for OTA, only within the same `runtimeVersion` — see section 10).

---

## 10. Over-the-air updates

Two mechanisms exist because they cover genuinely different changes:

| You changed | Ship it as | Takes | User does |
|---|---|---|---|
| JS, React components, images, most config | **OTA update** | ~90 s | nothing — the app updates itself |
| Native code, a new native module, Expo SDK, `versionCode`, permissions | **new APK** | full build | taps through an install prompt |

### 10.1 One-time setup in your app

Add this to `app.json` (or `app.config.ts`):

```json
{
  "expo": {
    "version": "1.0.0",
    "runtimeVersion": { "policy": "appVersion" },
    "updates": {
      "url": "http://192.168.1.50:3000/api/updates/my-cool-app/manifest",
      "requestHeaders": { "expo-channel-name": "production" },
      "fallbackToCacheTimeout": 0
    }
  }
}
```

Then install the client library and build a **fresh APK** that includes it:

```bash
npx expo install expo-updates
axe build --type apk --ota --release
```

Install that APK on the phone. **OTA cannot bootstrap itself** — the phone has to already be
running a binary that knows the update URL.

`fallbackToCacheTimeout: 0` means the app never blocks its splash screen waiting for the network.
It launches on the bundle it has and picks up the new one next launch.

### 10.2 Publishing an update

```bash
axe build --type update --release
```

Ninety seconds later it is live. **Open the app twice**: `expo-updates` downloads in the
background on the first launch and applies the new bundle on the second. That is standard
expo-updates behaviour, not a quirk of this server.

### 10.3 The runtimeVersion rule (the one that bites everybody)

An update is only ever served to an app reporting the **exact same `runtimeVersion`**. With
`"policy": "appVersion"` that is your `expo.version` string.

This is a safety feature, not an annoyance: it is what stops a JavaScript bundle from landing on a
binary that lacks the native code it needs, which crashes at startup.

**The rule: bump `expo.version` whenever you add or remove a native module.** Old installs then
correctly stop accepting new JS until their users install the new APK.

```
App v1.0.0 installed  ──►  serves updates built from a v1.0.0 source tree
App v1.1.0 installed  ──►  serves updates built from a v1.1.0 source tree
```

Both live at once, which is exactly what you want while people are still upgrading.

### 10.4 Rolling back

```bash
axe release <previous-good-buildId> --ota
```

The bad bundle is retired the moment the new one is promoted. Phones pick up the rollback on their
next launch, same as any other update.

---

## 11. Telling users a new APK exists

OTA covers JavaScript. When you change something native, users need a new APK — and nothing tells
them it exists unless your app asks.

The endpoint (no token — an installed app cannot carry one):

```
GET http://<server-ip>:3000/api/apps/<slug>/latest
```

```json
{
  "versionName": "1.1.0",
  "versionCode": 3,
  "sizeBytes": 61234567,
  "downloadUrl": "http://192.168.1.50:3000/api/apps/my-cool-app/latest/download",
  "runtimeVersion": "1.1.0",
  "createdAt": "2026-08-02T18:04:11.000Z"
}
```

Compare `versionCode` — the integer Android itself orders installs by — against the running build:

```tsx
import * as Application from "expo-application";
import { Alert, Linking } from "react-native";

export async function checkForApkUpdate() {
  const res = await fetch("http://192.168.1.50:3000/api/apps/my-cool-app/latest");
  if (!res.ok) return;                       // 404 = nothing released yet
  const latest = await res.json();

  const installed = Number(Application.nativeBuildVersion ?? 0);
  if (typeof latest.versionCode !== "number" || latest.versionCode <= installed) return;

  Alert.alert("Update available", `Version ${latest.versionName} is ready.`, [
    { text: "Later" },
    { text: "Install", onPress: () => Linking.openURL(latest.downloadUrl) },
  ]);
}
```

Opening the URL hands off to Android's download manager, which shows the system install prompt.
Doing it that way avoids the `REQUEST_INSTALL_PACKAGES` permission and custom native code.

Two things that make this fail silently:

- **You didn't bump `versionCode`.** Nothing to compare, so the prompt never appears.
- **Your release build blocks cleartext HTTP.** Expo release builds set
  `usesCleartextTraffic: false`, so a plain `http://` URL is refused. Either allow cleartext in
  your build properties (LAN only), or publish the server over HTTPS (section 14).

---

## 12. In-app notifications

Send a message from the dashboard; your app shows it. Useful for "new content added",
"maintenance tonight", "please update".

**This is a pull channel, not push.** Your app asks the server whether anything is waiting; the
server never contacts a device, keeps no device registry, and does not know who installed your
app. The trade-off is honest and worth understanding before you use it:

> A closed app shows nothing until someone opens it.

Real tray notifications would mean Firebase, a device token, a native module and therefore a new
APK for every user — all of which this deliberately avoids. Everything here works over an OTA
update to apps you have already shipped.

### 12.1 Sending one

Open **`http://<server-ip>:3000/notifications`**, pick the app, write a title and a message, press
**Send**.

| Field | Meaning |
|---|---|
| **App** | which project's users receive it |
| **Level** | `info` or `warning` — your app decides what that looks like |
| **Channel** | must match the channel your app asks for (`production` unless you changed it) |
| **Title / Message** | max 120 / 1000 characters |
| **Link** | optional `http(s)` URL. Anything else is rejected — it is handed to a browser |
| **Expires** | optional. After this instant, apps stop showing it |

From a shell:

```bash
curl -X POST http://<server-ip>:3000/api/notifications/my-cool-app \
  -H "authorization: Bearer $LOCAL_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"Maintenance tonight","body":"The server restarts at 21:00.","level":"warning"}'
```

**Retract** stops a message being served to apps that have not fetched it yet. It cannot remove it
from a phone that already has it — that copy lives in the app's own storage, and no server can
reach in and delete it.

### 12.2 Receiving them in your app

Your app fetches this (no token needed):

```
GET http://<server-ip>:3000/api/notifications/<slug>?channel=production
```

```json
{
  "channel": "production",
  "notifications": [
    {
      "id": "cmsc7n1x0001",
      "title": "New films added",
      "body": "Twelve new titles landed this week.",
      "linkUrl": null,
      "level": "info",
      "createdAt": "2026-08-02T18:30:00.000Z"
    }
  ]
}
```

Newest first, at most 50 live messages. Retracted and expired ones simply stop appearing — so
**replace** your local list with each response rather than merging, and retraction will actually
work.

A minimal client — fetch on launch, remember what has been read, show the newest unread one:

```tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const API = "http://192.168.1.50:3000/api/notifications/my-cool-app?channel=production";
const READ_KEY = "notifications.read";

export function useLatestNotification() {
  const [item, setItem] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(API, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return;                         // server asleep: show nothing, say nothing
        const { notifications } = await res.json();

        const read = JSON.parse((await AsyncStorage.getItem(READ_KEY)) ?? "[]");
        setItem(notifications.find((n) => !read.includes(n.id)) ?? null);
      } catch {
        /* offline — not worth an error in front of a user */
      }
    })();
  }, []);

  const markRead = async (id) => {
    const read = JSON.parse((await AsyncStorage.getItem(READ_KEY)) ?? "[]");
    await AsyncStorage.setItem(READ_KEY, JSON.stringify([...read, id]));
    setItem(null);
  };

  return { item, markRead };
}
```

Worth adding once that works: fetch again when the app returns to the foreground (rate-limited —
once every five minutes is plenty), keep the fetched list on disk so the inbox reads offline, and
ignore any `linkUrl` that is not `http(s)` before handing it to a browser.

---

## 13. Deleting builds and freeing disk

Every finished build has a **Delete** button — on its row in the table, and on its own page. It
removes the database row, the APK/AAB, the full build log and the uploaded source tarball, then
reports how much disk that freed.

- It **asks twice**. This is the one control that destroys something a rebuild cannot give back
  for free.
- A **queued or running** build cannot be deleted. The worker owns it until it finishes.
- A **live** build refuses the first time and offers **Delete anyway**. Going through with that
  means installed apps stop finding an update until you release another build.

From a shell:

```bash
curl -X DELETE -H "authorization: Bearer $LOCAL_TOKEN" \
  http://<server-ip>:3000/api/builds/<buildId>        # add ?force=1 for a live build
```

Bigger hammers:

```bash
make clean-cache   # wipe gradle/npm/ccache only — history and artifacts untouched
make nuke          # containers, images and state volumes gone; Android SDK kept
make nuke-sdk      # the above plus the SDK volume — host is left pristine
```

---

## 14. Reaching phones outside your network

A LAN URL only works while the phone is on your wifi. To update apps anywhere, publish the server
through a tunnel — **not** by port-forwarding.

> **The dashboard must never be exposed.** It renders `LOCAL_TOKEN` into its HTML so download
> links work. Anyone who loaded `/` on a public hostname could read that token and queue builds on
> your machine.

Cloudflare Tunnel (a working config is in `cloudflared.example.yml`):

```bash
cloudflared tunnel create axebuild-updates
cloudflared tunnel route dns axebuild-updates updates.example.com
cp cloudflared.example.yml ~/.cloudflared/config.yml     # then edit it
cloudflared tunnel run axebuild-updates
```

Point `service:` at wherever the web container listens — `http://localhost:3000` if cloudflared
runs on the Docker host, `http://<server-lan-ip>:3000` if it runs elsewhere. A wrong address shows
up as **502**; a 404 on everything means no ingress rule matched the hostname.

Then set `PUBLIC_HOSTNAME` in `docker-compose.yml` (or `.env`) and restart:

```yaml
PUBLIC_HOSTNAME: "${PUBLIC_HOSTNAME:-updates.example.com}"
```

Requests arriving on that hostname may reach **only** the read-only endpoints an installed app
needs, and only with `GET`/`HEAD`. Everything else 404s as if the server were not there. LAN
addresses are unaffected, so your dashboard keeps working at `http://<server-ip>:3000`.

**Verify it immediately — this is the check that matters:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://updates.example.com/             # expect 404
curl -s -o /dev/null -w '%{http_code}\n' https://updates.example.com/api/builds   # expect 404
curl -s -o /dev/null -w '%{http_code}\n' https://updates.example.com/api/health   # expect 200

# apps may read notifications through the tunnel, but never write one:
curl -s -o /dev/null -w '%{http_code}\n' \
  https://updates.example.com/api/notifications/my-cool-app                       # expect 200
curl -s -o /dev/null -X POST -w '%{http_code}\n' \
  https://updates.example.com/api/notifications/my-cool-app                       # expect 404
```

Finally, point your app at the public hostname (`updates.url`, the latest-APK URL, the
notifications URL) and ship a new APK. HTTPS also solves the cleartext problem from section 11.

Restricting paths in the tunnel's own ingress rules as a second layer is tempting, but a rule that
fails to match sends *everything* to the catch-all: you get 404s on the working endpoints too, and
it looks like a routing bug rather than a misconfigured guard. Keep the tunnel config to one
hostname → one service and let the app do the filtering.

---

## 15. CLI reference

All commands read `~/.axebuild/config.json` (written by `axe login`). Commands that act on a
project also read `axe.json` from the current directory.

### `axe login <url> [--token <token>]`

Save the server URL and token. Run once per development machine.

```bash
axe login http://192.168.1.50:3000 --token 9f3c...
```

`--token` defaults to `dev-local-token`.

### `axe init [--name <name>] [--slug <slug>]`

Create a project on the server and write `axe.json` here.

| Flag | Effect |
|---|---|
| `--name` | display name (default: the current folder's name) |
| `--slug` | link to an **existing** project instead of creating one |

### `axe build [options]`

Pack the current project, upload it, wait for the result. Exits non-zero on failure.

| Flag | Values | Default |
|---|---|---|
| `--type` | `apk` \| `aab` \| `update` | `apk` |
| `--profile` | `release` \| `debug` | `release` |
| `--abi` | `arm64-v8a` \| `arm64-v8a,armeabi-v7a` \| `all` | `arm64-v8a` |
| `--ota` | also export an OTA bundle | off |
| `--release` | promote on success | off |

```bash
axe build                                   # release APK, arm64 only
axe build --type apk --ota --release        # APK + OTA bundle, live immediately
axe build --type update --release           # JS-only update, ~90 s
axe build --type aab --abi all              # Play Store bundle, every architecture
```

Never uploaded: `node_modules`, `.git`, `android`, `ios`, `.expo`, `dist`, `build`, `web-build`,
`axe.json`, and any `.tgz`/`.apk`/`.aab` in the project root.

### `axe release <buildId> [--apk] [--ota] [--undo]`

Promote a successful build, or retire it.

```bash
axe release cmsc7msul000f            # whatever this build produced
axe release cmsc7msul000f --ota      # OTA channel only
axe release cmsc7msul000f --undo     # retire from both channels
```

---

## 16. HTTP API reference

Base URL: `http://<server-ip>:3000`. Everything needs `Authorization: Bearer <LOCAL_TOKEN>` unless
marked **public**. Public routes are read-only, and are the only ones reachable through a tunnel
(section 14).

| Method & route | Body / query | Returns |
|---|---|---|
| `GET /api/health` | — | **public** `{ ok: true }` |
| `POST /api/projects` | `{ name }` | `{ id, slug, name }` |
| `GET /api/projects` | — | every project + build count |
| `POST /api/builds` | multipart: `projectSlug`, `buildType`, `profile`, `abi`, `ota`, file `tarball` | `{ buildId }` |
| `GET /api/builds` | — | 100 most recent builds |
| `GET /api/builds/:id` | — | one build with all its metadata |
| `DELETE /api/builds/:id` | `?force=1` to delete a live build | `{ deleted, bytesFreed, wasReleased }` |
| `GET /api/builds/:id/artifact` | `?token=` also accepted | the APK/AAB file |
| `GET /api/builds/:id/logs` | `?token=` also accepted | SSE log stream (replays, then follows) |
| `POST /api/builds/:id/release` | `{ apk?, update? }` | new release state |
| `GET /api/apps/:slug/latest` | `?channel=` | **public** current APK version + download URL |
| `GET /api/apps/:slug/latest/download` | — | **public** that APK |
| `GET /api/updates/:slug/manifest` | expo-updates headers | **public** Expo Updates v1 manifest |
| `GET /api/updates/:slug/assets` | `?buildId=`, `?asset=` | **public** one file from the update bundle (expo-updates calls this itself) |
| `GET /api/notifications/:slug` | `?channel=`, `?since=` | **public** live notifications |
| `POST /api/notifications/:slug` | `{ title, body, linkUrl?, level?, channel?, expiresAt? }` | the created notification |
| `DELETE /api/notifications/:slug/:id` | — | retracts it |

Errors are `{ "error": "..." }` with a sensible status: `400` bad input, `401` bad token, `404`
missing, `409` refused (deleting a running or live build), `413` tarball too large.

---

## 17. Configuration reference

Everything lives in `docker-compose.yml`; values in `.env` override the defaults.

| Variable | Default | What it does |
|---|---|---|
| `LOCAL_TOKEN` | `dev-local-token` | the API token. **Change it.** |
| `PUBLIC_HOSTNAME` | (see compose) | hostname on which only public read-only routes are served |
| `BIND_ADDR` | `0.0.0.0` | set to `127.0.0.1` to keep the dashboard off the LAN entirely |
| `ANDROID_SDK_PACKAGES` | platform-tools, android-36, build-tools 36, ndk 27, cmake 3.30 | SDK packages fetched into the volume; the next start pulls only what is missing |
| `BUILD_TIMEOUT_MS` | `7200000` (2 h) | a build past this is killed as stuck |
| `GRADLE_JVM_ARGS` | `-Xmx4g -XX:MaxMetaspaceSize=1g` | Gradle's JVM budget; stays inside the container limit |
| `CCACHE_MAXSIZE` | `5G` | compiled-C++ cache size |
| `mem_limit` / `cpus` (worker) | `9g` / `3` | hard caps so a build cannot freeze the host |

Naming note: a few internal identifiers still read `mybuild` (the Compose project name, the
`mybuild_*` volumes, `/data/db/mybuild.db`, marker files in the SDK and artifact volumes). Those
are **frozen on purpose** — renaming a Compose project points a running install at empty volumes
and silently discards build history, artifacts and several GB of SDK. Rename them only before your
very first `make up`.

---

## 18. Maintenance and backups

**What is worth backing up:** the `db-data` volume (build history, release state, notifications)
and, if you care about being able to re-serve an exact APK, `artifacts`.

```bash
# Back up the database volume to a tarball
docker run --rm -v mybuild_db-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/axebuild-db-$(date +%F).tgz -C /data .
```

Everything else — caches, workspaces, uploads, the SDK — is reconstructible.

**Upgrading:** pull the code and run `make up`. It rebuilds the images, applies any database
schema changes on start, and keeps every volume.

**Disk getting tight:** delete old builds from the dashboard first (that is the only thing that
removes APKs), then `make clean-cache` if you need more.

---

## 19. Troubleshooting

### The build failed

Open the build on the dashboard — the full Gradle log is there, and it stays after failure. The
most common causes, in order:

| Symptom in the log | Cause | Fix |
|---|---|---|
| `npm ci` fails on a peer dependency | lockfile out of step with `package.json` | commit a fresh `package-lock.json` |
| `SDK location not found` / missing platform | a package not in `ANDROID_SDK_PACKAGES` | add it in `docker-compose.yml`, `make up` |
| Killed with no error, around Gradle | out of memory | lower `GRADLE_JVM_ARGS`, or raise the worker's `mem_limit` if the host has room |
| `Build timed out` | over `BUILD_TIMEOUT_MS` | usually a first build on a slow connection — just retry; the caches are warm now |
| Something about `expo prebuild` and a package id | no `expo.android.package` | set it in `app.json` (section 6.4) |
| A native module's code is missing after prebuild | it needs a config plugin, and the worker runs a bare `expo prebuild` | add the plugin to `expo.plugins` in your app config |

### The build is stuck at `queued`

Another build is running — only one runs at a time. If nothing is running, the worker is down:
`make ps`, then `make logs`.

### Every build is slow

Check the caches were not recently wiped (`make clean-cache` empties all three, making the next
build behave like a first build). Check `--abi` is not `all`.

### The OTA update never arrives

In order of likelihood:

1. **`runtimeVersion` mismatch.** The installed APK reports one value; the update was built from a
   source tree with another. Compare the build's `Runtime` field on the dashboard against your
   installed app's version.
2. **You only opened the app once.** It downloads on launch one and applies on launch two.
3. **The build was never released.** Check for the green `live` pill.
4. **The app cannot reach the server** — different network, or `http://` blocked in a release
   build (section 11).

### The in-app update prompt never appears

`versionCode` was not increased, or the endpoint returns 404 because no APK build has been
released yet. Test it directly: `curl http://<server>:3000/api/apps/<slug>/latest`.

### Notifications do not show up

- **Channel mismatch** — the message's channel must equal what the app asks for.
- **Expired or retracted** — check the state column on the dashboard.
- **The app has not been reopened**, which is how a pull channel works.

### 404 on everything through the tunnel

`PUBLIC_HOSTNAME` does not match the hostname in the request, or you are requesting a route that
is not public. Both are working as designed — re-run the verification block in section 14.

### 502 through the tunnel

`service:` in the cloudflared config points somewhere the web container is not listening.

---

## 20. Glossary

| Term | Meaning |
|---|---|
| **slug** | the URL-safe id of a project, e.g. `my-cool-app`. Lives in `axe.json` |
| **build** | one attempt to compile your app. Has an id, a status and a log |
| **artifact** | the file a build produced: an APK or an AAB |
| **release / live** | the flag that makes a build the one installed apps are served from |
| **channel** | a named release track (`production` by default). Apps ask for one by name |
| **OTA update** | a JavaScript+assets bundle an installed app downloads itself |
| **runtimeVersion** | the compatibility key between a JS bundle and the native binary running it |
| **versionCode** | the integer Android uses to order installs. Must increase per released APK |
| **APK / AAB** | the installable file / the Play Store upload format |
