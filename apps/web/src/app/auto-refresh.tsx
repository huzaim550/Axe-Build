"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

/**
 * Re-fetches the server component data on an interval so statuses stay live,
 * and says so.
 *
 * The indicator is wired to the actual refresh (via `useTransition`) rather
 * than to a timer of its own: it goes blue while a request is genuinely in
 * flight. A spinner that spins on a schedule tells you nothing.
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setInterval(() => {
      startTransition(() => router.refresh());
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return (
    <span className={isPending ? "live is-busy" : "live"} title="This page refreshes itself">
      {isPending ? <span className="spinner" /> : <span className="live-dot" />}
      {isPending ? "refreshing" : "live"}
    </span>
  );
}
