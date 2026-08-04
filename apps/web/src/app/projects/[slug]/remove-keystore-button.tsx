"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Detaches the project's keystore. Two-step, like deleting a build: the key
 * material is gone afterwards, and without it no future build can produce an
 * APK that upgrades over what people already have installed.
 */
export function RemoveKeystoreButton({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/keystore`, {
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
    } finally {
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <button className="btn btn-sm btn-danger btn-busy" disabled>
        <span className="spinner" />
        Removing
      </button>
    );
  }

  if (confirming) {
    return (
      <span className="row" style={{ gap: 8 }}>
        <button className="btn btn-sm btn-danger" onClick={() => void remove()}>
          Sure? This can't be undone
        </button>
        <button className="btn btn-sm" onClick={() => setConfirming(false)}>
          Keep
        </button>
        {error && <span className="error-text">{error}</span>}
      </span>
    );
  }

  return (
    <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(true)}>
      Remove
    </button>
  );
}
