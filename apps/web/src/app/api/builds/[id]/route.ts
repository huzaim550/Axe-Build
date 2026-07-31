import { db } from "@mybuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";

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
