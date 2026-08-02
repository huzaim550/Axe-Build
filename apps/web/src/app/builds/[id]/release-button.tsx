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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLive = releasedApk || releasedUpdate;

  async function send(label: string, body: { apk: boolean; update: boolean }) {
    setBusy(label);
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
      setBusy(null);
    }
  }

  /** One button, with its own busy state — several can be on screen at once. */
  const Button = ({
    label,
    primary,
    body,
  }: {
    label: string;
    primary?: boolean;
    body: { apk: boolean; update: boolean };
  }) => {
    const isBusy = busy === label;
    return (
      <button
        className={`btn${primary ? " btn-primary" : ""}${isBusy ? " btn-busy" : ""}`}
        disabled={busy !== null}
        onClick={() => void send(label, body)}
      >
        {isBusy && <span className="spinner" />}
        {isBusy ? "Working" : label}
      </button>
    );
  };

  // Nothing to promote: an OTA-less build whose artifact was never produced.
  if (!isLive && !hasApk && !hasUpdate) return null;

  return (
    <>
      {isLive ? (
        <Button label="Unrelease" body={{ apk: false, update: false }} />
      ) : (
        <>
          <Button
            label={`Release${
              hasApk && hasUpdate ? " APK + OTA" : hasApk ? " APK" : hasUpdate ? " OTA" : ""
            }`}
            primary
            body={{ apk: hasApk, update: hasUpdate }}
          />
          {hasApk && hasUpdate && (
            <>
              <Button label="APK only" body={{ apk: true, update: false }} />
              <Button label="OTA only" body={{ apk: false, update: true }} />
            </>
          )}
        </>
      )}
      {error && <span className="error-text">{error}</span>}
    </>
  );
}
