import fsp from "node:fs/promises";
import path from "node:path";
import { db } from "@axebuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { isBuildType, isProfile, resolveAbi } from "@/lib/build-options";
import { buildQueue } from "@/lib/queue";

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/data/uploads";

/**
 * Run a build again from the source it already has.
 *
 * The uploaded tarball is kept for the life of a build (it is only removed when
 * the build is deleted), so re-running one needs no laptop, no CLI and no
 * upload — which is what you want for a Gradle failure that was really a flaky
 * download, or to add an OTA bundle to source you already shipped.
 *
 * The source is *copied* rather than shared: two rows pointing at one tarball
 * would mean deleting either build pulls the file out from under the other.
 *
 * POST body (all optional, default to the original build's settings):
 *   { "buildType": "apk"|"aab"|"update", "profile": "release"|"debug",
 *     "abi": "arm64-v8a"|"all"|..., "ota": true|false }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await params;

  const source = await db().build.findUnique({ where: { id } });
  if (!source) return Response.json({ error: "build not found" }, { status: 404 });

  const stat = await fsp.stat(source.tarballPath).catch(() => null);
  if (!stat?.isFile()) {
    return Response.json(
      { error: "the source upload for this build is gone — run `axe build` again" },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));

  const buildType = body.buildType === undefined ? source.buildType : body.buildType;
  if (!isBuildType(buildType)) {
    return Response.json({ error: "buildType must be apk, aab or update" }, { status: 400 });
  }
  const profile = body.profile === undefined ? source.profile : body.profile;
  if (!isProfile(profile)) {
    return Response.json({ error: "profile must be release or debug" }, { status: 400 });
  }
  const abi = resolveAbi(String(body.abi ?? source.abi));
  if (!abi) return Response.json({ error: "unknown abi" }, { status: 400 });
  const ota = typeof body.ota === "boolean" ? body.ota : source.ota;

  const build = await db().build.create({
    data: {
      projectId: source.projectId,
      status: "queued",
      buildType,
      profile,
      abi,
      ota: buildType === "update" ? true : ota,
      channel: source.channel,
      tarballPath: "", // set below once the id names the file
    },
  });

  // Copy before enqueueing: a job whose tarball is still being written would
  // race the worker into an empty file.
  const tarballPath = path.join(UPLOADS_DIR, `${build.id}.tgz`);
  try {
    await fsp.mkdir(UPLOADS_DIR, { recursive: true });
    await fsp.copyFile(source.tarballPath, tarballPath);
  } catch (err) {
    // Leaving a queued row with no source would be a build that can only fail.
    await db().build.delete({ where: { id: build.id } }).catch(() => {});
    throw err;
  }
  await db().build.update({ where: { id: build.id }, data: { tarballPath } });

  await buildQueue().add(
    "build",
    { buildId: build.id },
    { jobId: build.id, removeOnComplete: true, removeOnFail: true },
  );

  return Response.json({ buildId: build.id, from: source.id }, { status: 201 });
}
