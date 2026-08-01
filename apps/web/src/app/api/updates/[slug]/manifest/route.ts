import fsp from "node:fs/promises";
import path from "node:path";
import {
  baseUrl,
  findReleasedUpdate,
  multipartResponse,
} from "@/lib/updates";

export const dynamic = "force-dynamic";

/** Mirrors apps/worker/src/updates.ts — written there, read here. */
const UPDATE_MANIFEST_FILE = ".mybuild-update-manifest.json";

interface UpdateAsset {
  path: string;
  key: string;
  hash: string;
  contentType: string;
  fileExtension: string;
}

/**
 * Expo Updates protocol v1 manifest endpoint. Point an app at
 *   http://<server>:3000/api/updates/<slug>/manifest
 * via expo.updates.url and it polls here on launch.
 *
 * PUBLIC (no token) — see the note in @/lib/updates.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);

  const platform = req.headers.get("expo-platform") ?? url.searchParams.get("platform");
  const runtimeVersion =
    req.headers.get("expo-runtime-version") ?? url.searchParams.get("runtime-version");
  const channel =
    req.headers.get("expo-channel-name") ?? url.searchParams.get("channel") ?? "production";
  // Absent means the old protocol, which answers with bare JSON and a 204 for
  // "nothing new" instead of multipart + a directive.
  const protocolVersion = Number(req.headers.get("expo-protocol-version") ?? "0");

  if (platform !== "android") {
    return Response.json({ error: "only the android platform is supported" }, { status: 400 });
  }
  if (!runtimeVersion) {
    return Response.json({ error: "expo-runtime-version header is required" }, { status: 400 });
  }

  const build = await findReleasedUpdate(slug, channel, runtimeVersion);
  if (!build?.updateDirPath || !build.updateUuid) {
    return noUpdateAvailable(protocolVersion);
  }

  let files: { launchAsset: UpdateAsset; assets: UpdateAsset[] };
  try {
    files = JSON.parse(
      await fsp.readFile(path.join(build.updateDirPath, UPDATE_MANIFEST_FILE), "utf8"),
    );
  } catch {
    // The bundle was promoted but its files are gone (volume wiped?). Telling
    // the client "nothing new" is far better than handing it a broken update.
    return noUpdateAvailable(protocolVersion);
  }

  const assetUrl = (asset: UpdateAsset) =>
    `${baseUrl(req)}/api/updates/${encodeURIComponent(slug)}/assets` +
    `?buildId=${encodeURIComponent(build.id)}&asset=${encodeURIComponent(asset.path)}`;

  const manifest = {
    id: build.updateUuid,
    createdAt: (build.finishedAt ?? build.createdAt).toISOString(),
    runtimeVersion: build.runtimeVersion,
    launchAsset: {
      hash: files.launchAsset.hash,
      key: files.launchAsset.key,
      contentType: files.launchAsset.contentType,
      url: assetUrl(files.launchAsset),
    },
    assets: files.assets.map((a) => ({
      hash: a.hash,
      key: a.key,
      contentType: a.contentType,
      fileExtension: a.fileExtension,
      url: assetUrl(a),
    })),
    metadata: {},
    extra: {},
  };

  if (protocolVersion === 0) {
    return Response.json(manifest, {
      headers: { "expo-protocol-version": "0", "cache-control": "private, max-age=0" },
    });
  }
  return multipartResponse("manifest", manifest);
}

function noUpdateAvailable(protocolVersion: number): Response {
  if (protocolVersion === 0) return new Response(null, { status: 204 });
  return multipartResponse("directive", { type: "noUpdateAvailable" });
}
