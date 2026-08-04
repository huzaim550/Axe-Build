"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Removes a project that has nothing in it.
 *
 * Only rendered on empty projects, and the API refuses non-empty ones anyway —
 * so unlike deleting a build there is nothing here to lose, and one confirm
 * step is enough.
 */
export function DeleteProjectButton({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <button className="btn btn-sm btn-danger btn-busy" disabled>
        <span className="spinner" />
        Deleting
      </button>
    );
  }

  if (confirming) {
    return (
      <span className="row" style={{ gap: 8 }}>
        <button className="btn btn-sm btn-danger" onClick={() => void remove()}>
          Sure?
        </button>
        <button className="btn btn-sm" onClick={() => setConfirming(false)}>
          Cancel
        </button>
        {error && <span className="error-text">{error}</span>}
      </span>
    );
  }

  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={() => setConfirming(true)}
      title="Delete this empty project"
    >
      Delete
    </button>
  );
}
