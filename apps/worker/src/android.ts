import fs from "node:fs/promises";
import path from "node:path";
import { execStream } from "./exec.js";
import type { BuildSpec, Runner, RunnerResult } from "./runner.js";

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

    yield `==> Extracting source tarball`;
    yield* execStream("tar", ["-xzf", spec.tarballPath, "-C", ws], {
      cwd: ws,
      timeoutMs: remaining(),
    });

    // Tolerate tarballs that wrap everything in a single top-level directory.
    const projectDir = await findProjectDir(ws);
    yield `==> Project root: ${path.relative(ws, projectDir) || "."}`;

    yield `==> Installing dependencies (npm)`;
    const hasLockfile = await exists(path.join(projectDir, "package-lock.json"));
    yield* execStream("npm", [hasLockfile ? "ci" : "install", "--no-audit", "--no-fund"], {
      cwd: projectDir,
      timeoutMs: remaining(),
    });

    yield `==> Generating android project (expo prebuild)`;
    yield* execStream(
      "npx",
      ["expo", "prebuild", "--platform", "android", "--no-install"],
      { cwd: projectDir, timeoutMs: remaining() },
    );

    const androidDir = path.join(projectDir, "android");
    const gradlew = path.join(androidDir, "gradlew");
    await fs.chmod(gradlew, 0o755);

    const task = GRADLE_TASKS[`${spec.buildType}/${spec.profile}`];
    if (!task) throw new Error(`Unsupported build: ${spec.buildType}/${spec.profile}`);

    yield `==> Running Gradle: ${task}`;
    yield* execStream("./gradlew", [task, "--no-daemon", "--stacktrace"], {
      cwd: androidDir,
      timeoutMs: remaining(),
    });

    const ext = spec.buildType === "aab" ? ".aab" : ".apk";
    const outputsDir = path.join(androidDir, "app", "build", "outputs");
    const artifact = await findArtifact(outputsDir, ext);
    if (!artifact) {
      throw new Error(`Gradle finished but no ${ext} found under ${outputsDir}`);
    }
    yield `==> Artifact: ${path.relative(ws, artifact)}`;

    return { artifactSourcePath: artifact };
  }
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
