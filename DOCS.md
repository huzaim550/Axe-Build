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
   - [8a. Signing for the Play Store (keystores)](#8a-signing-for-the-play-store-keystores)
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
- Sign **APKs** with anything but the standard Android debug keystore — perfect for sideloading
  and for updating your own installs, not accepted by the Play Store. `aab` builds are the
  exception: upload a keystore for a project and its bundles are signed with it (section 8a).
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
| `uploads` | uploaded source tarballs | Rebuild stops working for existing builds |
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
| `--type` | `apk`, `aab`, `update` | `apk` | `aab` is for the Play Store, and needs a signing key first (section 8a); `update` is OTA-only and skips Gradle entirely (~90 s) |
| `--profile` | `release`, `debug` | `release` | `debug` is bigger and slower but keeps dev tooling |
| `-a`, `--abi` | `arm64`, `phone`, `all` | `arm64` | CPU architectures to compile. Each extra one recompiles the whole native graph |
| `--ota` | flag | off | also export an OTA bundle alongside the APK (needed for the first OTA-capable build) |
| `-r`, `--release` | flag | off | promote it automatically if it succeeds |

The `-a` values are short names for real ABI lists: `arm64` → `arm64-v8a`, `phone` →
`arm64-v8a,armeabi-v7a`, `all` → all four. `arm64` covers essentially every Android phone made in
the last several years; `phone` adds old 32-bit devices. Use `all` only when you need x86 emulators
or Chromebooks, and expect a much longer build and a lot more scratch disk.

Building for the Play Store is `-t aab` plus a signing key, and has its own section — **8a**.

### How long it takes

- **First build of a project: 20–30 minutes.** Every npm and Maven dependency is downloaded over
  your connection, and all native C++ compiles from scratch.
- **Every build after that: 8–15 minutes**, thanks to three persistent caches (`npm-cache`,
  `gradle-cache`, `ccache`).
- **OTA-only builds (`--type update`): about 90 seconds.** No Gradle at all.

A build is killed after 2 hours (`BUILD_TIMEOUT_MS`). Only one runs at a time; extra builds wait
in the queue.

### Stopping one

Press **Cancel** on the build (or on its row), or:

```bash
axe cancel last                          # 'last' = this project's most recent build
axe cancel cmsc7msul000fijlf
```

A build that has not started yet is simply dropped from the queue. A running one is a different
thing: the worker kills the whole Gradle process group, which takes a few seconds, and the build
lands as `canceled` — not `failed`, because nothing was wrong with it. The worker is free for the
next build immediately.

### Rebuilding without re-uploading

The source you uploaded is kept for as long as the build exists, so you can run it again from the
server:

```bash
axe rebuild last                         # identical settings
axe rebuild last --ota                   # same source, this time with an OTA bundle
axe rebuild last -a phone                # same source, fewer architectures
axe rebuild cmsc7msul000fijlf            # or name the build explicitly
```

or press **Rebuild** on the build page. This creates a *new* build with its own id and its own
copy of the source — deleting either one leaves the other intact. Useful for a Gradle failure that
was really a flaky download, or for adding an OTA bundle to source you have already shipped.

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
   signed with the standard Android debug keystore. Nothing needs to be done about that for
   sideloading; the Play Store is a different story, which is section 8a.

Installing a newer build **over** an older one works, as long as both came from here. Going the
other way (installing an older `versionCode` over a newer one) does not; uninstall first. And an
install signed by a *different key* never upgrades in place, whichever direction it goes — that is
the trap section 8a exists to keep you out of.

---

## 8a. Signing for the Play Store (keystores)

### The short version

Four commands, start to finish. Each one is explained in full below; this is the copy-paste path
for a phone app going to Google Play.

```bash
# 1. Make an upload key (once per app, on your own machine — not the server).
#    It asks for a password and some certificate details. Answer them; they cannot be changed later.
keytool -genkeypair -v \
  -keystore ~/keys/myapp-upload.jks -alias myapp \
  -keyalg RSA -keysize 2048 -validity 10000

# 2. BACK IT UP — the file and the password — somewhere that is not this laptop
#    and not the build server.

# 3. Give a copy to the build server (once per project). Prompts for the password;
#    the alias is read out of the keystore, so there is nothing to remember.
axe keystore set ~/keys/myapp-upload.jks

# 4. Build the bundle, from the project folder.
axe build -t aab -a phone
```

Then check the log said `==> Signing with this project's upload key (alias myapp)`, download the
`.aab`, and upload it in the Play Console under **Release → Production → Create new release**.

> **Keep the `.jks` outside the project folder.** `axe build` tars the whole working tree, and
> `.jks` is not in the exclusion list — a key sitting in your project root is uploaded to the build
> server inside every source tarball, on every build, forever. `~/keys/` (`mkdir -p ~/keys &&
> chmod 700 ~/keys`) is a fine home for it. Gitignoring it is not enough; git is not what packs the
> tarball.

**On `-a phone`:** that is `arm64-v8a,armeabi-v7a`, the right choice for a phone app. `x86`/`x86_64`
exist for emulators and a handful of Chromebooks, and including them doubles the native compilation,
the build time and the scratch space a build needs — which is the usual cause of a
[`No space left on device`](#no-space-left-on-device) failure. Play splits the bundle per device
either way, so users never download an architecture they cannot run.

```bash
axe build -t aab -a phone   # arm64-v8a,armeabi-v7a — phones, the default choice
axe build -t aab -a arm64   # arm64-v8a only; lightest, every phone from ~2015 on
axe build -t aab -a all     # adds x86,x86_64 for emulators and Chromebooks
```

Steps 1 and 3 are done **once per app, ever**. After that, shipping a new version is only step 4.

### Why you need a key at all

Every Android app is signed. The signature is not decoration: Android uses it to decide whether an
update is really from the same author as the version already installed. An update signed with a
*different* key is refused outright ("App not installed"), and the only way past that is
uninstalling the app first — which throws away its data.

If you have **not** given this server a key, your builds are signed with the **Android debug
keystore**: a throwaway key that ships with the Android SDK, whose certificate says
`CN=Android Debug` and whose password everybody knows. That is completely fine for sideloading onto
your own phones, which is what sections 7 and 8 do.

**Google Play rejects it.** Uploading a debug-signed bundle fails in the Play Console with *"You
uploaded a debug-signed APK or Android App Bundle"*, because a key the whole world holds proves
nothing about who wrote the app.

So the rule is simple:

| What you are doing | Do you need a keystore? |
|---|---|
| Sideloading an APK onto your own devices (sections 7–8) | **No.** The debug key is fine. |
| OTA updates (section 10) — JS and assets only | **No.** OTA bundles are not signed. |
| Uploading an `.aab` to the Google Play Console | **Yes.** Once per app, and then forever. |

### The two keys Google talks about

The Play Console mentions two keys and it confuses everybody. They are not the same thing:

| | **Upload key** | **App signing key** |
|---|---|---|
| What it is | the key you generate below | the key the app is signed with when Google ships it to phones |
| Who holds it | you (and this build server) | Google, under **Play App Signing** |
| Used when | you upload an `.aab` to the Play Console | Google re-signs your bundle before delivering it |
| If you lose it | request a reset in the Play Console; you keep publishing | not yours to lose |

Play App Signing is mandatory for apps created since August 2021, so the key you make here is
almost certainly only an **upload key**. Losing it is recoverable — a support request, a few days —
not the end of your app. That is a relief, not permission to be careless: back it up anyway.

### Step 1 — get `keytool`

`keytool` comes with every JDK. You probably already have one; check first:

```bash
keytool -help >/dev/null 2>&1 && echo "keytool is here"
```

If not, pick whichever is least trouble:

| Where you are | Command / path |
|---|---|
| Fedora / RHEL | `sudo dnf install java-17-openjdk-headless` |
| Debian / Ubuntu | `sudo apt install openjdk-17-jdk-headless` |
| macOS (Homebrew) | `brew install openjdk@17` |
| Have Android Studio | Linux/Windows: `<studio>/jbr/bin/keytool` · macOS: `/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool` |

Generate the key on **your own machine**, not on the build server. The server needs a copy, but the
original and its backup should live somewhere you control.

### Step 2 — generate the upload key

```bash
keytool -genkeypair -v \
  -keystore myapp-upload.jks \
  -alias myapp \
  -keyalg RSA -keysize 2048 -validity 10000
```

What the arguments mean:

| Argument | Meaning |
|---|---|
| `-keystore myapp-upload.jks` | the file that will hold the key. Name it after the app; you will have one per app. |
| `-alias myapp` | the name of the key *inside* that file. One keystore can hold several; you need this string later, exactly as typed. |
| `-keyalg RSA -keysize 2048` | what Google requires (RSA 2048 or stronger). |
| `-validity 10000` | days — about 27 years. Play requires a certificate valid past 2033, so do not shorten this. |

It then asks you a series of questions:

```
Enter keystore password:            ← invent one. This is your storePassword.
Re-enter new password:
What is your first and last name?   ← [Unknown] anything: your name, or the app's name
What is the name of your organizational unit?   ← may be left blank
What is the name of your organization?
What is the name of your City or Locality?
What is the name of your State or Province?
What is the two-letter country code for this unit?   ← e.g. PK, GB, US
Is CN=..., OU=..., O=... correct?   ← type: yes
Enter key password for <myapp>
        (RETURN if same as keystore password):     ← press Enter, or set a second password
```

These answers go into the certificate. **Nobody sees them** — they are not shown on your Play
listing — but they cannot be changed afterwards, so put something real. Pressing Enter at the last
prompt makes the key password identical to the keystore password, which is the simplest thing to
live with.

Prefer not to be prompted (careful: this puts passwords in your shell history):

```bash
keytool -genkeypair -v \
  -keystore myapp-upload.jks -alias myapp \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$STORE_PASS" -keypass "$STORE_PASS" \
  -dname "CN=My App, OU=, O=My Org, L=Lahore, ST=Punjab, C=PK"
```

You now have three things, and you need all three from here on:

1. the file `myapp-upload.jks`
2. the alias — `myapp`
3. the password(s) — store password, and the key password if you made it different

### Step 3 — back it up, now, before anything else

```bash
# a password manager entry is better than a folder, but at minimum: not only on this laptop
cp myapp-upload.jks ~/backups/       # and an offline copy — USB, external disk
```

- Put the alias and the passwords **with** the file. A keystore whose password you have forgotten
  is exactly as useless as no keystore.
- **Keep it out of the project folder entirely** — `~/keys/` rather than next to `app.json`.
  Gitignoring `*.jks` stops the commit but not the upload: `axe build` tars the working tree and
  does not exclude `.jks`, so a key in the project root travels to the build server in every
  source tarball you ever produce.
- Do not treat the build server as the backup. It is the *consumer* of the key, and `make nuke`
  deletes the volume it lives in.

### Step 4 — give the key to the build server (once per project)

From your project folder — the one with `axe.json`, which is where the slug comes from:

```bash
axe keystore set ~/keys/myapp-upload.jks
```

That is the whole command. It prompts:

```
Keystore password: 
Upload key stored for 'my-cool-app' (alias myapp).
Every 'axe build --type aab' for this project is now signed with it.
Back up myapp-upload.jks and its password somewhere off this machine.
```

Three things it does so you do not have to:

- **The password is prompted, never typed as an argument** — so it stays out of your shell history
  and out of `ps`. Piping also works (`echo "$PW" | axe keystore set key.jks`) for a script.
- **The alias is read out of the keystore.** Getting it wrong is the classic mistake, and the error
  it causes surfaces deep inside Gradle an hour later. If the file holds more than one key — or
  `keytool` is not installed — it asks you for `--alias` instead.
- **The slug comes from `axe.json`**, so there is no URL to assemble.

| Flag | When you need it |
|---|---|
| `--alias <alias>` | the keystore holds more than one key, or auto-detection failed |
| `--key-password` | the key has its own password, different from the store password (you did **not** press Enter at keytool's last prompt) |

The other two:

```bash
axe keystore        # what is configured? (alias and filename — never the passwords)
axe keystore rm     # remove it; aab builds go back to being debug-signed
```

Replacing a key is just `axe keystore set` again — the stored file is named after the project, so
the old one is overwritten rather than left on the volume.

> Replacing the key of an app that is **already on Play** is not just this command — you have to
> register the new upload key with Google as well, from the Play Console. Do that first.

What the server does with it: the file is written to the `keystores` volume as
`/data/keystores/<slug>.jks` with mode `0600`, and the alias and passwords go into the database.
The worker container mounts that volume **read-only**. The underlying HTTP endpoint is in
section 16 if you would rather script it directly.

### Step 5 — build a bundle

```bash
axe build -t aab -a phone
```

Google splits the bundle per device, so each user downloads only the slice their phone can run —
the ABIs you compile decide who is *offered* the app, not how big anyone's download is.

| `-a` | Compiles | Who gets the app | Cost |
|---|---|---|---|
| `arm64` | `arm64-v8a` | every Android phone from roughly 2015 onward | lightest and fastest |
| `phone` | `arm64-v8a,armeabi-v7a` | the above, plus old and budget 32-bit devices | **the right default for a phone app** |
| `all` | `+ x86,x86_64` | the above, plus emulators and some Chromebooks | doubles native compilation, build time and scratch disk |

Reach for `all` only if you actually care about emulator or Chromebook users. It is the heaviest
thing this server can be asked to do and the usual trigger for
[`No space left on device`](#no-space-left-on-device); leave ~30 GB free before trying it.

In the build log you will see either

```
==> Signing with this project's upload key (alias myapp)
```

or, if you skipped step 4:

```
==> WARNING: no keystore uploaded for this project, so this bundle
    is debug-signed. Google Play rejects debug-signed uploads.
```

Signing happens by writing `android.injected.signing.*` properties into the workspace's
`gradle.properties`, which is deleted with the workspace when the build ends. The passwords are
never passed on the Gradle command line, where they would be visible in `ps` and in the log.

**`apk` builds are deliberately left unsigned by your key**, even after you upload one. Signing
them too would change the signature of the sideloaded flavour, and Android refuses an update signed
by a different key — so the first bundle you signed would break every phone that already has a
sideloaded build, each of which would need uninstalling (and losing its data) to recover. `aab` for
Play, `apk` for your own devices, two separate lives.

### Step 6 — verify, then upload to Play

Download the `.aab` and check what actually signed it before you spend an upload on it:

```bash
keytool -printcert -jarfile app-release.aab
```

Look at the `Owner:` line.

| Output | Meaning |
|---|---|
| `Owner: CN=My App, O=My Org, ...` | correct — that is your upload key |
| `Owner: CN=Android Debug, O=Android, C=US` | debug-signed: the server has no keystore for this project, or you built an `apk` |

Then, in the Play Console: your app → **Release** → **Production** (or **Internal testing** for a
first run) → **Create new release** → upload the `.aab`. The first upload of a new app enrols it in
Play App Signing automatically; every later upload must be signed with the same upload key.

### When it goes wrong

| What you see | What it actually is |
|---|---|
| Play: *"You uploaded a debug-signed APK or Android App Bundle"* | no keystore configured for that project — step 4 was skipped, or you uploaded it to a different slug |
| Play: *"Your Android App Bundle is signed with the wrong key"* | the keystore on the server is not the upload key this app is enrolled with. Check the fingerprint in the Play Console against `keytool -list -v -keystore myapp-upload.jks` |
| Gradle: `Keystore was tampered with, or password was incorrect` | wrong `storePassword` |
| Gradle: `Cannot recover key` | store password is right, `keyPassword` is wrong |
| Gradle: `No key with alias 'x' found in keystore` | wrong `keyAlias`. `keytool -list -keystore myapp-upload.jks` prints the real ones |
| `aab` builds fail right after a `DELETE`, deep inside Gradle | should not happen — the row is deleted before the file for exactly this reason — but if it does, re-POST the keystore |
| Phone: *"App not installed"* on an update | the two builds were signed by different keys. Uninstall first, or go back to the key the installed version used |

### Two things to know about how this is stored

- **The passwords are stored in plaintext**, like every other credential on this server. That is
  only defensible because the whole thing is LAN-only behind one token. Never expose it — the
  keystore routes are not among the public routes the tunnel serves (section 14), and must not be.
- **The `keystores` volume is not disposable.** `make nuke` takes it with everything else. Back it
  up alongside the database:

  ```bash
  docker run --rm -v mybuild_keystores:/data -v "$PWD":/backup alpine \
    tar czf /backup/axebuild-keystores-$(date +%F).tgz -C /data .
  ```

  This is a backup of secrets: encrypt it or keep it somewhere you would keep a password.

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

`make clean-cache` stops the containers to release the volumes, so follow it with `make up`. And
note that a build needs far more scratch space than the file it produces — if one has already died
with `No space left on device`, section 19 has the full checklist.

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

```
axe login     <url> [--token <token>]
axe init      [--name <name>] [--slug <slug>]
axe build     [-t type] [-p profile] [-a abi] [--ota] [-r]
axe cancel    <buildId|last> [--force]
axe rebuild   <buildId|last> [-t type] [-p profile] [-a abi] [--ota]
axe release   <buildId|last> [--apk] [--ota] [--undo]
axe keystore  [show] | set <file> [--alias] [--key-password] | rm
```

`axe --help` lists these; `axe <command> --help` shows one command's flags.

**Three things exist so you do not have to remember much:**

| Instead of | Type |
|---|---|
| `--type`, `--profile`, `--abi`, `--release` | `-t`, `-p`, `-a`, `-r` |
| `--abi arm64-v8a,armeabi-v7a` | `-a phone` (also `-a arm64`, `-a all`) |
| a 25-character build id | `last` — this project's most recent build |

```bash
axe build -t aab -a phone     # = axe build --type aab --abi arm64-v8a,armeabi-v7a
axe release last              # prints which id it resolved to before acting
```

`last` reads `axe.json`, so it always means *this project's* newest build even when other projects
have built since.

### How the CLI finds things

Two files, and nothing else:

| File | Written by | Holds | Scope |
|---|---|---|---|
| `~/.axebuild/config.json` | `axe login` | `{ "url": ..., "token": ... }` | the whole machine |
| `axe.json` (project folder) | `axe init` | `{ "projectSlug": ... }` | one project |

Older installs used `~/.mybuild/config.json` and `mybuild.json`. Those are still **read** when they
are the only file present, so an existing checkout keeps working; nothing is migrated behind your
back. If both a new and a legacy project file exist and they name *different* slugs, `axe.json`
wins and you get a warning — worth resolving, because the mismatch means builds go to one project
while installed apps poll another.

Every command that talks to the server sends `Authorization: Bearer <token>`. Errors are printed as
one line, without a stack trace, and the process exits `1`:

| Exit code | When |
|---|---|
| `0` | the command did what it said |
| `1` | request failed (`401` bad token, `404` unknown build/project, `409` refused), no `axe.json`, not logged in, or — for `axe build` — the build itself failed or was canceled |

### `axe login <url> [--token <token>]`

Saves the server URL and token to `~/.axebuild/config.json`. Run it **once per development
machine**, not once per project.

```bash
axe login http://192.168.1.50:3000 --token 9f3c8e0b...
```

| Flag | Default | Notes |
|---|---|---|
| `<url>` | — | the dashboard's base URL. Use the server's **LAN IP**, not `localhost`, unless the CLI runs on the server itself. No trailing path. |
| `--token` | `dev-local-token` | must equal the server's `LOCAL_TOKEN`. |

This command does **not** contact the server — it only writes the file, so it always "succeeds". A
wrong URL or token surfaces on the next command as a connection error or `401 unauthorized`. To
check straight away:

```bash
curl -H "Authorization: Bearer 9f3c8e0b..." http://192.168.1.50:3000/api/projects
```

Re-running `login` overwrites the file, which is how you point the CLI at a different server.

### `axe init [--name <name>] [--slug <slug>]`

Creates a project on the server and writes `axe.json` into the current folder. Run it from your
Expo project root — the folder with `package.json` and `app.json`.

| Flag | Default | Effect |
|---|---|---|
| `--name` | the current folder's name | display name on the dashboard. The slug is derived from it. |
| `--slug` | — | **link** this folder to an existing project instead of creating one. Nothing is created. |

The slug is the name lowercased, with every run of non-alphanumeric characters turned into `-`,
trimmed of leading/trailing dashes and cut to 40 characters. `My Cool App!` → `my-cool-app`.

```bash
axe init                          # project named after the folder
axe init --name "My Cool App"     # explicit name → slug my-cool-app
axe init --slug my-cool-app       # link a second checkout to an existing project
```

**If a project with that name or slug already exists, `init` stops instead of creating one.** It
prints the existing slug and the two ways forward:

```
Project 'My Cool App' (slug: my-cool-app) already exists on http://192.168.1.50:3000.
  To link this folder to it:
      axe init --slug my-cool-app
  To create a separate project:
      axe init --name <different-name>
```

That refusal is deliberate. The server resolves a slug collision by appending a random suffix, so
without this check you would quietly get a *second* project: your builds would land on
`my-cool-app-w1ch` while every installed app kept polling `my-cool-app` for updates, and releases
would look green while reaching nobody.

`--slug` is checked against the server's project list, so a typo fails loudly and lists the real
slugs rather than writing a config that 404s on every build.

### `axe build [options]`

Packs the current project, uploads it, and waits. This is the command you will use most.

| Flag | Values | Default | What it means |
|---|---|---|---|
| `-t`, `--type` | `apk`, `aab`, `update` | `apk` | `apk` to sideload; `aab` for the Play Store (see section 8a about signing); `update` is OTA-only and skips Gradle entirely |
| `-p`, `--profile` | `release`, `debug` | `release` | `debug` is larger and slower but keeps dev tooling and is debuggable |
| `-a`, `--abi` | `arm64`, `phone`, `all` | `arm64` | CPU architectures to compile native code for. Each extra one recompiles the whole native graph |
| `--ota` | flag | off | also export an OTA update bundle alongside the APK/AAB. Needed on the first build if you ever want to OTA-update from it |
| `-r`, `--release` | flag | off | if the build succeeds, promote it immediately (equivalent to running `axe release <id>` afterwards) |

The `-a` names expand to real ABI lists: `arm64` → `arm64-v8a`, `phone` →
`arm64-v8a,armeabi-v7a`, `all` → all four. The expansion happens in the CLI, so an unknown value
is rejected before anything is packed or uploaded, with the three valid ones printed.

```bash
axe build                     # release APK, arm64 only
axe build --ota -r            # APK + OTA bundle, live immediately
axe build -t update -r        # JS-only update, ~90 s, no Gradle
axe build -t aab -a phone     # Play Store bundle for phones (section 8a)
axe build -t aab -a all       # ...plus x86/x86_64 for emulators — much heavier
axe build -p debug            # debuggable APK
```

**What actually happens, in order:**

1. Reads `~/.axebuild/config.json` and `axe.json`. Missing either one is an immediate error telling
   you which command to run.
2. Warns if `app.json` has no `expo.android.package` — `expo prebuild` runs non-interactively on
   the worker and will invent one, which changes your app's identity. (No warning if you use
   `app.config.js`; the CLI does not evaluate it.)
3. Tars the source and prints its size. **Never uploaded:** `node_modules`, `.git`, `android`,
   `ios`, `.expo`, `dist`, `build`, `web-build`, `axe.json`, `mybuild.json`, and any `.tgz`,
   `.apk` or `.aab` in the project root. `android/` and `ios/` are excluded because the worker runs
   `expo prebuild` itself — anything you hand-edited in `android/` will not survive, so express it
   through config plugins or `app.json` instead.
4. Uploads, prints the build id and the dashboard URL, and deletes the local tarball.
5. Polls `GET /api/builds/:id` every 3 seconds, printing each status change with elapsed seconds.

```
Packing project (source only — no node_modules)...
Tarball: 2.4 MB
Build queued: cmsc7msul000fijlf
Dashboard: http://192.168.1.50:3000
[2s] status: running
[812s] status: success

Build succeeded! Download your artifact:
  http://192.168.1.50:3000/api/builds/cmsc7msul000fijlf/artifact?token=...
or:
  curl -OJ -H "Authorization: Bearer ..." http://192.168.1.50:3000/api/builds/.../artifact

Not live yet. Promote it with:  axe release cmsc7msul000fijlf
```

On failure it prints the server's error, points at the dashboard for the full Gradle log, and exits
`1` — so `axe build && ./deploy.sh` behaves the way you would expect in a script.

**Ctrl-C only stops the waiting, not the build.** The work is queued on the server; close the
terminal and it carries on. Pick it up again on the dashboard, or with
`axe cancel <buildId>` if you meant to stop it.

Only one build runs at a time. A second `axe build` queues behind the first and sits at `queued`,
which is normal, not a hang.

### `axe cancel <buildId|last> [--force]`

Stops a queued or running build.

```bash
axe cancel last                  # the one you just started
axe cancel cmsc7msul000fijlf
```

A **queued** build is dropped from the queue immediately and the CLI says so. A **running** one is
different: the worker has to kill the whole Gradle process group, which takes a few seconds, so the
CLI reports `Cancel requested — the worker is stopping build ...`. It lands as `canceled`, not
`failed`, because nothing was wrong with it, and the worker picks up the next build straight away.
The workspace is deleted either way.

`--force` marks the row `canceled` in the database without waiting for the worker to confirm. Use
it **only** on a build stuck at `running` because the worker restarted underneath it. On a genuinely
running build it hides Gradle from the dashboard instead of stopping it, and you are left with a
build that is not really cancelled burning CPU.

### `axe rebuild <buildId|last> [-t] [-p] [-a] [--ota]`

Queues the same uploaded source again — no packing, no upload. The tarball is kept for as long as
the build exists.

| Flag | Effect |
|---|---|
| `-t`, `-p`, `-a` | override type / profile / ABIs; anything you omit is inherited from the original build |
| `--ota` | also export an OTA bundle this time |

```bash
axe rebuild last                  # the same thing again — the common case after a flaky failure
axe rebuild last -a phone         # same source, fewer architectures
axe rebuild last -t aab           # same source, as a Play bundle
axe rebuild cmsc7msul000fijlf --ota
```

It prints the **new** build id and returns straight away — it does not wait for the result, unlike
`axe build`. The new build is fully independent: its own id, its own copy of the source, its own
artifacts. Deleting either one leaves the other intact.

Good for a Gradle failure that was really a flaky download, and for producing an `aab` from source
you have already shipped as an `apk` without re-uploading a single byte.

### `axe release <buildId|last> [--apk] [--ota] [--undo]`

Promotes a successful build so installed apps start receiving it, or retires it. Section 9 explains
the two channels; this is the reference.

| Flags | What is changed |
|---|---|
| *(none)* | release whatever this build actually produced — the server decides |
| `--apk` | APK channel only; the current OTA release is left alone |
| `--ota` | OTA channel only; the current APK release is left alone |
| `--undo` | retire from **both** channels — nothing is served from this build any more |

```bash
axe release last                         # whatever the build you just ran produced
axe release last --apk                   # APK channel only
axe release cmsc7msul000fijlf --ota      # OTA channel only
axe release cmsc7msul000fijlf --undo     # retire from both
```

Output tells you which channels moved and at what version:

```
Released to 'production': APK + OTA v1.4.0 (12)
  APK channel: http://192.168.1.50:3000/api/apps/<slug>/latest
  OTA runtimeVersion: 1.4.0
```

Two things worth watching in that output. `OTA runtimeVersion: (none — apps will NOT match this)`
means the build has no resolvable runtime version and **no phone will ever receive it** — see
section 10.3. And exactly one build per channel is live at a time, so releasing a new one silently
retires the previous one (for OTA, only within the same `runtimeVersion`).

Passing both `--apk` and `--ota` is the same as passing neither.

### `axe keystore [show] | set <file> | rm`

The upload key this project's `aab` builds are signed with. Section 8a is the full story; this is
the reference. All three read the slug from `axe.json`, so they take no URL and no token.

```bash
axe keystore                            # or: axe keystore show
axe keystore set ~/keys/myapp.jks
axe keystore rm
```

**`axe keystore`** (the default) prints the configured alias and stored filename, or, if there is
none, says so and reminds you that `aab` builds are being debug-signed. Passwords are never
returned by the server, so they are never printed.

**`axe keystore set <file>`** uploads the keystore and stores it against this project.

| Flag | When you need it |
|---|---|
| `--alias <alias>` | the keystore holds more than one key, or `keytool` is missing so auto-detection could not run |
| `--key-password` | prompt for a second password because the key has its own, different from the store password |

The store password is **prompted, never an argument** — a password on the command line lands in
shell history and is visible in `ps` to every user on the machine. When stdin is not a terminal the
password is read as a plain line instead, so `echo "$PW" | axe keystore set key.jks` works in a
script without a second code path.

The alias is read out of the keystore with `keytool -list` (the password goes in on stdin there
too, for the same reason). If exactly one key is found, that is the alias; otherwise you are asked
for `--alias`. This exists because a mistyped alias is not caught anywhere until Gradle fails with
`No key with alias` — an hour into a build.

**`axe keystore rm`** deletes the server's copy and its database row; your own `.jks` is untouched.
The next `aab` build is debug-signed again. It says which alias it removed, so you have a record if
that was a mistake.

### Not in the CLI yet

Sending notifications and deleting builds are dashboard or `curl` operations — sections 12 and 13.

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
| `DELETE /api/projects/:slug` | — | deletes an **empty** project; `409` if it has builds |
| `GET /api/projects/:slug/keystore` | — | whether an upload key is configured (alias + filename, never passwords) — `axe keystore` |
| `POST /api/projects/:slug/keystore` | multipart: `keystore`, `keyAlias`, `storePassword`, `keyPassword?` | stores it; `aab` builds are signed with it — `axe keystore set` |
| `DELETE /api/projects/:slug/keystore` | — | removes the row and the file — `axe keystore rm` |
| `POST /api/builds` | multipart: `projectSlug`, `buildType`, `profile`, `abi`, `ota`, file `tarball` | `{ buildId }` |
| `GET /api/builds` | — | 100 most recent builds |
| `GET /api/builds/:id` | — | one build with all its metadata |
| `DELETE /api/builds/:id` | `?force=1` to delete a live build | `{ deleted, bytesFreed, wasReleased }` |
| `GET /api/builds/:id/artifact` | `?token=` also accepted | the APK/AAB file |
| `GET /api/builds/:id/logs` | `?token=` also accepted | SSE log stream (replays, then follows) |
| `POST /api/builds/:id/cancel` | `?force=1` for a row orphaned by a worker restart | `{ status: "canceled" }`, or `202` + `"canceling"` while the worker stops it |
| `POST /api/builds/:id/rebuild` | `{ buildType?, profile?, abi?, ota? }` | `{ buildId, from }` |
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
| `Keystore was tampered with`, `Cannot recover key`, `No key with alias` | wrong keystore password or alias | re-upload it — section 8a has the full table |
| A wall of stack traces ending in `No space left on device` | the server's disk filled up | see the next entry |

### `No space left on device`

The server's disk filled up mid-build. The log will be a wall of Java stack traces — Gradle failing
to write `last-build.bin`, `executionHistory.bin`, its config-cache HTML report — but every one of
them ends in the same line, and that is the only line that matters:

```
Caused by: java.io.IOException: No space left on device
```

Nothing is wrong with your app, your dependencies or your signing key. Builds usually die at the
*end* of a long run, having already done 20+ minutes of real work.

**Why it happened.** A build's workspace is far larger than the file it produces: the extracted
source, `node_modules`, `expo prebuild`'s generated `android/`, and every intermediate object file
Gradle and the NDK write on the way. `--abi all` multiplies the native part of that by four, since
each architecture compiles the whole C++ graph again. A bundle that lands at 80 MB can need
20 GB of scratch space to get there.

The workspace itself is not the leak — it is deleted in a `finally` block, so it is already gone by
the time you read the error. What filled the disk is everything that persists:

| What | Grows to | Safe to delete? |
|---|---|---|
| `android-sdk` volume | ~15 GB | no — you would re-download it all |
| `gradle-cache`, `npm-cache` | several GB, forever | yes, `make clean-cache` |
| `ccache` | `CCACHE_MAXSIZE`, default 5 GB | yes, same command |
| `artifacts` | every APK/AAB you have ever built, plus logs | yes, per build, from the dashboard |
| `uploads` | one source tarball per build | goes with the build |
| Docker's image + build cache | often many GB | yes, `docker system prune -af` |

**Diagnose, on the server:**

```bash
df -h                    # which filesystem, and how bad
docker system df -v      # per-volume and per-image breakdown
```

**Free space, cheapest first:**

```bash
docker system prune -af  # dangling images and Docker's build cache — usually the big win
make clean-cache         # gradle-cache + npm-cache + ccache; they rebuild on demand
make up                  # clean-cache stops the containers to release the volumes
```

then delete old builds from the dashboard — that is the only thing that removes artifacts,
tarballs and logs, and it tells you how much each one freed (section 13).

**Then avoid it next time.** Leave **~30 GB free** before an `-a all` build. Better, do not ask for
`all` unless you need it: `-a phone` covers every real phone, halves the native output, and Play
still splits the bundle per device so users download no more than they would have.

```bash
axe build -t aab -a phone
axe rebuild last -a phone      # same source, no re-upload
```

A build killed this way is safe to re-run: no state survived it.

### Google Play rejects the bundle

Almost always one of two things, both covered in [section 8a](#8a-signing-for-the-play-store-keystores):
no upload key is configured for that project (so the bundle is debug-signed), or the key on the
server is not the one the app is enrolled with. `keytool -printcert -jarfile app-release.aab` tells
you which, before you spend another upload finding out.

### The build is stuck at `queued`

Another build is running — only one runs at a time. Open the one that is running and press
**Cancel** if it is not the one you care about. If nothing is running, the worker is down:
`make ps`, then `make logs`.

### Every build is slow

Check the caches were not recently wiped (`make clean-cache` empties all three, making the next
build behave like a first build). Check `-a` is not `all`.

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
| **keystore** | a `.jks` file holding one or more signing keys, protected by a password |
| **alias** | the name of one key inside a keystore. You need it, exactly, to sign with that key |
| **debug key** | the throwaway key the Android SDK signs with by default. Fine to sideload, rejected by Play |
| **upload key** | the key *you* generate and sign Play uploads with (section 8a) |
| **app signing key** | the key Google holds and re-signs your app with before it reaches phones |
