"use client";

import { useEffect, useRef, useState } from "react";

const STATUS_COLORS: Record<string, string> = {
  queued: "#8a8f98",
  running: "#3b82f6",
  success: "#22c55e",
  failed: "#ef4444",
  canceled: "#f59e0b",
};

// Ordered checkpoints emitted by the worker (apps/worker/src/android.ts). Progress
// is "how far through this list has the log gotten" — a good enough proxy since
// Gradle itself doesn't report a real percentage.
const STAGES: { marker: string; pct: number }[] = [
  { marker: "Extracting source tarball", pct: 5 },
  { marker: "Installing dependencies", pct: 20 },
  { marker: "Generating android project", pct: 40 },
  { marker: "Running Gradle", pct: 55 },
  { marker: "Artifact:", pct: 95 },
];

function progressFor(lines: string[], status: string): number {
  if (status === "success") return 100;
  let pct = status === "queued" ? 0 : 2;
  for (const line of lines) {
    for (const stage of STAGES) {
      if (line.includes(stage.marker) && stage.pct > pct) pct = stage.pct;
    }
  }
  return pct;
}

export function BuildConsole({
  buildId,
  token,
  initialStatus,
}: {
  buildId: string;
  token: string;
  initialStatus: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/builds/${buildId}/logs?token=${encodeURIComponent(token)}`);

    source.addEventListener("log", (e) => {
      const line = JSON.parse((e as MessageEvent).data);
      setLines((prev) => (prev.length > 5000 ? [...prev.slice(-5000), line] : [...prev, line]));
    });

    source.addEventListener("done", (e) => {
      const newStatus = JSON.parse((e as MessageEvent).data);
      setStatus(newStatus);
      source.close();
    });

    source.onerror = () => {
      // Build already finished and the file-replay path closed the stream normally;
      // EventSource still fires "error" on a clean server-side close. Nothing to retry.
      source.close();
    };

    return () => source.close();
  }, [buildId, token]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const pct = progressFor(lines, status);
  const barColor = status === "failed" ? "#ef4444" : status === "canceled" ? "#f59e0b" : "#3b82f6";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ color: STATUS_COLORS[status] ?? "#e6e6e6", fontSize: 14 }}>● {status}</span>
        <div
          style={{
            flex: 1,
            height: 8,
            borderRadius: 4,
            background: "#1a1f29",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: barColor,
              transition: "width 0.4s ease",
            }}
          />
        </div>
        <span style={{ color: "#8a8f98", fontSize: 13, width: 36, textAlign: "right" }}>{pct}%</span>
      </div>

      <pre
        ref={logRef}
        style={{
          background: "#05070a",
          border: "1px solid #1a1f29",
          borderRadius: 6,
          padding: 16,
          fontSize: 13,
          lineHeight: 1.5,
          maxHeight: 500,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {lines.length > 0 ? lines.join("\n") : "Waiting for log output..."}
      </pre>
    </div>
  );
}
