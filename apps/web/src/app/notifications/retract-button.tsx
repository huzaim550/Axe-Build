"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Stops a notification being served to apps that have not fetched it yet.
 *
 * It cannot un-show it on a device that already has it — the copy lives in the
 * app's own storage. The label says "Retract" rather than "Delete" for exactly
 * that reason.
 */
export function RetractButton({
  slug,
  id,
  token,
}: {
  slug: string;
  id: string;
  token: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retract() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/notifications/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
        { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `${res.status} ${res.statusText}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={retract}
        disabled={busy}
        style={{
          background: "transparent",
          border: "1px solid #2a2f3a",
          color: "#8a8f98",
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: 12,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "…" : "Retract"}
      </button>
      {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
    </>
  );
}
