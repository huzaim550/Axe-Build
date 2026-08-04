import Redis from "ioredis";

/** Channel the worker listens on to abort the build it is currently running. */
export const CANCEL_CHANNEL = "builds:cancel";

// Singleton on globalThis so dev-mode HMR doesn't leak Redis connections, the
// same reason the BullMQ queue is held this way.
const g = globalThis as unknown as { __publisher?: Redis };

function publisher(): Redis {
  if (!g.__publisher) {
    const url = new URL(process.env.REDIS_URL ?? "redis://redis:6379");
    g.__publisher = new Redis({ host: url.hostname, port: Number(url.port || 6379) });
  }
  return g.__publisher;
}

/** Ask the worker to stop this build. Fire-and-forget: the worker owns the outcome. */
export async function requestCancel(buildId: string): Promise<void> {
  await publisher().publish(CANCEL_CHANNEL, buildId);
}

/**
 * Tell every open log console that a build reached a terminal state.
 *
 * Normally the worker publishes this as it finishes. Cancelling a build that
 * never started has no worker involved at all, so the web app has to say it.
 */
export async function publishDone(buildId: string, status: string): Promise<void> {
  await publisher().publish(`logs:${buildId}`, JSON.stringify({ type: "done", status }));
}
