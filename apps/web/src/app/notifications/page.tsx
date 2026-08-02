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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>App</th>
                <th>Message</th>
                <th>Channel</th>
                <th>State</th>
                <th>Sent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sent.map((n) => {
                const s = state(n);
                return (
                  <tr key={n.id}>
                    <td className="cell-main">{n.project.name}</td>
                    <td className="wrap-text" style={{ maxWidth: 420 }}>
                      <div className="cell-main">{n.title}</div>
                      <div className="dim" style={{ fontSize: 13 }}>
                        {n.body}
                      </div>
                      {n.linkUrl && (
                        <a
                          className="cell-sub"
                          href={n.linkUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "inline-block", color: "var(--accent)" }}
                        >
                          {n.linkUrl}
                        </a>
                      )}
                    </td>
                    <td>
                      <span className="tag">{n.channel}</span>
                      <div className="cell-sub">{n.level}</div>
                    </td>
                    <td>
                      <span className={s.className}>{s.label}</span>
                      {n.expiresAt && (
                        <div className="cell-sub">until {n.expiresAt.toLocaleString()}</div>
                      )}
                    </td>
                    <td className="dim" title={n.createdAt.toLocaleString()}>
                      {fmtAgo(n.createdAt)}
                    </td>
                    <td>
                      {n.active && (
                        <RetractButton slug={n.project.slug} id={n.id} token={token()} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
