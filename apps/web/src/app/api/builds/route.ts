import fsp from "node:fs/promises";
import path from "node:path";
import { db } from "@mybuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { buildQueue } from "@/lib/queue";

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/data/uploads";
const MAX_TARBALL_BYTES = 200 * 1024 * 1024;

// Every extra ABI means compiling the whole native (C++) module graph again, so
// the default is the one architecture essentially every modern phone uses.
const ALL_ABIS = "armeabi-v7a,arm64-v8a,x86,x86_64";
const ABI_PRESETS: Record<string, string> = {
  "arm64-v8a": "arm64-v8a",
  "arm64-v8a,armeabi-v7a": "arm64-v8a,armeabi-v7a",
  all: ALL_ABIS,
};

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
  const abiInput = String(form.get("abi") ?? "arm64-v8a");
  const ota = String(form.get("ota") ?? "") === "1";
  const tarball = form.get("tarball");

  if (!["apk", "aab", "update"].includes(buildType)) {
    return Response.json({ error: "buildType must be apk, aab or update" }, { status: 400 });
  }
  if (!["release", "debug"].includes(profile)) {
    return Response.json({ error: "profile must be release or debug" }, { status: 400 });
  }
  const abi = ABI_PRESETS[abiInput];
  if (!abi) {
    return Response.json(
      { error: `abi must be one of: ${Object.keys(ABI_PRESETS).join(", ")}` },
      { status: 400 },
    );
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
      abi,
      // An "update" build always produces a bundle; for apk/aab it's opt-in
      // because `expo export` adds ~a minute to a build that may not need it.
      ota: buildType === "update" ? true : ota,
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
