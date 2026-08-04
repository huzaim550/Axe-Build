import { db } from "@axebuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";

/**
 * Delete an empty project.
 *
 * Only ever empty ones: a project with builds owns artifacts on disk and, if
 * anything was released, an APK that installed apps are still polling for. That
 * is a per-build decision (DELETE /api/builds/:id), not something to bulk-drop
 * behind one button. So this exists for exactly one case — the stray project
 * created by a duplicate `axe init` before the CLI learned to refuse one.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { slug } = await params;

  const project = await db().project.findUnique({
    where: { slug },
    include: { _count: { select: { builds: true, notifications: true } }, keystore: true },
  });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });

  const { builds, notifications } = project._count;
  if (builds > 0 || notifications > 0 || project.keystore) {
    return Response.json(
      {
        error:
          `'${project.slug}' is not empty (${builds} build(s), ${notifications} notification(s)). ` +
          `Delete its builds first.`,
      },
      { status: 409 },
    );
  }

  await db().project.delete({ where: { id: project.id } });
  return Response.json({ deleted: project.slug });
}
