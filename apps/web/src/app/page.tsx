import Link from "next/link";
import { db } from "@axebuild/db";
import { token } from "@/lib/auth";
import { fmtAgo, fmtBytes, fmtDuration, statusClass } from "@/lib/format";
import { AutoRefresh } from "./auto-refresh";
import { DeleteBuildButton } from "./delete-build-button";

export const dynamic = "force-dynamic";

const RECENT = 50;

export default async function Home() {
  const [builds, totals] = await Promise.all([
    db().build.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT,
      include: { project: { select: { name: true, slug: true } } },
    }),
    db().build.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const count = (status: string) =>
    totals.find((row) => row.status === status)?._count._all ?? 0;
  const total = totals.reduce((sum, row) => sum + row._count._all, 0);
  const succeeded = count("success");
  const finished = succeeded + count("failed") + count("canceled");
  const inFlight = count("queued") + count("running");
  const diskUsed = builds.reduce((sum, b) => sum + (b.sizeBytes ?? 0), 0);

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Builds</h1>
          <p>Android APKs, AABs and OTA bundles, built on this machine.</p>
        </div>
        <AutoRefresh />
      </div>

      <div className="metrics">
        <Metric value={String(total)} label={total === 1 ? "build" : "builds"} />
        <Metric
          value={finished === 0 ? "—" : `${Math.round((succeeded / finished) * 100)}%`}
          label={`succeeded (${succeeded}/${finished})`}
        />
        <Metric
          value={String(inFlight)}
          label={inFlight === 0 ? "in flight — queue is idle" : "queued or running"}
        />
        <Metric value={fmtBytes(diskUsed)} label="of artifacts on disk" />
      </div>

      <div className="section-head">
        <h2>Recent</h2>
        <span className="faint" style={{ fontSize: 12 }}>
          {RECENT} most recent
        </span>
      </div>

      {builds.length === 0 ? (
        <div className="card empty">
          <h2>No builds yet</h2>
          <p>Run the CLI inside an Expo project and the build will appear here.</p>
          <pre>axe build --type apk</pre>
        </div>
      ) : (
        <div className="list">
          {builds.map((b) => {
            const running = b.status === "queued" || b.status === "running";
            const live = b.releasedApk || b.releasedUpdate;
            const liveWhat =
              b.releasedApk && b.releasedUpdate ? "APK+OTA" : b.releasedApk ? "APK" : "OTA";

            return (
              <div className="list-row" key={b.id}>
                <div className="row-body">
                  <div className="row-title">
                    <Link href={`/builds/${b.id}`}>{b.project.name}</Link>
                    <span className={statusClass(b.status)}>{b.status}</span>
                    {live && <span className="pill pill-live">live {liveWhat}</span>}
                  </div>

                  <div className="row-facts">
                    <span>
                      {b.buildType}/{b.profile}
                    </span>
                    {b.buildType !== "update" && (
                      <>
                        <span className="sep">·</span>
                        <span>{b.abi}</span>
                      </>
                    )}
                    {b.versionName && (
                      <>
                        <span className="sep">·</span>
                        <span>
                          {b.versionName} ({b.versionCode ?? "?"})
                        </span>
                      </>
                    )}
                    {/* A queued build has not started, so it has no duration to
                        show — an em dash in the middle of the line is noise. */}
                    {b.startedAt && (
                      <>
                        <span className="sep">·</span>
                        <span>{fmtDuration(b.startedAt, b.finishedAt)}</span>
                      </>
                    )}
                    {b.sizeBytes != null && (
                      <>
                        <span className="sep">·</span>
                        <span>{fmtBytes(b.sizeBytes)}</span>
                      </>
                    )}
                    <span className="sep">·</span>
                    <span title={b.createdAt.toLocaleString()}>{fmtAgo(b.createdAt)}</span>
                  </div>

                  {b.error && (
                    <div className="row-note error-text">{b.error.slice(0, 160)}</div>
                  )}

                  {running && <div className="row-bar" />}
                </div>

                <div className="row-actions">
                  <Link className="btn btn-sm btn-ghost" href={`/builds/${b.id}`}>
                    Open
                  </Link>
                  {b.status === "success" && b.artifactPath && (
                    <a
                      className="btn btn-sm"
                      href={`/api/builds/${b.id}/artifact?token=${encodeURIComponent(token())}`}
                    >
                      APK
                    </a>
                  )}
                  {!running && <DeleteBuildButton buildId={b.id} token={token()} ghost />}
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
