import { createReadStream } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { findReleasedApk } from "@/lib/updates";

export const dynamic = "force-dynamic";

/**
 * Streams the currently released APK. Opening this in Android Chrome makes the
 * download manager offer to install it, which is what lets the update prompt
 * work without REQUEST_INSTALL_PACKAGES and a custom FileProvider.
 *
 * PUBLIC (no token) — see the note in @/lib/updates.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const channel = new URL(req.url).searchParams.get("channel") ?? "production";

  const build = await findReleasedApk(slug, channel);
  if (!build?.artifactPath) {
    return Response.json({ error: "no released build for this project" }, { status: 404 });
  }

  const stat = await fsp.stat(build.artifactPath).catch(() => null);
  if (!stat) return Response.json({ error: "artifact file missing" }, { status: 404 });

  // Name the download after the app + version rather than Gradle's generic
  // app-release.apk, and strip anything that could break the header.
  const ext = build.buildType === "aab" ? "aab" : "apk";
  const filename = safeFilename(
    `${slug}-${build.versionName ?? "unknown"}-${build.versionCode ?? build.id}.${ext}`,
  );

  const stream = Readable.toWeb(createReadStream(build.artifactPath)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type":
        ext === "apk" ? "application/vnd.android.package-archive" : "application/octet-stream",
      "content-length": String(stat.size),
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

function safeFilename(name: string): string {
  return path.basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
}
