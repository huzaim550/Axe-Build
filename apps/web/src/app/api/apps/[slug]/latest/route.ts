import { baseUrl, findReleasedApk } from "@/lib/updates";

export const dynamic = "force-dynamic";

/**
 * What an installed app polls to find out a newer APK exists. Compare
 * `versionCode` against the running build (expo-application's
 * nativeBuildVersion) and send the user to `downloadUrl` if it's higher.
 *
 * PUBLIC (no token) — see the note in @/lib/updates.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const channel = new URL(req.url).searchParams.get("channel") ?? "production";

  const build = await findReleasedApk(slug, channel);
  if (!build) {
    return Response.json({ error: "no released build for this project" }, { status: 404 });
  }

  const query = channel === "production" ? "" : `?channel=${encodeURIComponent(channel)}`;
  return Response.json(
    {
      buildId: build.id,
      project: build.project.slug,
      channel,
      buildType: build.buildType,
      versionName: build.versionName,
      versionCode: build.versionCode,
      androidPackage: build.androidPackage,
      runtimeVersion: build.runtimeVersion,
      sizeBytes: build.sizeBytes,
      createdAt: (build.finishedAt ?? build.createdAt).toISOString(),
      downloadUrl: `${baseUrl(req)}/api/apps/${encodeURIComponent(slug)}/latest/download${query}`,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
