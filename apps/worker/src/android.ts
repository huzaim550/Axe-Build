import fs from "node:fs/promises";
import path from "node:path";
import { BuildCanceled, execCapture, execStream } from "./exec.js";
import type { AppMeta, BuildSpec, Runner, RunnerResult, SigningConfig } from "./runner.js";

const GRADLE_TASKS: Record<string, string> = {
  "apk/release": "assembleRelease",
  "apk/debug": "assembleDebug",
  "aab/release": "bundleRelease",
  "aab/debug": "bundleDebug",
};

export class AndroidRunner implements Runner {
  async *run(spec: BuildSpec): AsyncGenerator<string, RunnerResult, void> {
    const ws = spec.workspaceDir;
    const remaining = () => {
      const ms = spec.deadline - Date.now();
      if (ms <= 0) throw new Error("Build timed out");
      return ms;
    };
    // Every child process gets the cancel signal; none of them may outlive it.
    const signal = spec.signal;

    yield `==> Extracting source tarball`;
    yield* execStream("tar", ["-xzf", spec.tarballPath, "-C", ws], {
      cwd: ws,
      timeoutMs: remaining(),
      signal,
    });

    // Tolerate tarballs that wrap everything in a single top-level directory.
    const projectDir = await findProjectDir(ws);
    yield `==> Project root: ${path.relative(ws, projectDir) || "."}`;

    yield `==> Installing dependencies (npm)`;
    const hasLockfile = await exists(path.join(projectDir, "package-lock.json"));
    // --prefer-offline: trust the persistent npm cache volume instead of
    // revalidating every package over the network on each build.
    yield* execStream(
      "npm",
      [hasLockfile ? "ci" : "install", "--no-audit", "--no-fund", "--prefer-offline"],
      { cwd: projectDir, timeoutMs: remaining(), signal },
    );

    yield `==> Reading app config`;
    const meta = await readAppMeta(projectDir, remaining(), signal);
    yield `    version=${meta.versionName ?? "?"} versionCode=${meta.versionCode ?? "?"} ` +
      `runtimeVersion=${meta.runtimeVersion ?? "?"} package=${meta.androidPackage ?? "?"}`;
    if (!meta.runtimeVersion) {
      yield `    note: no runtimeVersion in app config — OTA updates need one (see DOCS.md)`;
    }

    // OTA bundle. `update` builds stop here: a JS-only change needs no native
    // toolchain at all, which is why this path takes ~90s instead of ~15min.
    let updateSourceDir: string | undefined;
    if (spec.buildType === "update" || spec.ota) {
      updateSourceDir = path.join(ws, "update");
      yield `==> Exporting update bundle (expo export)`;
      yield* execStream(
        "npx",
        ["expo", "export", "--platform", "android", "--output-dir", updateSourceDir],
        { cwd: projectDir, timeoutMs: remaining(), signal },
      );
      if (spec.buildType === "update") {
        yield `==> Update bundle ready (no APK — this is an OTA-only build)`;
        return { updateSourceDir, meta };
      }
    }

    yield `==> Generating android project (expo prebuild)`;
    yield* execStream(
      "npx",
      ["expo", "prebuild", "--platform", "android", "--no-install"],
      { cwd: projectDir, timeoutMs: remaining(), signal },
    );

    const androidDir = path.join(projectDir, "android");
    const gradlew = path.join(androidDir, "gradlew");
    await fs.chmod(gradlew, 0o755);

    const task = GRADLE_TASKS[`${spec.buildType}/${spec.profile}`];
    if (!task) throw new Error(`Unsupported build: ${spec.buildType}/${spec.profile}`);

    // Signing is release-only: a debug build is for testing, and overriding its
    // key would just make one more APK your users cannot upgrade over.
    if (spec.signing && spec.profile === "release") {
      await writeSigningProperties(androidDir, spec.signing);
      yield `==> Signing with the project keystore (alias: ${spec.signing.keyAlias})`;
    } else if (spec.profile === "release") {
      yield `==> No keystore for this project — Gradle will use its debug key ` +
        `(installable, but a later signed build cannot upgrade over it)`;
    }

    yield `==> Running Gradle: ${task} (abis: ${spec.abis})`;
    // -P overrides the reactNativeArchitectures set in the generated
    // gradle.properties, so we narrow the ABI list without editing user files.
    yield* execStream(
      "./gradlew",
      [task, `-PreactNativeArchitectures=${spec.abis}`, "--no-daemon", "--stacktrace"],
      { cwd: androidDir, timeoutMs: remaining(), signal },
    );

    const ext = spec.buildType === "aab" ? ".aab" : ".apk";
    const outputsDir = path.join(androidDir, "app", "build", "outputs");
    const artifact = await findArtifact(outputsDir, ext);
    if (!artifact) {
      throw new Error(`Gradle finished but no ${ext} found under ${outputsDir}`);
    }
    yield `==> Artifact: ${path.relative(ws, artifact)}`;

    // Say who actually signed it. Configuring signing and *being* signed are two
    // different things, and the difference only shows up on someone's phone
    // weeks later when the upgrade is refused.
    if (spec.buildType === "apk") {
      for await (const line of describeSigner(artifact, remaining(), signal)) yield line;
    }

    return { artifactSourcePath: artifact, updateSourceDir, meta };
  }
}

/**
 * `expo config --type public` resolves app.json / app.config.js the same way
 * prebuild does, so these values match what actually lands in the APK.
 * Never fatal: a missing version only costs us the update channels.
 */
async function readAppMeta(
  projectDir: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<AppMeta> {
  let raw: string;
  try {
    raw = await execCapture("npx", ["expo", "config", "--type", "public", "--json"], {
      cwd: projectDir,
      timeoutMs: Math.min(timeoutMs, 120_000),
      signal,
    });
  } catch (err) {
    // A cancel here must stop the build, not be swallowed as "no version info".
    if (err instanceof BuildCanceled) throw err;
    return {};
  }

  // The CLI can print a banner before the JSON, so start at the first brace.
  const start = raw.indexOf("{");
  if (start === -1) return {};
  let cfg: any;
  try {
    cfg = JSON.parse(raw.slice(start));
  } catch {
    return {};
  }

  // runtimeVersion may be a policy object ({ policy: "appVersion" }); Expo
  // resolves it to a string here only when it can. A policy we can't resolve
  // is left undefined rather than stored as "[object Object]".
  const rv = cfg?.runtimeVersion;
  const runtimeVersion =
    typeof rv === "string"
      ? rv
      : rv?.policy === "appVersion" && typeof cfg?.version === "string"
        ? cfg.version
        : undefined;

  return {
    versionName: typeof cfg?.version === "string" ? cfg.version : undefined,
    versionCode:
      typeof cfg?.android?.versionCode === "number" ? cfg.android.versionCode : undefined,
    androidPackage:
      typeof cfg?.android?.package === "string" ? cfg.android.package : undefined,
    runtimeVersion,
  };
}

/**
 * Point the Android Gradle Plugin at the project's keystore.
 *
 * `android.injected.signing.*` is AGP's own hook — the same one Android Studio
 * uses for "Generate Signed APK" — so nothing in the generated build.gradle has
 * to be patched, and it covers `bundleRelease` (AAB) as well as `assembleRelease`.
 *
 * These go in the generated android/gradle.properties rather than on the gradlew
 * command line **because passwords must never reach a log**: execStream puts the
 * full argv into the error it throws on a non-zero exit, and that message is
 * written to build.log and stored on the build row. The whole android/ directory
 * is regenerated by prebuild and dies with the workspace.
 */
async function writeSigningProperties(androidDir: string, signing: SigningConfig): Promise<void> {
  const stat = await fs.stat(signing.storeFile).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(
      `Keystore file missing at ${signing.storeFile} — re-upload it on the project page`,
    );
  }

  // Gradle reads gradle.properties as a Java .properties file: backslashes and
  // colons are escapes, so anything but a plain value has to be escaped.
  const escape = (value: string) => value.replace(/([\\:=!#])/g, "\\$1");
  const lines = [
    "",
    "# Injected by Axe Build for this run only — never written to your repo.",
    `android.injected.signing.store.file=${escape(signing.storeFile)}`,
    `android.injected.signing.store.password=${escape(signing.storePassword)}`,
    `android.injected.signing.key.alias=${escape(signing.keyAlias)}`,
    `android.injected.signing.key.password=${escape(signing.keyPassword)}`,
    "",
  ].join("\n");

  await fs.appendFile(path.join(androidDir, "gradle.properties"), lines, { mode: 0o600 });
}

/**
 * Report the certificate an APK ended up signed with.
 *
 * Uses apksigner from the SDK's build-tools, which is already on the volume for
 * the build itself. Purely informational: a build that produced an APK is not
 * failed here just because we could not read its signature back.
 *
 * AABs are skipped — apksigner does not read them, and an AAB is signed again
 * by Play anyway.
 */
async function* describeSigner(
  apkPath: string,
  timeoutMs: number,
  signal: AbortSignal,
): AsyncGenerator<string, void, void> {
  const apksigner = await findApksigner();
  if (!apksigner) return;

  let out: string;
  try {
    out = await execCapture(apksigner, ["verify", "--print-certs", apkPath], {
      cwd: path.dirname(apkPath),
      timeoutMs: Math.min(timeoutMs, 60_000),
      signal,
    });
  } catch (err) {
    if (err instanceof BuildCanceled) throw err;
    yield `    (could not read the APK signature back — the artifact itself is fine)`;
    return;
  }

  const subject = out.match(/Signer #1 certificate DN: (.+)/)?.[1]?.trim();
  const sha256 = out.match(/Signer #1 certificate SHA-256 digest: (\w+)/)?.[1];
  if (subject) yield `==> Signed by: ${subject}`;
  if (sha256) yield `    SHA-256: ${sha256}`;
  // The debug key Gradle generates always carries this DN. Worth naming plainly:
  // it is the difference between an app you can update and one you cannot.
  if (subject?.includes("CN=Android Debug")) {
    yield `    This is Gradle's throwaway debug key — upload a keystore on the ` +
      `project page before giving this build to anyone.`;
  }
}

/** Newest build-tools copy of apksigner on the SDK volume, if the SDK is there at all. */
async function findApksigner(): Promise<string | null> {
  const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME ?? "/opt/android-sdk";
  const buildTools = path.join(sdk, "build-tools");
  const versions = await fs.readdir(buildTools).catch(() => null);
  if (!versions?.length) return null;

  for (const version of versions.sort().reverse()) {
    const candidate = path.join(buildTools, version, "apksigner");
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

/** The dir containing package.json — either the workspace root or its single subdir. */
async function findProjectDir(ws: string): Promise<string> {
  if (await exists(path.join(ws, "package.json"))) return ws;
  const entries = await fs.readdir(ws, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1) {
    const inner = path.join(ws, dirs[0].name);
    if (await exists(path.join(inner, "package.json"))) return inner;
  }
  throw new Error("No package.json found in the uploaded tarball");
}

async function findArtifact(dir: string, ext: string): Promise<string | null> {
  if (!(await exists(dir))) return null;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  // Files first so e.g. outputs/apk/release/app-release.apk wins at its level.
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(ext)) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = await findArtifact(path.join(dir, e.name), ext);
      if (found) return found;
    }
  }
  return null;
}
