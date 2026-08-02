import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";

// Mirror the EAS trick: never upload node_modules or generated native projects —
// the worker runs npm ci + expo prebuild itself.
const EXCLUDED = new Set([
  "node_modules",
  ".git",
  "android",
  "ios",
  ".expo",
  "dist",
  "build",
  "web-build",
  "axe.json",
  "mybuild.json",
]);

export async function packProject(projectDir: string): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "axebuild-"));
  const tarPath = path.join(tmp, "project.tgz");

  await tar.create(
    {
      gzip: true,
      file: tarPath,
      cwd: projectDir,
      portable: true,
      filter: (p) => {
        // tar paths look like "./src/App.tsx"; check the first real segment
        const segments = p.replace(/^\.\/?/, "").split("/");
        const first = segments[0];
        if (!first) return true;
        if (EXCLUDED.has(first)) return false;
        if (first.endsWith(".tgz") || first.endsWith(".apk") || first.endsWith(".aab")) return false;
        return true;
      },
    },
    ["."],
  );

  return tarPath;
}
