"use client";

import { useEffect, useRef, useState } from "react";
import { statusClass } from "@/lib/format";

// Ordered checkpoints emitted by the worker (apps/worker/src/android.ts). Progress
// is "how far through this list has the log gotten" — a good enough proxy since
// Gradle itself doesn't report a real percentage.
const STAGES: { marker: string; pct: number }[] = [
  { marker: "Extracting source tarball", pct: 5 },
  { marker: "Installing dependencies", pct: 20 },
  { marker: "Reading app config", pct: 32 },
  { marker: "Exporting update bundle", pct: 36 },
  { marker: "Generating android project", pct: 42 },
  { marker: "Running Gradle", pct: 55 },
  { marker: "Artifact:", pct: 95 },
];

// OTA-only builds never reach prebuild/Gradle, so they need their own ladder —
// otherwise the bar would stop at 36% on a build that is actually finished.
const UPDATE_STAGES: { marker: string; pct: number }[] = [
  { marker: "Extracting source tarball", pct: 10 },
  { marker: "Installing dependencies", pct: 40 },
  { marker: "Reading app config", pct: 60 },
  { marker: "Exporting update bundle", pct: 75 },
  { marker: "Update bundle ready", pct: 95 },
];

function progressFor(lines: string[], status: string, buildType: string): number {
  if (status === "success") return 100;
  const stages = buildType === "update" ? UPDATE_STAGES : STAGES;
  let pct = status === "queued" ? 0 : 2;
  for (const line of lines) {
    for (const stage of stages) {
      if (line.includes(stage.marker) && stage.pct > pct) pct = stage.pct;
    }
  }
  return pct;
}

export function BuildConsole({
  buildId,
  token,
  initialStatus,
  buildType,
}: {
  buildId: string;
  token: string;
  initialStatus: string;
  buildType: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState(initialStatus);
  // Distinct from "no lines yet": a finished build with an empty log should say
  // so rather than spin forever pretending something is on its way.
  const [connected, setConnected] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/builds/${buildId}/logs?token=${encodeURIComponent(token)}`);

    source.addEventListener("open", () => setConnected(true));

    source.addEventListener("log", (e) => {
      setConnected(true);
      const line = JSON.parse((e as MessageEvent).data);
      setLines((prev) => (prev.length > 5000 ? [...prev.slice(-5000), line] : [...prev, line]));
    });

    source.addEventListener("done", (e) => {
      const newStatus = JSON.parse((e as MessageEvent).data);
      setStatus(newStatus);
      setConnected(true);
      source.close();
    });

    source.onerror = () => {
      // Build already finished and the file-replay path closed the stream normally;
      // EventSource still fires "error" on a clean server-side close. Nothing to retry.
      setConnected(true);
      source.close();
    };

    return () => source.close();
  }, [buildId, token]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const pct = progressFor(lines, status, buildType);
  const running = status === "queued" || status === "running";
  const fillClass = `progress-fill${
    status === "failed"
      ? " is-failed"
      : status === "canceled"
        ? " is-canceled"
        : status === "success"
          ? " is-success"
          : " is-running"
  }`;

  return (
    <div className="card">
      <div className="row" style={{ gap: 12, marginBottom: 14, flexWrap: "nowrap" }}>
        <span className={statusClass(status)}>{status}</span>
        <div className="progress">
          <div className={fillClass} style={{ width: `${pct}%` }} />
        </div>
        <span className="progress-pct">{pct}%</span>
      </div>

      <div className="log-head">
        {running && <span className="spinner" />}
        <span>
          {lines.length > 0
            ? `${lines.length} line${lines.length === 1 ? "" : "s"}`
            : connected
              ? "no output"
              : "connecting"}
        </span>
        {running && <span className="faint">· streaming live</span>}
      </div>

      <pre className="log" ref={logRef}>
        {lines.length > 0 ? (
          lines.join("\n")
        ) : connected ? (
          <span className="faint">Nothing was logged for this build.</span>
        ) : (
          <span className="loading-row">
            <span className="spinner" />
            Attaching to the build log…
          </span>
        )}
      </pre>
    </div>
  );
}
