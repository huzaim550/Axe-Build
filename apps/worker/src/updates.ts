import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Precomputed metadata for one file in an `expo export` output, in the shape
 * the Expo Updates protocol wants. See writeUpdateManifest for why this is
 * computed here in the worker rather than in the web container.
 */
export interface UpdateAsset {
  /** Path relative to the update directory — what the assets endpoint resolves. */
  path: string;
  /** Stable unique id for client-side caching: md5 hex of the file contents. */
  key: string;
  /** base64url-encoded SHA-256 of the file contents (unpadded). */
  hash: string;
  contentType: string;
  fileExtension: string;
}

export interface UpdateManifestFile {
  launchAsset: UpdateAsset;
  assets: UpdateAsset[];
}

/** Written next to the export output; read verbatim by the manifest endpoint. */
export const UPDATE_MANIFEST_FILE = ".mybuild-update-manifest.json";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  json: "application/json",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

/**
 * Turn `expo export`'s metadata.json into the per-file hashes the update
 * manifest needs, and store the result inside the export directory.
 *
 * This runs in the worker on purpose: the web container mounts the artifacts
 * volume read-only, so it cannot cache anything, and hashing a multi-MB bundle
 * plus every asset on every manifest poll would be pure waste.
 */
export async function writeUpdateManifest(updateDir: string): Promise<void> {
  const metadataPath = path.join(updateDir, "metadata.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  const platform = metadata?.fileMetadata?.android;
  if (!platform?.bundle) {
    throw new Error("expo export produced no android bundle in metadata.json");
  }

  const launchAsset = await describe(updateDir, platform.bundle, "application/javascript");
  const assets: UpdateAsset[] = [];
  for (const asset of platform.assets ?? []) {
    const ext = String(asset.ext ?? "").replace(/^\./, "");
    assets.push(
      await describe(updateDir, asset.path, CONTENT_TYPES[ext] ?? "application/octet-stream", ext),
    );
  }

  const out: UpdateManifestFile = { launchAsset, assets };
  await fs.writeFile(path.join(updateDir, UPDATE_MANIFEST_FILE), JSON.stringify(out));
}

async function describe(
  updateDir: string,
  relPath: string,
  contentType: string,
  ext?: string,
): Promise<UpdateAsset> {
  const bytes = await fs.readFile(path.join(updateDir, relPath));
  return {
    path: relPath,
    key: crypto.createHash("md5").update(bytes).digest("hex"),
    hash: crypto.createHash("sha256").update(bytes).digest("base64url"),
    contentType,
    fileExtension: ext ? `.${ext}` : path.extname(relPath),
  };
}
