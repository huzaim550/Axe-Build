import fsp from "node:fs/promises";
import path from "node:path";

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? "/data/artifacts";
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/data/uploads";

/** True when `target` is the given root or lives inside it. */
function isInside(root: string, target: string): boolean {
  const a = path.resolve(root);
  const b = path.resolve(target);
  return b === a || b.startsWith(a + path.sep);
}

/**
 * Everything one build owns on disk.
 *
 * The worker puts all of it under `<ARTIFACTS_DIR>/<buildId>` (the APK, the
 * build log and the exported update bundle) plus the uploaded source tarball at
 * `<UPLOADS_DIR>/<buildId>.tgz` — so removing a build is two paths, not a hunt
 * through the schema.
 *
 * Both are checked against their root before anything is removed. The id comes
 * out of a URL, and `rm -rf` on a path assembled from a URL is exactly the bug
 * that ruins a machine.
 */
export async function removeBuildFiles(
  buildId: string,
  tarballPath: string | null,
): Promise<{ bytesFreed: number }> {
  let bytesFreed = 0;

  const artifactDir = path.join(ARTIFACTS_DIR, buildId);
  if (isInside(ARTIFACTS_DIR, artifactDir) && artifactDir !== path.resolve(ARTIFACTS_DIR)) {
    bytesFreed += await dirSize(artifactDir);
    await fsp.rm(artifactDir, { recursive: true, force: true });
  }

  if (tarballPath && isInside(UPLOADS_DIR, tarballPath)) {
    const stat = await fsp.stat(tarballPath).catch(() => null);
    if (stat?.isFile()) {
      bytesFreed += stat.size;
      await fsp.rm(tarballPath, { force: true });
    }
  }

  return { bytesFreed };
}

/** Best-effort recursive size. A missing directory is simply zero. */
async function dirSize(dir: string): Promise<number> {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return 0;

  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else {
      const stat = await fsp.stat(full).catch(() => null);
      total += stat?.size ?? 0;
    }
  }
  return total;
}
