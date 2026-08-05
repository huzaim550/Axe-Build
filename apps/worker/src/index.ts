import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { db } from "@axebuild/db";
import { AndroidRunner } from "./android.js";
import { BuildCanceled } from "./exec.js";
import type { BuildSpec } from "./runner.js";
import { writeUpdateManifest } from "./updates.js";

const WORKSPACES_DIR = process.env.WORKSPACES_DIR ?? "/workspaces";
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? "/data/artifacts";
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS ?? 60 * 60 * 1000);

/** Redis channel the web app publishes a build id on to stop it. */
const CANCEL_CHANNEL = "builds:cancel";

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://redis:6379");
  return { host: url.hostname, port: Number(url.port || 6379) };
}

// Single long-lived publisher for the process (concurrency is 1, so no fan-out needed).
const publisher = new Redis(redisConnection());

function publishLog(buildId: string, line: string): void {
  publisher.publish(`logs:${buildId}`, JSON.stringify({ type: "log", line })).catch((err) => {
    console.error(`[${buildId}] log publish failed:`, err);
  });
}

/**
 * The build being processed right now, if any. Concurrency is 1, so one slot is
 * the whole registry — a cancel message either matches it or refers to a build
 * that is still queued (which the web app cancels itself, by dropping the job).
 */
let current: { buildId: string; abort: AbortController } | null = null;

function publishDone(buildId: string, status: string): void {
  publisher.publish(`logs:${buildId}`, JSON.stringify({ type: "done", status })).catch((err) => {
    console.error(`[${buildId}] done publish failed:`, err);
  });
}

/** The web container runs `prisma db push` on startup; wait until the schema exists. */
async function waitForDb(): Promise<void> {
  const deadline = Date.now() + 2 * 60 * 1000;
  for (;;) {
    try {
      await db().build.count();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      console.log("Waiting for database schema...");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function processBuild(job: Job<{ buildId: string }>): Promise<void> {
  const { buildId } = job.data;
  const build = await db().build.findUnique({
    where: { id: buildId },
    // The upload key, if this project has one. Only aab builds use it.
    include: { project: { include: { keystore: true } } },
  });
  if (!build) {
    console.error(`Build ${buildId} not found in DB, skipping`);
    return;
  }
  if (build.status !== "queued") {
    console.log(`Build ${buildId} is ${build.status}, skipping`);
    return;
  }

  const buildArtifactsDir = path.join(ARTIFACTS_DIR, buildId);
  await fsp.mkdir(buildArtifactsDir, { recursive: true });
  const logPath = path.join(buildArtifactsDir, "build.log");
  const log = fs.createWriteStream(logPath, { flags: "a" });

  const workspaceDir = await fsp.mkdtemp(path.join(WORKSPACES_DIR, `${buildId}-`));

  // Registered BEFORE the row says "running", and everything after this point
  // is inside the try/finally that clears it. The web app cancels a `queued`
  // build itself and only falls back to us once it sees "running" — if that
  // flip happened first, a cancel arriving in between would find no build to
  // abort and be dropped on the floor while the dashboard said "canceling".
  const abort = new AbortController();
  current = { buildId, abort };

  try {
    await db().build.update({
      where: { id: buildId },
      data: { status: "running", startedAt: new Date(), logPath },
    });
    console.log(`[${buildId}] started in ${workspaceDir}`);

    const spec: BuildSpec = {
      buildId,
      tarballPath: build.tarballPath,
      buildType:
        build.buildType === "aab" ? "aab" : build.buildType === "update" ? "update" : "apk",
      profile: build.profile === "debug" ? "debug" : "release",
      abis: build.abi || "arm64-v8a",
      ota: build.ota,
      workspaceDir,
      deadline: Date.now() + BUILD_TIMEOUT_MS,
      signal: abort.signal,
      // aab only. Signing the APKs with this key as well would change the
      // signature of the sideloaded flavour, and Android refuses an update
      // signed by a different key -- every existing install would have to be
      // removed and reinstalled the first time a keystore was uploaded.
      keystore:
        build.buildType === "aab" && build.project?.keystore
          ? {
              path: build.project.keystore.path,
              keyAlias: build.project.keystore.keyAlias,
              storePassword: build.project.keystore.storePassword,
              keyPassword: build.project.keystore.keyPassword,
            }
          : undefined,
    };

    const runner = new AndroidRunner();
    const gen = runner.run(spec);
    let step = await gen.next();
    while (!step.done) {
      log.write(step.value + "\n");
      publishLog(buildId, step.value);
      step = await gen.next();
    }
    const result = step.value;

    // An OTA-only build has no APK, so artifact fields stay null.
    let artifactPath: string | undefined;
    let size: number | undefined;
    if (result.artifactSourcePath) {
      artifactPath = path.join(buildArtifactsDir, path.basename(result.artifactSourcePath));
      await fsp.copyFile(result.artifactSourcePath, artifactPath);
      size = (await fsp.stat(artifactPath)).size;
    }

    // The update bundle must outlive the workspace (deleted in `finally`), so
    // it moves onto the artifacts volume next to the APK and the log.
    let updateDirPath: string | undefined;
    let updateUuid: string | undefined;
    if (result.updateSourceDir) {
      updateDirPath = path.join(buildArtifactsDir, "update");
      await fsp.cp(result.updateSourceDir, updateDirPath, { recursive: true });
      // Hash every file now: the web container mounts artifacts read-only and
      // must not re-hash the bundle on each manifest poll.
      await writeUpdateManifest(updateDirPath);
      // Expo manifests require a UUID `id`; cuid would be rejected by the client.
      updateUuid = crypto.randomUUID();
    }

    await db().build.update({
      where: { id: buildId },
      data: {
        status: "success",
        artifactPath,
        sizeBytes: size,
        updateDirPath,
        updateUuid,
        versionName: result.meta.versionName,
        versionCode: result.meta.versionCode,
        androidPackage: result.meta.androidPackage,
        runtimeVersion: result.meta.runtimeVersion,
        finishedAt: new Date(),
      },
    });
    const successLine = size
      ? `==> SUCCESS (${(size / 1024 / 1024).toFixed(1)} MB)`
      : `==> SUCCESS (update bundle only)`;
    log.write(successLine + "\n");
    publishLog(buildId, successLine);
    publishDone(buildId, "success");
    console.log(`[${buildId}] success: ${artifactPath ?? updateDirPath}`);
  } catch (err) {
    // A cancelled build is not a failed one: nothing is wrong with the source,
    // so it must not show up red among the builds that genuinely broke.
    const canceled = err instanceof BuildCanceled || abort.signal.aborted;
    const message = err instanceof Error ? err.message : String(err);

    if (canceled) {
      const line = `==> CANCELED`;
      log.write(line + "\n");
      publishLog(buildId, line);
      await db().build.update({
        where: { id: buildId },
        data: {
          status: "canceled",
          error: "Canceled from the dashboard",
          finishedAt: new Date(),
        },
      });
      publishDone(buildId, "canceled");
      console.log(`[${buildId}] canceled`);
    } else {
      const failedLine = `==> FAILED: ${message}`;
      log.write(failedLine + "\n");
      publishLog(buildId, failedLine);
      await db().build.update({
        where: { id: buildId },
        data: { status: "failed", error: message.slice(0, 2000), finishedAt: new Date() },
      });
      publishDone(buildId, "failed");
      console.error(`[${buildId}] failed: ${message}`);
    }
  } finally {
    current = null;
    log.end();
    // Machine safety: the workspace is ALWAYS deleted, success or failure.
    await fsp.rm(workspaceDir, { recursive: true, force: true }).catch((e) => {
      console.error(`[${buildId}] workspace cleanup failed:`, e);
    });
  }
}

/**
 * Listen for cancel requests.
 *
 * ioredis connections in subscriber mode can't run normal commands, so this is
 * a second connection alongside `publisher`. A message for a build we aren't
 * running is ignored: it was still queued, and the web app cancels those by
 * dropping the job from the queue, where the worker never sees them at all.
 */
async function subscribeToCancels(): Promise<Redis> {
  const subscriber = new Redis(redisConnection());
  await subscriber.subscribe(CANCEL_CHANNEL);
  subscriber.on("message", (_channel, buildId) => {
    if (current && current.buildId === buildId) {
      console.log(`[${buildId}] cancel requested`);
      const line = "==> Cancel requested — stopping the build";
      publishLog(buildId, line);
      current.abort.abort();
    }
  });
  return subscriber;
}

async function main() {
  await waitForDb();

  const cancels = await subscribeToCancels();

  const worker = new Worker<{ buildId: string }>("builds", processBuild, {
    connection: redisConnection(),
    concurrency: 1, // Gradle is memory-hungry; one build at a time, always.
  });

  worker.on("ready", () => console.log("Worker ready, waiting for builds"));
  worker.on("failed", (job, err) => console.error(`Job ${job?.id} failed:`, err.message));

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    await worker.close();
    cancels.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
