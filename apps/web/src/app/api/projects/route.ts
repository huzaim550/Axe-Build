import { db } from "@mybuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const projects = await db().project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { builds: true } } },
  });
  return Response.json(projects);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project";

  let slug = base;
  while (await db().project.findUnique({ where: { slug } })) {
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const project = await db().project.create({ data: { name, slug } });
  return Response.json({ id: project.id, slug: project.slug, name: project.name }, { status: 201 });
}
