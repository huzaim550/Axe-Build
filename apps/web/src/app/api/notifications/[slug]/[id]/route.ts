import { db } from "@mybuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { toWire } from "@/lib/notifications";

/**
 * Retract a notification. Token-gated.
 *
 * The row is kept and only flipped inactive, so the dashboard still shows what
 * was sent. Apps stop serving it on their next poll — but an app that already
 * fetched it keeps its copy: nothing can reach into a device and delete a
 * message it has already been shown, and pretending otherwise would be a lie.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  if (!isAuthorized(req)) return unauthorized();
  const { slug, id } = await params;

  const found = await db().notification.findFirst({
    where: { id, project: { slug } },
  });
  if (!found) return Response.json({ error: "notification not found" }, { status: 404 });

  const updated = await db().notification.update({
    where: { id },
    data: { active: false },
  });
  return Response.json(toWire(updated));
}
