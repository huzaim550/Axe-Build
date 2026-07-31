import fsp from "node:fs/promises";
import Redis from "ioredis";
import { db } from "@mybuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://redis:6379");
  return { host: url.hostname, port: Number(url.port || 6379) };
}

const TERMINAL = new Set(["success", "failed", "canceled"]);

/**
 * SSE log stream for a build. Replays whatever's already in the log file (works
 * for finished builds too, without ever needing Redis), then — if the build is
 * still queued/running — subscribes to the worker's pub/sub channel for new lines.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await params;

  const build = await db().build.findUnique({ where: { id } });
  if (!build) return Response.json({ error: "not found" }, { status: 404 });

  const encoder = new TextEncoder();
  let subscriber: Redis | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      if (build.logPath) {
        const existing = await fsp.readFile(build.logPath, "utf8").catch(() => "");
        for (const line of existing.split("\n")) {
          if (line) send("log", line);
        }
      }

      if (TERMINAL.has(build.status)) {
        send("done", build.status);
        controller.close();
        return;
      }

      subscriber = new Redis(redisConnection());
      const channel = `logs:${id}`;
      await subscriber.subscribe(channel);

      subscriber.on("message", (_channel, message) => {
        try {
          const msg = JSON.parse(message);
          if (msg.type === "log") {
            send("log", msg.line);
          } else if (msg.type === "done") {
            send("done", msg.status);
            controller.close();
            subscriber?.disconnect();
          }
        } catch {
          // ignore malformed pub/sub payloads
        }
      });

      // Close the race between our first DB read and subscribing: the build
      // may have already finished with nothing left to publish.
      const fresh = await db().build.findUnique({ where: { id }, select: { status: true } });
      if (fresh && TERMINAL.has(fresh.status)) {
        send("done", fresh.status);
        controller.close();
        await subscriber.unsubscribe(channel);
        subscriber.disconnect();
      }
    },
    cancel() {
      subscriber?.disconnect();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
