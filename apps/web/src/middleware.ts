import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Public-hostname lockdown.
 *
 * The dashboard renders LOCAL_TOKEN into its HTML so download links work,
 * which is harmless on a LAN and catastrophic on the open internet: anyone
 * who loads `/` could read the token and queue builds on this machine.
 *
 * When this server is published through a tunnel (Cloudflare, Tailscale
 * Funnel, ngrok, ...), set PUBLIC_HOSTNAME to the public name. Requests
 * arriving on that hostname may then reach ONLY the read-only endpoints an
 * installed app needs; everything else 404s as if it were not there.
 *
 * Requests on any other hostname (192.168.x.x, localhost, the compose service
 * name) are untouched, so the LAN dashboard keeps working exactly as before.
 *
 * This is defence in depth, not the only layer — also restrict the paths in
 * the tunnel's own ingress rules. See README.md.
 */

/** Everything expo-updates and the APK update check need, and nothing else. */
const PUBLIC_PATHS: RegExp[] = [
  /^\/api\/updates\/[^/]+\/manifest\/?$/,
  /^\/api\/updates\/[^/]+\/assets\/?$/,
  /^\/api\/apps\/[^/]+\/latest\/?$/,
  /^\/api\/apps\/[^/]+\/latest\/download\/?$/,
  /^\/api\/health\/?$/,
];

function hostnameOf(value: string | null): string {
  if (!value) return "";
  // Strip any port, and be forgiving about a stray protocol.
  return value.replace(/^https?:\/\//, "").split(":")[0].trim().toLowerCase();
}

export function middleware(req: NextRequest) {
  const publicHostname = hostnameOf(process.env.PUBLIC_HOSTNAME ?? null);
  if (!publicHostname) return NextResponse.next();

  const host = hostnameOf(
    req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
  );
  if (host !== publicHostname) return NextResponse.next();

  const path = req.nextUrl.pathname;
  if (PUBLIC_PATHS.some((re) => re.test(path))) {
    return NextResponse.next();
  }

  // 404, not 401: a probe should not learn that a build server lives here.
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });
}

export const config = {
  // Run on everything except Next's own static output, which carries no secrets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
