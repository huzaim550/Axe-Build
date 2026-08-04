"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Upload or replace a project's release keystore.
 *
 * The passwords go to the server in a normal form post and are stored in the
 * database in plaintext — the same trade this whole server makes with
 * LOCAL_TOKEN, and the reason it must never be exposed beyond your LAN. They
 * are never sent back: once uploaded, the page can only tell you the alias.
 */
export function KeystoreForm({
  slug,
  token,
  existingAlias,
}: {
  slug: string;
  token: string;
  /** Set when the project already has one, which turns this into a replace. */
  existingAlias?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!existingAlias);
  const [keyAlias, setKeyAlias] = useState(existingAlias ?? "");
  const [storePassword, setStorePassword] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a .jks or .keystore file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("keystore", file);
      form.set("keyAlias", keyAlias);
      form.set("storePassword", storePassword);
      form.set("keyPassword", keyPassword);

      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/keystore`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      setStorePassword("");
      setKeyPassword("");
      setFile(null);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Replace keystore
      </button>
    );
  }

  return (
    <form onSubmit={upload} className="stack">
      {existingAlias && (
        <p className="note note-warn">
          Replacing the keystore breaks in-place upgrades: phones that installed a build signed
          with the old key must uninstall before they can take a new one.
        </p>
      )}

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Keystore file</span>
          <input
            className="input"
            type="file"
            accept=".jks,.keystore,.p12,.pfx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
          <span className="field-hint">.jks or PKCS#12. Never committed to your repo.</span>
        </label>

        <label className="field">
          <span className="field-label">Key alias</span>
          <input
            className="input"
            value={keyAlias}
            onChange={(e) => setKeyAlias(e.target.value)}
            placeholder="upload"
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Store password</span>
          <input
            className="input"
            type="password"
            value={storePassword}
            onChange={(e) => setStorePassword(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Key password</span>
          <input
            className="input"
            type="password"
            value={keyPassword}
            onChange={(e) => setKeyPassword(e.target.value)}
          />
          <span className="field-hint">Leave empty if it matches the store password.</span>
        </label>
      </div>

      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" />
              Uploading
            </>
          ) : (
            "Save keystore"
          )}
        </button>
        {existingAlias && (
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
        {error && <span className="error-text">{error}</span>}
      </div>
    </form>
  );
}
