"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Compose and send an in-app notification.
 *
 * There is no draft state and no preview step on purpose: sending is already
 * reversible (Retract), and a message that reaches a phone within a minute is
 * the whole point of the feature.
 */
export function ComposeForm({
  projects,
  token,
}: {
  projects: { slug: string; name: string }[];
  token: string;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(projects[0]?.slug ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [level, setLevel] = useState("info");
  const [channel, setChannel] = useState("production");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const res = await fetch(`/api/notifications/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          body,
          linkUrl: linkUrl.trim() || null,
          level,
          channel,
          // datetime-local has no zone; the browser's own zone is what the
          // person typing it meant.
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `${res.status} ${res.statusText}`);
      }
      setTitle("");
      setBody("");
      setLinkUrl("");
      setExpiresAt("");
      setSent(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = {
    width: "100%",
    background: "#0f131b",
    border: "1px solid #2a2f3a",
    borderRadius: 6,
    color: "#e6e6e6",
    padding: "8px 10px",
    fontSize: 14,
    fontFamily: "inherit",
    boxSizing: "border-box",
  };
  const label: React.CSSProperties = {
    display: "block",
    color: "#8a8f98",
    fontSize: 12,
    marginBottom: 4,
  };

  if (projects.length === 0) {
    return (
      <p style={{ color: "#8a8f98" }}>
        No projects yet — build one first, then you can send notifications to it.
      </p>
    );
  }

  return (
    <form
      onSubmit={send}
      style={{
        background: "#111620",
        border: "1px solid #1a1f29",
        borderRadius: 8,
        padding: 16,
        display: "grid",
        gap: 12,
        maxWidth: 620,
      }}
    >
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label style={label}>App</label>
          <select style={field} value={slug} onChange={(e) => setSlug(e.target.value)}>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: "0 1 140px" }}>
          <label style={label}>Level</label>
          <select style={field} value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="info">info</option>
            <option value="warning">warning</option>
          </select>
        </div>
        <div style={{ flex: "0 1 160px" }}>
          <label style={label}>Channel</label>
          <input
            style={field}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="production"
          />
        </div>
      </div>

      <div>
        <label style={label}>Title</label>
        <input
          style={field}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="New films added"
          required
        />
      </div>

      <div>
        <label style={label}>Message</label>
        <textarea
          style={{ ...field, minHeight: 90, resize: "vertical" }}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          placeholder="Twelve new titles landed this week — open Movies to see them."
          required
        />
        <div style={{ color: "#565c66", fontSize: 12, marginTop: 4 }}>{body.length}/1000</div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <label style={label}>Link (optional, http/https)</label>
          <input
            style={field}
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://…"
            type="url"
          />
        </div>
        <div style={{ flex: "0 1 220px" }}>
          <label style={label}>Expires (optional)</label>
          <input
            style={field}
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            type="datetime-local"
          />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="submit"
          disabled={busy}
          style={{
            background: "#3b82f6",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            padding: "9px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Sending…" : "Send"}
        </button>
        {sent && <span style={{ color: "#22c55e", fontSize: 13 }}>● sent</span>}
        {error && <span style={{ color: "#ef4444", fontSize: 13 }}>{error}</span>}
      </div>

      <p style={{ color: "#565c66", fontSize: 12, margin: 0 }}>
        Apps pick this up the next time they are opened or brought to the foreground —
        it is a poll, not a push, so a closed app shows nothing until it is next launched.
      </p>
    </form>
  );
}
