import fs from "node:fs/promises";
import path from "node:path";
import { BuildCanceled, execCapture, execStream } from "./exec.js";
import type { AppMeta, BuildSpec, Runner, RunnerResult } from "./runner.js";

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
