import { createReadStream } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { db } from "@mybuild/db";
import { safeAssetPath } from "@/lib/updates";

export const dynamic = "force-dynamic";

/**
 * Serves one file out of a build's `expo export` output — the URLs handed out
 * by the manifest endpoint point here.
 *
 * PUBLIC (no token) — see the note in @/lib/updates. Because it is public,
 * the `asset` param is checked for containment before anything is opened.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const buildId = url.searchParams.get("buildId");
  const asset = url.searchParams.get("asset");

  if (!buildId || !asset) {
    return Response.json({ error: "buildId and asset are required" }, { status: 400 });
  }

  const build = await db().build.findFirst({
    where: { id: buildId, project: { slug }, releasedUpdate: true },
  });
  if (!build?.updateDirPath) {
    return Response.json({ error: "no released update bundle for this build" }, { status: 404 });
  }

  const filePath = safeAssetPath(build.updateDirPath, asset);
  if (!filePath) {
    return Response.json({ error: "invalid asset path" }, { status: 400 });
  }

  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    return Response.json({ error: "asset not found" }, { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": contentTypeFor(filePath),
      "content-length": String(stat.size),
      // Assets are content-addressed by the manifest, so they never change.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

const CONTENT_TYPES: Record<string, string> = {
  ".hbc": "application/javascript",
  ".js": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}
