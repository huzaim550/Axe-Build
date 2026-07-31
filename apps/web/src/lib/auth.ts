export function token(): string {
  return process.env.LOCAL_TOKEN ?? "dev-local-token";
}

/** Accepts the Bearer header (CLI) or a ?token= query param (dashboard download links). */
export function isAuthorized(req: Request): boolean {
  const t = token();
  if (req.headers.get("authorization") === `Bearer ${t}`) return true;
  return new URL(req.url).searchParams.get("token") === t;
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
