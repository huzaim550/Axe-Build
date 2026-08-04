import Link from "next/link";
import { db } from "@axebuild/db";
import { token } from "@/lib/auth";
import { fmtBytes, fmtDuration, statusClass } from "@/lib/format";
import { CancelBuildButton } from "../../cancel-build-button";
import { DeleteBuildButton } from "../../delete-build-button";
import { BuildConsole } from "./console";
import { RebuildButton } from "./rebuild-button";
import { ReleaseButton } from "./release-button";

export const dynamic = "force-dynamic";

export default async function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const build = await db().build.findUnique({
    where: { id },
    include: { project: { select: { name: true, slug: true } } },
  });

  if (!build) {
    return (
      <main className="container">
        <div className="card empty">
          <h2>Build not found</h2>
          <p>It may have been deleted.</p>
          <p style={{ marginTop: 16 }}>
            <Link className="btn" href="/">
              Back to projects
            </Link>
          </p>
        </div>
      </main>
    );
  }

  // A queued or running build has nothing to download, promote or delete yet —
  // the only thing it can offer is a way to stop it.
  const finished = build.status !== "queued" && build.status !== "running";

  return (
    <main className="container">
      <Link href={`/projects/${build.project.slug}`} className="back-link">
        ← {build.project.name}
      </Link>

      <div className="page-head">
        <div>
          <h1>{build.project.name}</h1>
          <p className="mono faint" style={{ fontSize: 12.5 }}>
            {build.id}
          </p>
        </div>
        <div className="row">
          <span className={statusClass(build.status)}>{build.status}</span>
          {build.releasedApk || build.releasedUpdate ? (
            <span className="pill pill-live">
              live
              {build.releasedApk && build.releasedUpdate
                ? " APK+OTA"
                : build.releasedApk
                  ? " APK"
                  : " OTA"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>Overview</h2>
      </div>
      <div className="card">
        <div className="meta-grid">
          <Meta label="Type" value={`${build.buildType} / ${build.profile}`} />
          <Meta label="ABI" value={build.buildType === "update" ? "—" : build.abi} />
          <Meta
            label="Version"
            value={build.versionName ? `${build.versionName} (${build.versionCode ?? "?"})` : "—"}
          />
          <Meta label="Runtime" value={build.runtimeVersion ?? "—"} />
          <Meta label="Package" value={build.androidPackage ?? "—"} />
          <Meta label="Channel" value={build.channel} />
          <Meta label="Took" value={fmtDuration(build.startedAt, build.finishedAt)} />
          <Meta label="Size" value={fmtBytes(build.sizeBytes)} />
        </div>
      </div>

      <div className="section-head">
        <h2>Console</h2>
      </div>
      <BuildConsole
        buildId={build.id}
        token={token()}
        initialStatus={build.status}
        buildType={build.buildType}
      />

      {build.error && (
        <p className="error-text" style={{ marginTop: 12 }}>
          {build.error}
        </p>
      )}

      {!finished && (
        <>
          <div className="section-head">
            <h2>Actions</h2>
          </div>
          <div className="card">
            <div className="row">
              <CancelBuildButton buildId={build.id} token={token()} size="md" />
              <span className="faint" style={{ fontSize: 12.5 }}>
                {build.status === "queued"
                  ? "Not started yet — canceling drops it from the queue."
                  : "Stops Gradle and frees the worker for the next build."}
              </span>
            </div>
          </div>
        </>
      )}

      {finished && (
        <>
          <div className="section-head">
            <h2>Actions</h2>
          </div>
          <div className="card">
            <div className="row">
              {build.status === "success" && build.artifactPath && (
                <a
                  className="btn"
                  href={`/api/builds/${build.id}/artifact?token=${encodeURIComponent(token())}`}
                >
                  Download artifact
                </a>
              )}
              {build.status === "success" && (
                <ReleaseButton
                  buildId={build.id}
                  token={token()}
                  hasApk={Boolean(build.artifactPath)}
                  hasUpdate={Boolean(build.updateDirPath)}
                  releasedApk={build.releasedApk}
                  releasedUpdate={build.releasedUpdate}
                />
              )}
              <RebuildButton
                buildId={build.id}
                token={token()}
                buildType={build.buildType}
                ota={build.ota}
              />
              <span className="spacer" />
              <DeleteBuildButton
                buildId={build.id}
                token={token()}
                size="md"
                onDeleted={`/projects/${build.project.slug}`}
              />
            </div>

            {build.status === "success" && !build.runtimeVersion && build.updateDirPath && (
              <p className="note note-warn" style={{ marginTop: 14 }}>
                This build has an update bundle but no runtimeVersion, so it can never be matched
                to an installed app. Set <code>expo.runtimeVersion</code> in app.json and rebuild.
              </p>
            )}
          </div>
        </>
      )}
    </main>
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
