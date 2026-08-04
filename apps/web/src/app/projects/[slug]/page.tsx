import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@axebuild/db";
import { token } from "@/lib/auth";
import { fmtAgo, fmtBytes } from "@/lib/format";
import { AutoRefresh } from "../../auto-refresh";
import { BUILD_ROW_SELECT, BuildRow } from "../../build-row";
import { KeystoreForm } from "./keystore-form";
import { RemoveKeystoreButton } from "./remove-keystore-button";

export const dynamic = "force-dynamic";

/** Builds worth keeping on screen. Older ones stay in the DB. */
const RECENT = 50;

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const project = await db().project.findUnique({
    where: { slug },
    include: {
      _count: { select: { builds: true, notifications: true } },
      // Only the alias is ever read out of this — the passwords stay server-side.
      keystore: { select: { keyAlias: true } },
    },
  });
  if (!project) notFound();

  const [builds, totals, released] = await Promise.all([
    db().build.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      take: RECENT,
      select: BUILD_ROW_SELECT,
    }),
    db().build.groupBy({
      by: ["status"],
      where: { projectId: project.id },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    }),
    db().build.findMany({
      where: {
        projectId: project.id,
        OR: [{ releasedApk: true }, { releasedUpdate: true }],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        channel: true,
        buildType: true,
        versionName: true,
        versionCode: true,
        runtimeVersion: true,
        sizeBytes: true,
        releasedApk: true,
        releasedUpdate: true,
        finishedAt: true,
        createdAt: true,
      },
    }),
  ]);

  const count = (status: string) => totals.find((r) => r.status === status)?._count._all ?? 0;
  const succeeded = count("success");
  const finished = succeeded + count("failed") + count("canceled");
  const inFlight = count("queued") + count("running");
  const diskUsed = totals.reduce((sum, r) => sum + (r._sum.sizeBytes ?? 0), 0);

  const liveApk = released.find((b) => b.releasedApk);
  const liveUpdate = released.find((b) => b.releasedUpdate);

  return (
    <main className="container">
      <Link href="/" className="back-link">
        ← All projects
      </Link>

      <div className="page-head">
        <div>
          <h1>{project.name}</h1>
          <p className="mono faint" style={{ fontSize: 12.5 }}>
            {project.slug}
          </p>
        </div>
        <AutoRefresh />
      </div>

      <div className="metrics">
        <Metric
          value={String(project._count.builds)}
          label={project._count.builds === 1 ? "build" : "builds"}
        />
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

      <div className="section-head" style={{ marginTop: 22 }}>
        <h2>Live</h2>
        <span className="faint" style={{ fontSize: 12 }}>
          what installed apps are being served
        </span>
      </div>

      {!liveApk && !liveUpdate ? (
        <div className="card">
          <p className="note">
            Nothing released yet. Open a successful build and press Release to serve it to
            installed apps.
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="meta-grid">
            <Meta
              label="APK"
              value={
                liveApk
                  ? `${liveApk.versionName ?? "—"} (${liveApk.versionCode ?? "?"})`
                  : "not released"
              }
            />
            <Meta
              label="OTA"
              value={liveUpdate ? (liveUpdate.runtimeVersion ?? "no runtimeVersion") : "not released"}
            />
            <Meta label="Channel" value={(liveApk ?? liveUpdate)?.channel ?? "—"} />
            <Meta
              label="Released"
              value={(() => {
                const b = liveApk ?? liveUpdate;
                return b ? fmtAgo(b.finishedAt ?? b.createdAt) : "—";
              })()}
            />
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            {liveApk && (
              <a className="btn btn-sm" href={`/api/apps/${project.slug}/latest/download`}>
                Download live APK
              </a>
            )}
            {liveApk && (
              <Link className="btn btn-sm btn-ghost" href={`/builds/${liveApk.id}`}>
                Open its build
              </Link>
            )}
            {liveUpdate && liveUpdate.id !== liveApk?.id && (
              <Link className="btn btn-sm btn-ghost" href={`/builds/${liveUpdate.id}`}>
                Open OTA build
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="section-head">
        <h2>Signing</h2>
        <span className={project.keystore ? "pill pill-success" : "pill pill-muted"}>
          {project.keystore ? "release keystore" : "debug key"}
        </span>
      </div>

      <div className="card">
        {project.keystore ? (
          <div className="stack">
            <div className="row">
              <span>
                Release builds are signed with alias{" "}
                <span className="mono">{project.keystore.keyAlias}</span>.
              </span>
              <span className="spacer" />
              <KeystoreForm
                slug={project.slug}
                token={token()}
                existingAlias={project.keystore.keyAlias}
              />
              <RemoveKeystoreButton slug={project.slug} token={token()} />
            </div>
            <p className="note">
              Keep a backup of this keystore somewhere off this machine. Without it you can never
              ship an upgrade to anyone who already installed the app.
            </p>
          </div>
        ) : (
          <div className="stack">
            <p className="note note-warn">
              Release builds are signed with Gradle&apos;s throwaway debug key. They install fine,
              but a later build signed with a real keystore cannot upgrade over them — your users
              would have to uninstall first. Upload one before you ship to anybody.
            </p>
            <p className="faint" style={{ fontSize: 12.5 }}>
              Don&apos;t have one? Create it once, on your own machine, and keep it safe:
            </p>
            <pre className="log" style={{ maxHeight: 90 }}>
              keytool -genkeypair -v -keystore {project.slug}.jks -alias upload \{"\n"}
              {"  "}-keyalg RSA -keysize 2048 -validity 10000
            </pre>
            <KeystoreForm slug={project.slug} token={token()} />
          </div>
        )}
      </div>

      <div className="section-head">
        <h2>Builds</h2>
        <span className="faint" style={{ fontSize: 12 }}>
          {project._count.builds > RECENT ? `${RECENT} most recent` : "all"}
        </span>
      </div>

      {builds.length === 0 ? (
        <div className="card empty">
          <h2>No builds yet</h2>
          <p>Run the CLI inside this Expo project and the build will appear here.</p>
          <pre>axe build --type apk</pre>
        </div>
      ) : (
        <div className="list">
          {builds.map((b) => (
            <BuildRow key={b.id} build={b} token={token()} />
          ))}
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="meta-label">{label}</div>
      <div className="meta-value">{value}</div>
    </div>
  );
}
