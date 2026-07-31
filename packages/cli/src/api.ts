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

export async function uploadBuild(
  cfg: GlobalConfig,
  opts: { projectSlug: string; buildType: string; profile: string; tarball: Buffer },
): Promise<{ buildId: string }> {
  const form = new FormData();
  form.set("projectSlug", opts.projectSlug);
  form.set("buildType", opts.buildType);
  form.set("profile", opts.profile);
  form.set("tarball", new Blob([new Uint8Array(opts.tarball)]), "project.tgz");
  return request(cfg, "/api/builds", { method: "POST", body: form });
}
