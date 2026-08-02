import { db } from "@axebuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { LEVELS, listLive, normalizeLink, toWire } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/** Longest message the composer accepts. Phones show ~3 lines before folding. */
const MAX_TITLE = 120;
const MAX_BODY = 1000;

/**
 * What an installed app polls for announcements.
 *
 * PUBLIC (no token) — see the note in @/lib/notifications. Read-only, and
 * middleware.ts refuses anything but GET on the public hostname.
 *
 * Query: ?channel=production&since=<ISO timestamp>
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const channel = url.searchParams.get("channel") ?? "production";

  // A malformed `since` means "give me everything" rather than an error: a
  // client with a corrupt cache should still recover on the next poll.
  const rawSince = url.searchParams.get("since");
  const since = rawSince ? new Date(rawSince) : null;
  const validSince = since && !Number.isNaN(since.getTime()) ? since : null;

  const rows = await listLive(slug, channel, validSince);

  return Response.json(
    { channel, notifications: rows.map(toWire) },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Send a notification. Token-gated — this is the write side.
 *
 * POST body: { title, body, linkUrl?, level?, channel?, expiresAt? }
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { slug } = await params;

  const project = await db().project.findUnique({ where: { slug } });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });

  const raw = await req.json().catch(() => null);
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  const body = typeof raw?.body === "string" ? raw.body.trim() : "";
  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
  if (!body) return Response.json({ error: "body is required" }, { status: 400 });
  if (title.length > MAX_TITLE) {
    return Response.json({ error: `title must be ${MAX_TITLE} characters or fewer` }, { status: 400 });
  }
  if (body.length > MAX_BODY) {
    return Response.json({ error: `body must be ${MAX_BODY} characters or fewer` }, { status: 400 });
  }

  const linkUrl = normalizeLink(raw?.linkUrl);
  if (linkUrl === undefined) {
    return Response.json({ error: "linkUrl must be an http(s) URL" }, { status: 400 });
  }

  const level = typeof raw?.level === "string" ? raw.level : "info";
  if (!(LEVELS as readonly string[]).includes(level)) {
    return Response.json({ error: `level must be one of ${LEVELS.join(", ")}` }, { status: 400 });
  }

  let expiresAt: Date | null = null;
  if (raw?.expiresAt) {
    const parsed = new Date(raw.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return Response.json({ error: "expiresAt must be a date" }, { status: 400 });
    }
    expiresAt = parsed;
  }

  const created = await db().notification.create({
    data: {
      projectId: project.id,
      title,
      body,
      linkUrl,
      level,
      channel: typeof raw?.channel === "string" && raw.channel ? raw.channel : "production",
      expiresAt,
    },
  });

  return Response.json(toWire(created), { status: 201 });
}
