import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface GlobalConfig {
  url: string;
  token: string;
}

export interface ProjectConfig {
  projectSlug: string;
}

/**
 * Where the CLI keeps its two pieces of state.
 *
 * The project was called "mybuild" before it was called Axe Build. New files
 * are written under the new names; the old ones are still *read* when they are
 * the only thing present, so an existing checkout keeps working without being
 * re-linked. Nothing migrates automatically — moving somebody's files behind
 * their back is worse than reading two paths.
 */
const CONFIG_DIR = path.join(os.homedir(), ".axebuild");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".mybuild", "config.json");

const PROJECT_CONFIG = "axe.json";
const LEGACY_PROJECT_CONFIG = "mybuild.json";

/** The first path that exists, or null. */
function firstExisting(...candidates: string[]): string | null {
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

export function saveGlobalConfig(cfg: GlobalConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

export function loadGlobalConfig(): GlobalConfig {
  const found = firstExisting(CONFIG_PATH, LEGACY_CONFIG_PATH);
  if (!found) {
    throw new Error(`Not logged in. Run: axe login <server-url> --token <token>`);
  }
  return JSON.parse(fs.readFileSync(found, "utf8"));
}

export function saveProjectConfig(cwd: string, cfg: ProjectConfig): void {
  fs.writeFileSync(path.join(cwd, PROJECT_CONFIG), JSON.stringify(cfg, null, 2) + "\n");
}

export function loadProjectConfig(cwd: string): ProjectConfig {
  const found = firstExisting(
    path.join(cwd, PROJECT_CONFIG),
    path.join(cwd, LEGACY_PROJECT_CONFIG),
  );
  if (!found) {
    throw new Error(`No ${PROJECT_CONFIG} in this directory. Run: axe init`);
  }
  return JSON.parse(fs.readFileSync(found, "utf8"));
}
