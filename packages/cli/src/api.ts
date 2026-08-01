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
