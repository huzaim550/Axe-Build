import { db } from "@mybuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";

/**
 * Promote (or retire) a build. Nothing is served to phones until this runs, so
 * a green build is never automatically live.
 *
 * POST body (all optional):
 *   { "apk": true|false, "update": true|false }
 * Omitted flags default to "promote whatever this build actually has".
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const build = await db().build.findUnique({ where: { id } });
  if (!build) return Response.json({ error: "build not found" }, { status: 404 });
  if (build.status !== "success") {
    return Response.json({ error: "only successful builds can be released" }, { status: 400 });
  }

  const wantApk = typeof body.apk === "boolean" ? body.apk : Boolean(build.artifactPath);
  const wantUpdate =
    typeof body.update === "boolean" ? body.update : Boolean(build.updateDirPath);

  if (wantApk && !build.artifactPath) {
    return Response.json({ error: "this build has no APK/AAB to release" }, { status: 400 });
  }
  if (wantUpdate && !build.updateDirPath) {
    return Response.json(
      { error: "this build has no update bundle — rebuild with --ota or --type update" },
      { status: 400 },
    );
  }

  await db().$transaction(async (tx) => {
    // Exactly one release per role per channel. The OTA demotion is additionally
    // scoped to the same runtimeVersion, so shipping an update for 1.4.0 leaves
    // the 1.3.0 bundle in place for phones still on that binary.
    if (wantApk) {
      await tx.build.updateMany({
        where: { projectId: build.projectId, channel: build.channel, releasedApk: true },
        data: { releasedApk: false },
      });
    }
    if (wantUpdate) {
      await tx.build.updateMany({
        where: {
          projectId: build.projectId,
          channel: build.channel,
          releasedUpdate: true,
          runtimeVersion: build.runtimeVersion,
        },
        data: { releasedUpdate: false },
      });
    }
    await tx.build.update({
      where: { id },
      data: { releasedApk: wantApk, releasedUpdate: wantUpdate },
    });
  });

  return Response.json({
    buildId: id,
    channel: build.channel,
    releasedApk: wantApk,
    releasedUpdate: wantUpdate,
    versionName: build.versionName,
    versionCode: build.versionCode,
    runtimeVersion: build.runtimeVersion,
  });
}
