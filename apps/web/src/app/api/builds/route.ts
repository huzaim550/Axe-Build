import fsp from "node:fs/promises";
import path from "node:path";
import { db } from "@mybuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { buildQueue } from "@/lib/queue";

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/data/uploads";
const MAX_TARBALL_BYTES = 200 * 1024 * 1024;

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const builds = await db().build.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { project: { select: { name: true, slug: true } } },
  });
  return Response.json(builds);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected multipart form data" }, { status: 400 });

  const projectSlug = String(form.get("projectSlug") ?? "");
  const buildType = String(form.get("buildType") ?? "apk");
  const profile = String(form.get("profile") ?? "release");
  const tarball = form.get("tarball");

  if (!["apk", "aab"].includes(buildType)) {
    return Response.json({ error: "buildType must be apk or aab" }, { status: 400 });
  }
  if (!["release", "debug"].includes(profile)) {
    return Response.json({ error: "profile must be release or debug" }, { status: 400 });
  }
  if (!(tarball instanceof File)) {
    return Response.json({ error: "tarball file is required" }, { status: 400 });
  }
  if (tarball.size > MAX_TARBALL_BYTES) {
    return Response.json({ error: "tarball too large (did you exclude node_modules?)" }, { status: 413 });
  }

  const project = await db().project.findUnique({ where: { slug: projectSlug } });
  if (!project) {
    return Response.json({ error: `unknown project slug: ${projectSlug}` }, { status: 404 });
  }

  const build = await db().build.create({
    data: {
      projectId: project.id,
      status: "queued",
      buildType,
      profile,
      tarballPath: "", // set below once the id names the file
    },
  });

  const tarballPath = path.join(UPLOADS_DIR, `${build.id}.tgz`);
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  await fsp.writeFile(tarballPath, Buffer.from(await tarball.arrayBuffer()));
  await db().build.update({ where: { id: build.id }, data: { tarballPath } });

  await buildQueue().add(
    "build",
    { buildId: build.id },
    { jobId: build.id, removeOnComplete: true, removeOnFail: true },
  );

  return Response.json({ buildId: build.id }, { status: 201 });
}
