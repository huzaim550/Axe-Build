import Link from "next/link";
import { db } from "@axebuild/db";
import { fmtAgo, fmtBytes, statusClass } from "@/lib/format";
import { AutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";

/**
 * The landing page: projects, not builds.
 *
 * A flat feed of every build across every app is what this used to be, and it
 * reads fine with one project and not at all with four — you cannot tell whose
 * APK just failed without reading each row. Builds now live inside the project
 * that owns them, the same shape Expo uses.
 */
export default async function Home() {
  const [projects, inFlight, sizes, released] = await Promise.all([
    db().project.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { builds: true } },
        // The newest build is the whole status line for a project — what ran,
        // how it went, how long ago.
        builds: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, buildType: true, createdAt: true },
        },
      },
    }),
    db().build.groupBy({
      by: ["projectId"],
      where: { status: { in: ["queued", "running"] } },
      _count: { _all: true },
    }),
    db().build.groupBy({ by: ["projectId"], _sum: { sizeBytes: true } }),
    db().build.findMany({
      where: { OR: [{ releasedApk: true }, { releasedUpdate: true }] },
      select: { projectId: true, releasedApk: true, releasedUpdate: true, versionName: true },
    }),
  ]);

  const busy = new Map(inFlight.map((r) => [r.projectId, r._count._all]));
  const disk = new Map(sizes.map((r) => [r.projectId, r._sum.sizeBytes ?? 0]));

  const totalBuilds = projects.reduce((sum, p) => sum + p._count.builds, 0);
  const totalBusy = inFlight.reduce((sum, r) => sum + r._count._all, 0);
  const totalDisk = sizes.reduce((sum, r) => sum + (r._sum.sizeBytes ?? 0), 0);
  const liveProjects = new Set(released.map((r) => r.projectId)).size;

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>Every app this server builds. Open one to see its builds and releases.</p>
        </div>
        <AutoRefresh />
      </div>

      <div className="metrics">
        <Metric
          value={String(projects.length)}
          label={projects.length === 1 ? "project" : "projects"}
        />
        <Metric value={String(totalBuilds)} label={totalBuilds === 1 ? "build" : "builds"} />
        <Metric
          value={String(totalBusy)}
          label={totalBusy === 0 ? "in flight — queue is idle" : "queued or running"}
        />
        <Metric value={fmtBytes(totalDisk)} label="of artifacts on disk" />
      </div>

      <div className="section-head">
        <h2>All projects</h2>
        {liveProjects > 0 && (
          <span className="faint" style={{ fontSize: 12 }}>
            {liveProjects} with a live release
          </span>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="card empty">
          <h2>No projects yet</h2>
          <p>Run the CLI inside an Expo project to register it with this server.</p>
          <pre>axe init</pre>
        </div>
      ) : (
        <div className="list">
          {projects.map((p) => {
            const last = p.builds[0];
            const running = busy.get(p.id) ?? 0;
            const live = released.filter((r) => r.projectId === p.id);
            const liveApk = live.find((r) => r.releasedApk);
            const liveUpdate = live.find((r) => r.releasedUpdate);

            return (
              <div className="list-row" key={p.id}>
                <div className="row-body">
                  <div className="row-title">
                    <Link href={`/projects/${p.slug}`}>{p.name}</Link>
                    {liveApk && (
                      <span className="pill pill-live">
                        live APK{liveApk.versionName ? ` ${liveApk.versionName}` : ""}
                      </span>
                    )}
                    {liveUpdate && <span className="pill pill-live">live OTA</span>}
                    {running > 0 && <span className="pill pill-running">{running} running</span>}
                  </div>

                  <div className="row-facts">
                    <span className="mono">{p.slug}</span>
                    <span className="sep">·</span>
                    <span>
                      {p._count.builds} {p._count.builds === 1 ? "build" : "builds"}
                    </span>
                    {last && (
                      <>
                        <span className="sep">·</span>
                        <span>last {last.buildType}</span>
                        <span className="sep">·</span>
                        <span className={statusClass(last.status)}>{last.status}</span>
                        <span className="sep">·</span>
                        <span title={last.createdAt.toLocaleString()}>
                          {fmtAgo(last.createdAt)}
                        </span>
                      </>
                    )}
                    {(disk.get(p.id) ?? 0) > 0 && (
                      <>
                        <span className="sep">·</span>
                        <span>{fmtBytes(disk.get(p.id) ?? 0)}</span>
                      </>
                    )}
                  </div>

                  {running > 0 && <div className="row-bar" />}
                </div>

                <div className="row-actions">
                  <Link className="btn btn-sm btn-ghost" href={`/projects/${p.slug}`}>
                    Open
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
