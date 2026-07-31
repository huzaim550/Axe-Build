import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { db } from "@mybuild/db";
import { AndroidRunner } from "./android.js";
import type { BuildSpec } from "./runner.js";

const WORKSPACES_DIR = process.env.WORKSPACES_DIR ?? "/workspaces";
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? "/data/artifacts";
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS ?? 60 * 60 * 1000);

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
  const build = await db().build.findUnique({ where: { id: buildId } });
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

  await db().build.update({
    where: { id: buildId },
    data: { status: "running", startedAt: new Date(), logPath },
  });

  const workspaceDir = await fsp.mkdtemp(path.join(WORKSPACES_DIR, `${buildId}-`));
  console.log(`[${buildId}] started in ${workspaceDir}`);

  try {
    const spec: BuildSpec = {
      buildId,
      tarballPath: build.tarballPath,
      buildType: build.buildType === "aab" ? "aab" : "apk",
      profile: build.profile === "debug" ? "debug" : "release",
      workspaceDir,
      deadline: Date.now() + BUILD_TIMEOUT_MS,
    };

    const runner = new AndroidRunner();
    const gen = runner.run(spec);
    let step = await gen.next();
    while (!step.done) {
      log.write(step.value + "\n");
      publishLog(buildId, step.value);
      step = await gen.next();
    }

    const src = step.value.artifactSourcePath;
    const artifactPath = path.join(buildArtifactsDir, path.basename(src));
    await fsp.copyFile(src, artifactPath);
    const { size } = await fsp.stat(artifactPath);

    await db().build.update({
      where: { id: buildId },
      data: {
        status: "success",
        artifactPath,
        sizeBytes: size,
        finishedAt: new Date(),
      },
    });
    const successLine = `==> SUCCESS (${(size / 1024 / 1024).toFixed(1)} MB)`;
    log.write(successLine + "\n");
    publishLog(buildId, successLine);
    publishDone(buildId, "success");
    console.log(`[${buildId}] success: ${artifactPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedLine = `==> FAILED: ${message}`;
    log.write(failedLine + "\n");
    publishLog(buildId, failedLine);
    await db().build.update({
      where: { id: buildId },
      data: { status: "failed", error: message.slice(0, 2000), finishedAt: new Date() },
    });
    publishDone(buildId, "failed");
    console.error(`[${buildId}] failed: ${message}`);
  } finally {
    log.end();
    // Machine safety: the workspace is ALWAYS deleted, success or failure.
    await fsp.rm(workspaceDir, { recursive: true, force: true }).catch((e) => {
      console.error(`[${buildId}] workspace cleanup failed:`, e);
    });
  }
}

async function main() {
  await waitForDb();

  const worker = new Worker<{ buildId: string }>("builds", processBuild, {
    connection: redisConnection(),
    concurrency: 1, // Gradle is memory-hungry; one build at a time, always.
  });

  worker.on("ready", () => console.log("Worker ready, waiting for builds"));
  worker.on("failed", (job, err) => console.error(`Job ${job?.id} failed:`, err.message));

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    await worker.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
