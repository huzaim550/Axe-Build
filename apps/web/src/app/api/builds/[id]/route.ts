import { db } from "@axebuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { removeBuildFiles } from "@/lib/storage";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await params;
  const build = await db().build.findUnique({
    where: { id },
    include: { project: { select: { name: true, slug: true } } },
  });
  if (!build) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(build);
}

/**
 * Delete a build: its row, its artifacts, its log and its source tarball.
 *
 * Two things it refuses to do on its own, because both break something outside
 * this server:
 *
 *  - A **queued or running** build is owned by the worker. Deleting the row
 *    from under a running job leaves it writing into a directory that no longer
 *    has a build to belong to.
 *  - A **released** build is what `/api/apps/:slug/latest` and the OTA manifest
 *    are currently serving. Deleting it means installed apps stop finding an
 *    update — so it takes `?force=1`, which is the dashboard's "delete anyway"
 *    confirmation and nothing cleverer than that.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "1";

  const build = await db().build.findUnique({ where: { id } });
  if (!build) return Response.json({ error: "build not found" }, { status: 404 });

  if (build.status === "queued" || build.status === "running") {
    return Response.json(
      { error: "this build is still queued or running — wait for it to finish" },
      { status: 409 },
    );
  }

  const wasReleased = build.releasedApk || build.releasedUpdate;
  if (wasReleased && !force) {
    return Response.json(
      {
        error:
          "this build is live — installed apps are served from it. Unrelease it first, or confirm to delete anyway.",
        released: true,
      },
      { status: 409 },
    );
  }

  // Files first: a failure here leaves a row you can retry the delete on,
  // whereas dropping the row first would lose the paths and orphan gigabytes.
  const { bytesFreed } = await removeBuildFiles(build.id, build.tarballPath || null);
  await db().build.delete({ where: { id } });

  return Response.json({ deleted: id, bytesFreed, wasReleased });
}
