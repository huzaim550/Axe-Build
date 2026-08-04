"use client";

import { useEffect, useRef, useState } from "react";
import { statusClass } from "@/lib/format";
import { ChopLoader } from "../../chop-loader";

// Ordered checkpoints emitted by the worker (apps/worker/src/android.ts). Progress
// is "how far through this list has the log gotten" — a good enough proxy since
// Gradle itself doesn't report a real percentage. The label is what the loader
// says it is doing, so both readings come from one table and cannot disagree.
type Stage = { marker: string; pct: number; label: string };

const STAGES: Stage[] = [
  { marker: "Extracting source tarball", pct: 5, label: "Unpacking your source" },
  { marker: "Installing dependencies", pct: 20, label: "Installing dependencies" },
  { marker: "Reading app config", pct: 32, label: "Reading your app config" },
  { marker: "Exporting update bundle", pct: 36, label: "Exporting the update bundle" },
  { marker: "Generating android project", pct: 42, label: "Generating the Android project" },
  { marker: "Running Gradle", pct: 55, label: "Running Gradle" },
  { marker: "Artifact:", pct: 95, label: "Packaging the artifact" },
];

// OTA-only builds never reach prebuild/Gradle, so they need their own ladder —
// otherwise the bar would stop at 36% on a build that is actually finished.
const UPDATE_STAGES: Stage[] = [
  { marker: "Extracting source tarball", pct: 10, label: "Unpacking your source" },
  { marker: "Installing dependencies", pct: 40, label: "Installing dependencies" },
  { marker: "Reading app config", pct: 60, label: "Reading your app config" },
  { marker: "Exporting update bundle", pct: 75, label: "Exporting the update bundle" },
  { marker: "Update bundle ready", pct: 95, label: "Wrapping up the bundle" },
];

/** The furthest checkpoint the log has reached, or null before the first one. */
function reachedStage(lines: string[], buildType: string): Stage | null {
  const stages = buildType === "update" ? UPDATE_STAGES : STAGES;
  let reached: Stage | null = null;
  for (const line of lines) {
    for (const stage of stages) {
      if (line.includes(stage.marker) && stage.pct > (reached?.pct ?? 0)) reached = stage;
    }
  }
  return reached;
}

function progressFor(lines: string[], status: string, buildType: string): number {
  if (status === "success") return 100;
  const reached = reachedStage(lines, buildType);
  const floor = status === "queued" ? 0 : 2;
  return Math.max(floor, reached?.pct ?? 0);
}

/** What the loader says while it chops. */
function captionFor(lines: string[], status: string, buildType: string): string {
  // A queued build has no worker yet, so naming a stage would be a lie.
  if (status === "queued") return "Waiting for a free worker";
  return (
    reachedStage(lines, buildType)?.label ??
    (buildType === "update" ? "Building your update" : "Building your APK")
  );
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

      {/* Only while something is actually happening. A finished build gets its
          log back and nothing else. */}
      {running && <ChopLoader caption={captionFor(lines, status, buildType)} />}

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
