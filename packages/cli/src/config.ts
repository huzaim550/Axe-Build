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

const CONFIG_DIR = path.join(os.homedir(), ".mybuild");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const PROJECT_CONFIG = "mybuild.json";

export function saveGlobalConfig(cfg: GlobalConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

export function loadGlobalConfig(): GlobalConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Not logged in. Run: build-cli login <server-url> --token <token>`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

export function saveProjectConfig(cwd: string, cfg: ProjectConfig): void {
  fs.writeFileSync(path.join(cwd, PROJECT_CONFIG), JSON.stringify(cfg, null, 2) + "\n");
}

export function loadProjectConfig(cwd: string): ProjectConfig {
  const p = path.join(cwd, PROJECT_CONFIG);
  if (!fs.existsSync(p)) {
    throw new Error(`No ${PROJECT_CONFIG} in this directory. Run: build-cli init`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
