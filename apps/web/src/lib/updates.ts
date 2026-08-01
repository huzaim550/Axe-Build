import path from "node:path";
import { db } from "@mybuild/db";

/**
 * The update + APK endpoints are the only UNAUTHENTICATED routes besides
 * /api/health. They have to be: an app installed on a phone cannot carry
 * LOCAL_TOKEN, and baking the token into a published APK would be worse than
 * leaving these read-only endpoints open on a LAN-only server. Everything that
 * *changes* state (uploading a build, promoting a release) stays token-gated.
 */

/** The APK that /api/apps/<slug>/latest points at. */
export function findReleasedApk(slug: string, channel: string) {
  return db().build.findFirst({
    where: {
      project: { slug },
      channel,
      releasedApk: true,
      status: "success",
      buildType: { in: ["apk", "aab"] },
      artifactPath: { not: null },
    },
    orderBy: { finishedAt: "desc" },
    include: { project: { select: { slug: true, name: true } } },
  });
}

/**
 * The OTA bundle to serve. runtimeVersion is an exact match on purpose: it is
 * the only thing stopping a JS bundle from landing on an installed binary that
 * lacks the native code it needs.
 */
export function findReleasedUpdate(slug: string, channel: string, runtimeVersion: string) {
  return db().build.findFirst({
    where: {
      project: { slug },
      channel,
      releasedUpdate: true,
      status: "success",
      runtimeVersion,
      updateDirPath: { not: null },
      updateUuid: { not: null },
    },
    orderBy: { finishedAt: "desc" },
  });
}

/**
 * Resolve a client-supplied relative path inside an update directory.
 * Returns null if it escapes — these routes are public, so unlike the
 * token-gated artifact route this check is not optional.
 */
export function safeAssetPath(updateDir: string, relPath: string): string | null {
  const root = path.resolve(updateDir);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/** Absolute base URL for asset links, derived from the request so LAN IPs work. */
export function baseUrl(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Body + headers for a `multipart/mixed` Expo Updates response with one part. */
export function multipartResponse(
  partName: string,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  const boundary = `mybuild${Date.now().toString(36)}`;
  const body =
    `--${boundary}\r\n` +
    `content-disposition: form-data; name="${partName}"\r\n` +
    `content-type: application/json\r\n\r\n` +
    `${JSON.stringify(payload)}\r\n` +
    `--${boundary}--\r\n`;

  return new Response(body, {
    headers: {
      "content-type": `multipart/mixed; boundary=${boundary}`,
      "expo-protocol-version": "1",
      "expo-sfv-version": "0",
      "cache-control": "private, max-age=0",
      ...extraHeaders,
    },
  });
}
