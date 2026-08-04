import Link from "next/link";
import { fmtAgo, fmtBytes, fmtDuration, statusClass } from "@/lib/format";
import { DeleteBuildButton } from "./delete-build-button";

/**
 * One build in a project's build list.
 *
 * Builds only ever appear inside the project that owns them, so the row leads
 * with the version rather than the project name — repeating the page title on
 * every row is noise.
 */
export type BuildRowData = {
  id: string;
  status: string;
  buildType: string;
  profile: string;
  abi: string;
  sizeBytes: number | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  versionName: string | null;
  versionCode: number | null;
  artifactPath: string | null;
  releasedApk: boolean;
  releasedUpdate: boolean;
};

/** The fields a row needs, as a Prisma `select`. */
export const BUILD_ROW_SELECT = {
  id: true,
  status: true,
  buildType: true,
  profile: true,
  abi: true,
  sizeBytes: true,
  error: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  versionName: true,
  versionCode: true,
  artifactPath: true,
  releasedApk: true,
  releasedUpdate: true,
} as const;

export function BuildRow({ build: b, token }: { build: BuildRowData; token: string }) {
  const running = b.status === "queued" || b.status === "running";
  const live = b.releasedApk || b.releasedUpdate;
  const liveWhat = b.releasedApk && b.releasedUpdate ? "APK+OTA" : b.releasedApk ? "APK" : "OTA";
  const version = b.versionName ? `${b.versionName} (${b.versionCode ?? "?"})` : null;

  return (
    <div className="list-row">
      <div className="row-body">
        <div className="row-title">
          <Link href={`/builds/${b.id}`}>{version ?? `${b.buildType} build`}</Link>
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
          {/* A queued build has not started, so it has no duration to show —
              an em dash in the middle of the line is noise. */}
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

        {b.error && <div className="row-note error-text">{b.error.slice(0, 160)}</div>}

        {running && <div className="row-bar" />}
      </div>

      <div className="row-actions">
        <Link className="btn btn-sm btn-ghost" href={`/builds/${b.id}`}>
          Open
        </Link>
        {b.status === "success" && b.artifactPath && (
          <a
            className="btn btn-sm"
            href={`/api/builds/${b.id}/artifact?token=${encodeURIComponent(token)}`}
          >
            APK
          </a>
        )}
        {!running && <DeleteBuildButton buildId={b.id} token={token} ghost />}
      </div>
    </div>
  );
}
