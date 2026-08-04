"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Queues the same source again.
 *
 * The dropdown exists because the common reason to rebuild is not "run it
 * again identically" but "run it again *with* something" — an OTA bundle, or an
 * ABI you skipped the first time. Defaults are whatever the original build used,
 * so pressing straight through repeats it exactly.
 */
export function RebuildButton({
  buildId,
  token,
  buildType,
  ota,
}: {
  buildId: string;
  token: string;
  buildType: string;
  ota: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [withOta, setWithOta] = useState(ota);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An "update" build is nothing but an OTA bundle, so offering the switch
  // would be offering to turn the build into itself.
  const canToggleOta = buildType !== "update";

  async function rebuild() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/builds/${buildId}/rebuild`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ ota: withOta }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      router.push(`/builds/${body.buildId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <button className="btn btn-busy" disabled>
        <span className="spinner" />
        Queueing
      </button>
    );
  }

  if (!canToggleOta || !open) {
    return (
      <span className="row" style={{ gap: 8 }}>
        <button
          className="btn"
          onClick={() => (canToggleOta ? setOpen(true) : void rebuild())}
          title="Queue this source again"
        >
          Rebuild
        </button>
        {error && <span className="error-text">{error}</span>}
      </span>
    );
  }

  return (
    <span className="row" style={{ gap: 8 }}>
      <button className="btn btn-primary" onClick={() => void rebuild()}>
        Queue rebuild
      </button>
      <label className="row" style={{ gap: 6, fontSize: 13 }}>
        <input type="checkbox" checked={withOta} onChange={(e) => setWithOta(e.target.checked)} />
        with OTA bundle
      </label>
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <span className="error-text">{error}</span>}
    </span>
  );
}
