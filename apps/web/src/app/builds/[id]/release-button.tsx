"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Promotes a build to the update channels. Nothing reaches a phone until this
 * is pressed, so a green build is never automatically live.
 */
export function ReleaseButton({
  buildId,
  token,
  hasApk,
  hasUpdate,
  releasedApk,
  releasedUpdate,
}: {
  buildId: string;
  token: string;
  hasApk: boolean;
  hasUpdate: boolean;
  releasedApk: boolean;
  releasedUpdate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLive = releasedApk || releasedUpdate;

  async function send(body: { apk: boolean; update: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/builds/${buildId}/release`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
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

  const button: React.CSSProperties = {
    background: "#1a1f29",
    border: "1px solid #2a2f3a",
    color: "#e6e6e6",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 13,
    cursor: busy ? "wait" : "pointer",
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {isLive ? (
          <>
            <span style={{ color: "#22c55e", fontSize: 13 }}>
              ● live{releasedApk && releasedUpdate ? " (APK + OTA)" : releasedApk ? " (APK)" : " (OTA)"}
            </span>
            <button
              style={button}
              disabled={busy}
              onClick={() => send({ apk: false, update: false })}
            >
              Unrelease
            </button>
          </>
        ) : (
          <>
            <button
              style={{ ...button, borderColor: "#3b82f6", color: "#3b82f6" }}
              disabled={busy || (!hasApk && !hasUpdate)}
              onClick={() => send({ apk: hasApk, update: hasUpdate })}
            >
              Release{hasApk && hasUpdate ? " (APK + OTA)" : hasApk ? " APK" : hasUpdate ? " OTA" : ""}
            </button>
            {hasApk && hasUpdate && (
              <>
                <button style={button} disabled={busy} onClick={() => send({ apk: true, update: false })}>
                  APK only
                </button>
                <button style={button} disabled={busy} onClick={() => send({ apk: false, update: true })}>
                  OTA only
                </button>
              </>
            )}
          </>
        )}
      </div>
      {error && <p style={{ color: "#ef4444", fontSize: 13 }}>{error}</p>}
    </div>
  );
}
