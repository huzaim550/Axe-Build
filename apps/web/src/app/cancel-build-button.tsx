"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Stops a queued or running build.
 *
 * One press, no "Sure?" — unlike Delete this destroys nothing you can't get
 * back by pressing Rebuild, and the whole point of the button is to be fast
 * when you've just realised the wrong thing is compiling.
 *
 * A running build stays on screen as "canceling" until the worker has actually
 * killed Gradle and written the row, which is the honest state: the machine is
 * still busy for those few seconds.
 */
export function CancelBuildButton({
  buildId,
  token,
  size = "sm",
  ghost = false,
}: {
  buildId: string;
  token: string;
  size?: "sm" | "md";
  ghost?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/builds/${buildId}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const cls = `btn${size === "sm" ? " btn-sm" : ""}${ghost ? " btn-ghost" : ""}`;

  if (busy) {
    return (
      <button className={`${cls} btn-busy`} disabled>
        <span className="spinner" />
        Canceling
      </button>
    );
  }

  return (
    <span className="row" style={{ gap: 8 }}>
      <button className={cls} onClick={() => void cancel()} title="Stop this build">
        Cancel
      </button>
      {error && <span className="error-text">{error}</span>}
    </span>
  );
}
