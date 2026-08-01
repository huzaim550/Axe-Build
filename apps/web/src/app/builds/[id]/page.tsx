import Link from "next/link";
import { db } from "@mybuild/db";
import { token } from "@/lib/auth";
import { BuildConsole } from "./console";
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
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 16px" }}>
        <p>Build not found.</p>
        <Link href="/" style={{ color: "#3b82f6" }}>
          ← back
        </Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 16px" }}>
      <Link href="/" style={{ color: "#3b82f6", fontSize: 13 }}>
        ← all builds
      </Link>
      <h1 style={{ fontSize: 20, marginTop: 8, marginBottom: 4 }}>
        {build.project.name} — {build.buildType}/{build.profile}
      </h1>
      <p style={{ color: "#565c66", fontSize: 12, marginTop: 0, marginBottom: 8 }}>{build.id}</p>

      {(build.versionName || build.runtimeVersion) && (
        <p style={{ color: "#8a8f98", fontSize: 13, marginTop: 0, marginBottom: 24 }}>
          v{build.versionName ?? "?"} (code {build.versionCode ?? "?"})
          {build.runtimeVersion && <> · runtime {build.runtimeVersion}</>}
          {build.androidPackage && <> · {build.androidPackage}</>}
        </p>
      )}

      <BuildConsole
        buildId={build.id}
        token={token()}
        initialStatus={build.status}
        buildType={build.buildType}
      />

      {build.status === "success" && build.artifactPath && (
        <p style={{ marginTop: 16 }}>
          <a
            href={`/api/builds/${build.id}/artifact?token=${encodeURIComponent(token())}`}
            style={{ color: "#3b82f6" }}
          >
            Download artifact
          </a>
        </p>
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

      {build.status === "success" && !build.runtimeVersion && build.updateDirPath && (
        <p style={{ color: "#f59e0b", fontSize: 13, marginTop: 12 }}>
          This build has an update bundle but no runtimeVersion, so it can never be matched to an
          installed app. Set <code>expo.runtimeVersion</code> in app.json and rebuild.
        </p>
      )}
    </main>
  );
}
