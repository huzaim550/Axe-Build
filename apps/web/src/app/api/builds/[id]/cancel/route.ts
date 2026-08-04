import { db } from "@axebuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { publishDone, requestCancel } from "@/lib/pubsub";
import { buildQueue } from "@/lib/queue";

/**
 * Stop a build.
 *
 * Two very different situations behind one button:
 *
 *  - **queued** — no worker has touched it. Drop the job from the queue and mark
 *    the row canceled here; there is nothing to kill.
 *  - **running** — the worker owns it, and only the worker can kill the Gradle
 *    process group. Publish the id and let it record the outcome, so the row is
 *    never marked canceled while a JVM is still chewing on the machine.
 *
 * A finished build is left exactly as it is.
 *
 * `?force=1` marks the row canceled without waiting for a worker to confirm.
 * That is only ever right for a row orphaned by a worker restart — the job is
 * gone, so nothing will ever finish it — and it is deliberately not in the
 * dashboard: used on a genuinely running build it would leave Gradle chewing
 * on the machine with nothing on screen to say so.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "1";

  const build = await db().build.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!build) return Response.json({ error: "build not found" }, { status: 404 });

  if (build.status !== "queued" && build.status !== "running") {
    return Response.json(
      { error: `this build already finished (${build.status})`, status: build.status },
      { status: 409 },
    );
  }

  if (build.status === "queued") {
    // Remove first: if the row were marked canceled first, the worker could
    // pick the job up in between and start a build nothing is watching.
    const job = await buildQueue().getJob(id);
    await job?.remove().catch(() => {
      /* already picked up — the running path below covers it */
    });

    const updated = await db().build.updateMany({
      where: { id, status: "queued" },
      data: {
        status: "canceled",
        error: "Canceled before it started",
        finishedAt: new Date(),
      },
    });

    // It started while we were removing the job. Fall through to the worker.
    if (updated.count === 0) {
      await requestCancel(id);
      return Response.json({ buildId: id, status: "canceling" }, { status: 202 });
    }

    await publishDone(id, "canceled");
    return Response.json({ buildId: id, status: "canceled" });
  }

  await requestCancel(id);

  if (force) {
    await db().build.updateMany({
      where: { id, status: "running" },
      data: {
        status: "canceled",
        error: "Canceled (forced — no worker confirmed it)",
        finishedAt: new Date(),
      },
    });
    await publishDone(id, "canceled");
    return Response.json({ buildId: id, status: "canceled", forced: true });
  }

  return Response.json({ buildId: id, status: "canceling" }, { status: 202 });
}
