"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Deletes a build and everything it owns on disk.
 *
 * Two-step, always: the first press turns into "Sure?". This is the only
 * control on the dashboard that destroys something a rebuild cannot recover
 * for free — an APK is 8–15 minutes of somebody's evening.
 *
 * A live build refuses to delete on the first attempt (the API answers 409 with
 * `released: true`); the button then offers to force it, having said what that
 * costs. That second confirmation is deliberate friction, not ceremony.
 */
export function DeleteBuildButton({
  buildId,
  token,
  onDeleted,
  size = "sm",
  ghost = false,
}: {
  buildId: string;
  token: string;
  /** Where to go afterwards. Default is a refresh, which is right for a list. */
  onDeleted?: "refresh" | "home";
  size?: "sm" | "md";
  /** Borderless until hovered — for a list, where it repeats on every row. */
  ghost?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsForce, setNeedsForce] = useState(false);

  async function remove(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/builds/${buildId}${force ? "?force=1" : ""}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.released) {
          setNeedsForce(true);
          setError("This build is live for installed apps.");
          return;
        }
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      if (onDeleted === "home") router.push("/");
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const base = `btn${size === "sm" ? " btn-sm" : ""}`;
  const cls = `${base} btn-danger${busy ? " btn-busy" : ""}`;

  if (busy) {
    return (
      <button className={cls} disabled>
        <span className="spinner" />
        Deleting
      </button>
    );
  }

  if (needsForce) {
    return (
      <span className="row" style={{ gap: 8 }}>
        <button className={cls} onClick={() => void remove(true)}>
          Delete anyway
        </button>
        <button
          className={base}
          onClick={() => {
            setNeedsForce(false);
            setConfirming(false);
            setError(null);
          }}
        >
          Keep
        </button>
        {error && <span className="error-text">{error}</span>}
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="row" style={{ gap: 8 }}>
        <button className={cls} onClick={() => void remove(false)}>
          Sure?
        </button>
        <button
          className={base}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
        {error && <span className="error-text">{error}</span>}
      </span>
    );
  }

  return (
    <button
      className={ghost ? `${base} btn-ghost` : base}
      onClick={() => setConfirming(true)}
      title="Delete this build and its files"
    >
      Delete
    </button>
  );
}
