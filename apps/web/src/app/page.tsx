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

      <div className="stats">
        <Stat label="Builds" value={String(total)} sub={`${RECENT} most recent shown`} />
        <Stat
          label="Succeeded"
          value={finished === 0 ? "—" : `${Math.round((succeeded / finished) * 100)}%`}
          sub={`${succeeded} of ${finished} finished`}
        />
        <Stat
          label="In flight"
          value={String(inFlight)}
          sub={inFlight === 0 ? "queue is idle" : "queued or running"}
        />
        <Stat label="Artifacts" value={fmtBytes(diskUsed)} sub="across the builds below" />
      </div>

      <div className="section-head">
        <h2>Recent</h2>
      </div>

      {builds.length === 0 ? (
        <div className="card empty">
          <h2>No builds yet</h2>
          <p>Run the CLI inside an Expo project and the build will appear here.</p>
          <pre>axe build --type apk</pre>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Type</th>
                <th>Version</th>
                <th>Took</th>
                <th>Size</th>
                <th>Started</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {builds.map((b) => (
                <tr key={b.id}>
                  <td>
                    <div className="cell-main">
                      <Link href={`/builds/${b.id}`}>{b.project.name}</Link>
                    </div>
                    <div className="cell-sub">{b.id}</div>
                  </td>
                  <td>
                    <span className={statusClass(b.status)}>{b.status}</span>
                    {b.error && (
                      <div
                        className="cell-sub wrap-text"
                        style={{ color: "var(--failed)", maxWidth: 220 }}
                      >
                        {b.error.slice(0, 110)}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="tag">
                      {b.buildType}/{b.profile}
                    </span>
                    <div className="cell-sub">{b.buildType === "update" ? "OTA only" : b.abi}</div>
                  </td>
                  <td>
                    {b.versionName ? (
                      <>
                        <div className="cell-main mono">{b.versionName}</div>
                        <div className="cell-sub">code {b.versionCode ?? "?"}</div>
                      </>
                    ) : (
                      <span className="faint">—</span>
                    )}
                    {(b.releasedApk || b.releasedUpdate) && (
                      <div style={{ marginTop: 4 }}>
                        <span className="pill pill-live">
                          live
                          {b.releasedApk && b.releasedUpdate
                            ? " APK+OTA"
                            : b.releasedApk
                              ? " APK"
                              : " OTA"}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="mono dim">{fmtDuration(b.startedAt, b.finishedAt)}</td>
                  <td className="mono dim">{fmtBytes(b.sizeBytes)}</td>
                  <td className="dim" title={b.createdAt.toLocaleString()}>
                    {fmtAgo(b.createdAt)}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <Link className="btn btn-sm" href={`/builds/${b.id}`}>
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
                      {b.status !== "queued" && b.status !== "running" && (
                        <DeleteBuildButton buildId={b.id} token={token()} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
