import { db } from "@mybuild/db";
import type { Notification } from "@mybuild/db";

/**
 * In-app notifications.
 *
 * Deliberately a *pull* channel. Apps poll GET /api/notifications/<slug>; the
 * server keeps no device registry and sends nothing to anybody. That is what
 * makes this shippable over the air — real push would need Firebase, a device
 * token and a native module, i.e. a new APK every install has to accept by
 * hand.
 *
 * Like the update endpoints in @/lib/updates, the read side is public: an
 * installed app cannot carry LOCAL_TOKEN. Everything that *writes* stays
 * token-gated, and middleware.ts additionally refuses non-GET on the public
 * hostname.
 */

/** Most an app is ever handed in one poll. Its inbox shows the same window. */
export const MAX_SERVED = 50;

export const LEVELS = ["info", "warning"] as const;
export type Level = (typeof LEVELS)[number];

/** What the app receives. Kept flat and boring — it is a wire contract. */
export interface WireNotification {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  level: string;
  createdAt: string;
}

export function toWire(n: Notification): WireNotification {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    linkUrl: n.linkUrl,
    level: n.level,
    createdAt: n.createdAt.toISOString(),
  };
}

/**
 * Live notifications for a channel, newest first.
 *
 * `since` is an optimisation only: an app that passes its newest known
 * timestamp gets just what it has not seen. Omitting it returns the whole
 * window, which is what a fresh install (or one that cleared its data) needs.
 */
export function listLive(slug: string, channel: string, since?: Date | null) {
  const now = new Date();
  return db().notification.findMany({
    where: {
      project: { slug },
      channel,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(since ? { createdAt: { gt: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: MAX_SERVED,
  });
}

/**
 * Only http(s) links are accepted. The app hands these to the system browser,
 * and a `javascript:`/`intent:`/`file:` URL handed to a browser is exactly the
 * kind of thing an announcement channel must not be able to do.
 */
export function normalizeLink(raw: unknown): string | null | undefined {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
}
