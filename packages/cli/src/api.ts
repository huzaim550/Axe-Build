import type { GlobalConfig } from "./config.js";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request(cfg: GlobalConfig, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(new URL(path, cfg.url), {
    ...init,
    headers: { authorization: `Bearer ${cfg.token}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status);
  }
  return body;
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
}

export function listProjects(cfg: GlobalConfig): Promise<ProjectSummary[]> {
  return request(cfg, "/api/projects");
}

export function createProject(cfg: GlobalConfig, name: string) {
  return request(cfg, "/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function getBuild(cfg: GlobalConfig, id: string) {
  return request(cfg, `/api/builds/${id}`);
}

export interface BuildSummary {
  id: string;
  status: string;
  buildType: string;
  createdAt: string;
  project?: { slug: string; name: string };
}

/** 100 most recent builds across every project, newest first. */
export function listBuilds(cfg: GlobalConfig): Promise<BuildSummary[]> {
  return request(cfg, "/api/builds");
}

export interface KeystoreStatus {
  configured: boolean;
  keyAlias?: string;
  file?: string;
}

export function getKeystore(cfg: GlobalConfig, slug: string): Promise<KeystoreStatus> {
  return request(cfg, `/api/projects/${slug}/keystore`);
}

export function setKeystore(
  cfg: GlobalConfig,
  slug: string,
  ks: { file: Buffer; filename: string; keyAlias: string; storePassword: string; keyPassword?: string },
): Promise<KeystoreStatus> {
  const form = new FormData();
  form.set("keystore", new Blob([new Uint8Array(ks.file)]), ks.filename);
  form.set("keyAlias", ks.keyAlias);
  form.set("storePassword", ks.storePassword);
  // Omitted rather than duplicated: the server falls back to storePassword,
  // which is what pressing Enter at keytool's last prompt produces.
  if (ks.keyPassword) form.set("keyPassword", ks.keyPassword);
  return request(cfg, `/api/projects/${slug}/keystore`, { method: "POST", body: form });
}

export function deleteKeystore(cfg: GlobalConfig, slug: string): Promise<KeystoreStatus> {
  return request(cfg, `/api/projects/${slug}/keystore`, { method: "DELETE" });
}

export function releaseBuild(
  cfg: GlobalConfig,
  id: string,
  what: { apk?: boolean; update?: boolean } = {},
) {
  return request(cfg, `/api/builds/${id}/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(what),
  });
}

export function cancelBuild(
  cfg: GlobalConfig,
  id: string,
  force = false,
): Promise<{ status: string }> {
  return request(cfg, `/api/builds/${id}/cancel${force ? "?force=1" : ""}`, { method: "POST" });
}

export function rebuildBuild(
  cfg: GlobalConfig,
  id: string,
  overrides: { buildType?: string; profile?: string; abi?: string; ota?: boolean } = {},
): Promise<{ buildId: string }> {
  return request(cfg, `/api/builds/${id}/rebuild`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(overrides),
  });
}

export async function uploadBuild(
  cfg: GlobalConfig,
  opts: {
    projectSlug: string;
    buildType: string;
    profile: string;
    abi: string;
    ota: boolean;
    tarball: Buffer;
  },
): Promise<{ buildId: string }> {
  const form = new FormData();
  form.set("projectSlug", opts.projectSlug);
  form.set("buildType", opts.buildType);
  form.set("profile", opts.profile);
  form.set("abi", opts.abi);
  form.set("ota", opts.ota ? "1" : "0");
  form.set("tarball", new Blob([new Uint8Array(opts.tarball)]), "project.tgz");
  return request(cfg, "/api/builds", { method: "POST", body: form });
}
