import { Queue } from "bullmq";

// Singleton on globalThis so dev-mode HMR doesn't leak Redis connections.
const g = globalThis as unknown as { __buildQueue?: Queue };

export function buildQueue(): Queue {
  if (!g.__buildQueue) {
    const url = new URL(process.env.REDIS_URL ?? "redis://redis:6379");
    g.__buildQueue = new Queue("builds", {
      connection: { host: url.hostname, port: Number(url.port || 6379) },
    });
  }
  return g.__buildQueue;
}
