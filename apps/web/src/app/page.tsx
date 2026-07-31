import type { CSSProperties } from "react";
import { db } from "@mybuild/db";
import { token } from "@/lib/auth";
import { AutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  queued: "#8a8f98",
  running: "#3b82f6",
  success: "#22c55e",
  failed: "#ef4444",
  canceled: "#f59e0b",
};

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDuration(start: Date | null, end: Date | null): string {
  if (!start) return "—";
  const ms = (end ? end.getTime() : Date.now()) - start.getTime();
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function Home() {
  const builds = await db().build.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { project: { select: { name: true, slug: true } } },
  });

  const th: CSSProperties = {
    textAlign: "left",
    padding: "8px 12px",
    borderBottom: "1px solid #2a2f3a",
    color: "#8a8f98",
    fontWeight: 500,
    fontSize: 13,
  };
  const td: CSSProperties = {
    padding: "8px 12px",
    borderBottom: "1px solid #1a1f29",
    fontSize: 14,
  };

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 16px" }}>
      <AutoRefresh />
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>mybuild</h1>
      <p style={{ color: "#8a8f98", marginTop: 0, marginBottom: 24 }}>
        Local Expo Android builds — {builds.length} recent build{builds.length === 1 ? "" : "s"}
      </p>

      {builds.length === 0 ? (
        <p style={{ color: "#8a8f98" }}>
          No builds yet. Run <code>build-cli build</code> inside an Expo project.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Project</th>
              <th style={th}>Status</th>
              <th style={th}>Type</th>
              <th style={th}>Duration</th>
              <th style={th}>Size</th>
              <th style={th}>Started</th>
              <th style={th}>Artifact</th>
            </tr>
          </thead>
          <tbody>
            {builds.map((b) => (
              <tr key={b.id}>
                <td style={td}>
                  {b.project.name}
                  <div style={{ color: "#565c66", fontSize: 12 }}>{b.id}</div>
                </td>
                <td style={td}>
                  <span style={{ color: STATUS_COLORS[b.status] ?? "#e6e6e6" }}>● {b.status}</span>
                  {b.error && (
                    <div style={{ color: "#ef4444", fontSize: 12, maxWidth: 240 }}>
                      {b.error.slice(0, 120)}
                    </div>
                  )}
                </td>
                <td style={td}>
                  {b.buildType} / {b.profile}
                </td>
                <td style={td}>{fmtDuration(b.startedAt, b.finishedAt)}</td>
                <td style={td}>{fmtBytes(b.sizeBytes)}</td>
                <td style={td}>{b.createdAt.toLocaleString()}</td>
                <td style={td}>
                  {b.status === "success" && b.artifactPath ? (
                    <a
                      href={`/api/builds/${b.id}/artifact?token=${encodeURIComponent(token())}`}
                      style={{ color: "#3b82f6" }}
                    >
                      download
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
