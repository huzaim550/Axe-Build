import Link from "next/link";
import { db } from "@mybuild/db";
import { token } from "@/lib/auth";
import { BuildConsole } from "./console";

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
      <p style={{ color: "#565c66", fontSize: 12, marginTop: 0, marginBottom: 24 }}>{build.id}</p>

      <BuildConsole buildId={build.id} token={token()} initialStatus={build.status} />

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
    </main>
  );
}
