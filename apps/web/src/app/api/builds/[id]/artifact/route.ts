import { createReadStream } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { db } from "@mybuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await params;

  const build = await db().build.findUnique({ where: { id } });
  if (!build?.artifactPath) {
    return Response.json({ error: "no artifact for this build" }, { status: 404 });
  }

  const stat = await fsp.stat(build.artifactPath).catch(() => null);
  if (!stat) return Response.json({ error: "artifact file missing" }, { status: 404 });

  const filename = path.basename(build.artifactPath);
  const stream = Readable.toWeb(createReadStream(build.artifactPath)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(stat.size),
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
