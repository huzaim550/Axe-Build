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

  if (projects.length === 0) {
    return (
      <div className="card empty">
        <h2>No apps yet</h2>
        <p>Build a project first — notifications are sent to one app at a time.</p>
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={send} style={{ maxWidth: 700 }}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">App</span>
          <select className="select" value={slug} onChange={(e) => setSlug(e.target.value)}>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Level</span>
          <select className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="info">info</option>
            <option value="warning">warning</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">Channel</span>
          <input
            className="input"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="production"
          />
        </label>
      </div>

      <label className="field">
        <span className="field-label">Title</span>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="New films added"
          required
        />
      </label>

      <label className="field">
        <span className="field-label">Message</span>
        <textarea
          className="textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          placeholder="Twelve new titles landed this week — open Movies to see them."
          required
        />
        <span className="field-hint">{body.length}/1000</span>
      </label>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Link (optional, http/https)</span>
          <input
            className="input"
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>

        <label className="field">
          <span className="field-label">Expires (optional)</span>
          <input
            className="input"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
      </div>

      <div className="row">
        <button type="submit" className={`btn btn-primary${busy ? " btn-busy" : ""}`} disabled={busy}>
          {busy && <span className="spinner" />}
          {busy ? "Sending" : "Send"}
        </button>
        {sent && <span className="ok-text">Sent — apps will pick it up on next launch.</span>}
        {error && <span className="error-text">{error}</span>}
      </div>

      <p className="note">
        This is a pull channel, not a push: apps fetch it when they open or come back to the
        foreground, so a closed app shows nothing until it is next launched.
      </p>
    </form>
  );
}
