import type { CSSProperties } from "react";
import Link from "next/link";
import { db } from "@mybuild/db";
import { token } from "@/lib/auth";
import { ComposeForm } from "./compose-form";
import { RetractButton } from "./retract-button";

export const dynamic = "force-dynamic";

/** Sent messages worth keeping on screen. Older ones stay in the DB. */
const HISTORY = 50;

function state(n: { active: boolean; expiresAt: Date | null }): {
  label: string;
  color: string;
} {
  if (!n.active) return { label: "retracted", color: "#8a8f98" };
  if (n.expiresAt && n.expiresAt.getTime() <= Date.now()) {
    return { label: "expired", color: "#f59e0b" };
  }
  return { label: "live", color: "#22c55e" };
}

export default async function Notifications() {
  const [projects, sent] = await Promise.all([
    db().project.findMany({ orderBy: { createdAt: "desc" }, select: { slug: true, name: true } }),
    db().notification.findMany({
      orderBy: { createdAt: "desc" },
      take: HISTORY,
      include: { project: { select: { name: true, slug: true } } },
    }),
  ]);

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
    verticalAlign: "top",
  };

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 16px" }}>
      <Link href="/" style={{ color: "#3b82f6", fontSize: 13 }}>
        ← builds
      </Link>
      <h1 style={{ fontSize: 22, marginBottom: 4, marginTop: 12 }}>Notifications</h1>
      <p style={{ color: "#8a8f98", marginTop: 0, marginBottom: 24 }}>
        Messages installed apps fetch and show in their own inbox.
      </p>

      <ComposeForm projects={projects} token={token()} />

      <h2 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>Sent</h2>
      {sent.length === 0 ? (
        <p style={{ color: "#8a8f98" }}>Nothing sent yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>App</th>
              <th style={th}>Message</th>
              <th style={th}>Channel</th>
              <th style={th}>State</th>
              <th style={th}>Sent</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {sent.map((n) => {
              const s = state(n);
              return (
                <tr key={n.id}>
                  <td style={td}>{n.project.name}</td>
                  <td style={{ ...td, maxWidth: 380 }}>
                    <div style={{ fontWeight: 600 }}>{n.title}</div>
                    <div style={{ color: "#8a8f98", fontSize: 13 }}>{n.body}</div>
                    {n.linkUrl && (
                      <div style={{ color: "#3b82f6", fontSize: 12, wordBreak: "break-all" }}>
                        {n.linkUrl}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    {n.channel}
                    <div style={{ color: "#565c66", fontSize: 12 }}>{n.level}</div>
                  </td>
                  <td style={td}>
                    <span style={{ color: s.color }}>● {s.label}</span>
                    {n.expiresAt && (
                      <div style={{ color: "#565c66", fontSize: 12 }}>
                        until {n.expiresAt.toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td style={td}>{n.createdAt.toLocaleString()}</td>
                  <td style={td}>
                    {n.active && <RetractButton slug={n.project.slug} id={n.id} token={token()} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
