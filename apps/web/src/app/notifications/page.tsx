import { db } from "@axebuild/db";
import { token } from "@/lib/auth";
import { fmtAgo } from "@/lib/format";
import { ComposeForm } from "./compose-form";
import { RetractButton } from "./retract-button";

export const dynamic = "force-dynamic";

/** Sent messages worth keeping on screen. Older ones stay in the DB. */
const HISTORY = 50;

function state(n: { active: boolean; expiresAt: Date | null }): {
  label: string;
  className: string;
} {
  if (!n.active) return { label: "retracted", className: "pill pill-muted" };
  if (n.expiresAt && n.expiresAt.getTime() <= Date.now()) {
    return { label: "expired", className: "pill pill-canceled" };
  }
  return { label: "live", className: "pill pill-success" };
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

  const liveCount = sent.filter((n) => state(n).label === "live").length;

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Messages installed apps fetch and show in their own inbox.</p>
        </div>
        {liveCount > 0 && <span className="pill pill-live">{liveCount} live</span>}
      </div>

      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>Compose</h2>
      </div>
      <ComposeForm projects={projects} token={token()} />

      <div className="section-head">
        <h2>Sent</h2>
      </div>

      {sent.length === 0 ? (
        <div className="card empty">
          <h2>Nothing sent yet</h2>
          <p>Anything you send above shows up here, with a way to take it back.</p>
        </div>
      ) : (
        <div className="list">
          {sent.map((n) => {
            const s = state(n);
            return (
              <div className="list-row" key={n.id}>
                <div className="row-body">
                  <div className="row-title">
                    {n.title}
                    <span className={s.className}>{s.label}</span>
                  </div>

                  <div className="row-note dim">{n.body}</div>

                  {n.linkUrl && (
                    <div className="row-note">
                      <a className="link mono" href={n.linkUrl} target="_blank" rel="noreferrer">
                        {n.linkUrl}
                      </a>
                    </div>
                  )}

                  <div className="row-facts">
                    <span>{n.project.name}</span>
                    <span className="sep">·</span>
                    <span>{n.channel}</span>
                    <span className="sep">·</span>
                    <span>{n.level}</span>
                    <span className="sep">·</span>
                    <span title={n.createdAt.toLocaleString()}>{fmtAgo(n.createdAt)}</span>
                    {n.expiresAt && (
                      <>
                        <span className="sep">·</span>
                        <span>until {n.expiresAt.toLocaleString()}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="row-actions">
                  {n.active && <RetractButton slug={n.project.slug} id={n.id} token={token()} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
