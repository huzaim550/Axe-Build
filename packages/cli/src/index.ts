#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { createProject, getBuild, listProjects, releaseBuild, uploadBuild } from "./api.js";
import {
  loadGlobalConfig,
  loadProjectConfig,
  saveGlobalConfig,
  saveProjectConfig,
} from "./config.js";
import { packProject } from "./pack.js";

const program = new Command();

program
  .name("axe")
  .description(
    "Axe Build — upload an Expo project to your own build server and get an Android APK/AAB back",
  );

program
  .command("login")
  .description("Save the server URL + token to ~/.axebuild/config.json")
  .argument("<url>", "server URL, e.g. http://localhost:3000")
  .option("--token <token>", "API token (LOCAL_TOKEN of the server)", "dev-local-token")
  .action((url: string, opts: { token: string }) => {
    saveGlobalConfig({ url, token: opts.token });
    console.log(`Saved. Server: ${url}`);
  });

program
  .command("init")
  .description("Create/link a project on the server and write axe.json here")
  .option("--name <name>", "project name (default: current directory name)")
  .option("--slug <slug>", "link an existing project instead of creating one")
  .action(async (opts: { name?: string; slug?: string }) => {
    const cfg = loadGlobalConfig();
    const cwd = process.cwd();

    const projects = await listProjects(cfg);

    if (opts.slug) {
      if (!projects.some((p) => p.slug === opts.slug)) {
        throw new Error(
          `No project with slug '${opts.slug}' on ${cfg.url}.\n` +
            (projects.length
              ? `  Existing slugs: ${projects.map((p) => p.slug).join(", ")}`
              : `  The server has no projects yet — run 'axe init' without --slug.`),
        );
      }
      saveProjectConfig(cwd, { projectSlug: opts.slug });
      console.log(`Linked to existing project '${opts.slug}'.`);
      return;
    }

    const name = opts.name ?? path.basename(cwd);

    // The server resolves a slug collision by appending a random suffix, which
    // silently forks a second project — builds land there while the installed
    // app keeps polling the original slug. Catch it here, where we can still
    // tell the two cases apart.
    // Prefer the exact-slug match: with duplicates around, a name-only match can
    // point at the fork rather than the original this folder should relink to.
    const clash =
      projects.find((p) => p.slug === slugify(name)) ?? projects.find((p) => p.name === name);
    if (clash) {
      throw new Error(
        `Project '${clash.name}' (slug: ${clash.slug}) already exists on ${cfg.url}.\n` +
          `  To link this folder to it:\n` +
          `      axe init --slug ${clash.slug}\n` +
          `  To create a separate project:\n` +
          `      axe init --name <different-name>`,
      );
    }

    const project = await createProject(cfg, name);
    saveProjectConfig(cwd, { projectSlug: project.slug });
    console.log(`Created project '${project.name}' (slug: ${project.slug}). Wrote axe.json.`);
  });

program
  .command("build")
  .description("Tar the project source, upload it, and wait for the build to finish")
  .option("--type <type>", "apk | aab | update (OTA-only: no Gradle, ~90s)", "apk")
  .option("--profile <profile>", "release | debug", "release")
  .option(
    "--abi <abi>",
    "arm64-v8a | arm64-v8a,armeabi-v7a | all — fewer ABIs build much faster",
    "arm64-v8a",
  )
  .option("--ota", "also export an OTA update bundle alongside the apk/aab")
  .option("--release", "promote this build to the update channels once it succeeds")
  .action(async (opts: { type: string; profile: string; abi: string; ota?: boolean; release?: boolean }) => {
    const cfg = loadGlobalConfig();
    const cwd = process.cwd();
    const { projectSlug } = loadProjectConfig(cwd);

    await warnIfNoAndroidPackage(cwd);

    console.log("Packing project (source only — no node_modules)...");
    const tarPath = await packProject(cwd);
    const tarball = await fs.readFile(tarPath);
    console.log(`Tarball: ${(tarball.length / 1024 / 1024).toFixed(1)} MB`);

    const { buildId } = await uploadBuild(cfg, {
      projectSlug,
      buildType: opts.type,
      profile: opts.profile,
      abi: opts.abi,
      ota: Boolean(opts.ota),
      tarball,
    });
    await fs.rm(path.dirname(tarPath), { recursive: true, force: true });
    console.log(`Build queued: ${buildId}`);
    console.log(`Dashboard: ${cfg.url}`);

    const started = Date.now();
    let lastStatus = "";
    for (;;) {
      const build = await getBuild(cfg, buildId).catch(() => null);
      if (build && build.status !== lastStatus) {
        lastStatus = build.status;
        const t = Math.round((Date.now() - started) / 1000);
        console.log(`[${t}s] status: ${build.status}`);
      }
      if (lastStatus === "success") {
        console.log("");
        if (opts.type === "update") {
          console.log("Update bundle built (no APK — this was an OTA-only build).");
        } else {
          console.log("Build succeeded! Download your artifact:");
          console.log(`  ${cfg.url}/api/builds/${buildId}/artifact?token=${encodeURIComponent(cfg.token)}`);
          console.log("or:");
          console.log(`  curl -OJ -H "Authorization: Bearer ${cfg.token}" ${cfg.url}/api/builds/${buildId}/artifact`);
        }

        if (opts.release) {
          const r = await releaseBuild(cfg, buildId);
          console.log("");
          console.log(`Released to '${r.channel}': ${describeRelease(r)}`);
        } else {
          console.log("");
          console.log(`Not live yet. Promote it with:  axe release ${buildId}`);
        }
        return;
      }
      if (lastStatus === "failed" || lastStatus === "canceled") {
        const build2 = await getBuild(cfg, buildId).catch(() => null);
        console.error("");
        console.error(`Build ${lastStatus}.`);
        if (build2?.error) console.error(`Error: ${build2.error}`);
        console.error(`Check the dashboard for the full log: ${cfg.url}`);
        process.exitCode = 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  });

program
  .command("release")
  .description("Promote a successful build so installed apps start receiving it")
  .argument("<buildId>")
  .option("--apk", "release only the APK (leave the current OTA bundle in place)")
  .option("--ota", "release only the OTA bundle (leave the current APK in place)")
  .option("--undo", "retire this build from both channels")
  .action(async (buildId: string, opts: { apk?: boolean; ota?: boolean; undo?: boolean }) => {
    const cfg = loadGlobalConfig();

    // No flags = release whatever this build actually produced (server decides).
    let what: { apk?: boolean; update?: boolean } = {};
    if (opts.undo) what = { apk: false, update: false };
    else if (opts.apk && !opts.ota) what = { apk: true, update: false };
    else if (opts.ota && !opts.apk) what = { apk: false, update: true };

    const r = await releaseBuild(cfg, buildId, what);
    if (!r.releasedApk && !r.releasedUpdate) {
      console.log(`Build ${buildId} retired — it is no longer served to apps.`);
      return;
    }
    console.log(`Released to '${r.channel}': ${describeRelease(r)}`);
    if (r.releasedApk) {
      console.log(`  APK channel: ${cfg.url}/api/apps/<slug>/latest`);
    }
    if (r.releasedUpdate) {
      console.log(`  OTA runtimeVersion: ${r.runtimeVersion ?? "(none — apps will NOT match this)"}`);
    }
  });

function describeRelease(r: {
  releasedApk?: boolean;
  releasedUpdate?: boolean;
  versionName?: string | null;
  versionCode?: number | null;
}): string {
  const roles = [r.releasedApk && "APK", r.releasedUpdate && "OTA"].filter(Boolean).join(" + ");
  const version = r.versionName ? ` v${r.versionName} (${r.versionCode ?? "?"})` : "";
  return `${roles || "nothing"}${version}`;
}

/** Mirrors the slug the server derives in POST /api/projects, minus its collision suffix. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project"
  );
}

/** expo prebuild is non-interactive on the worker; missing android.package can make it fail there. */
async function warnIfNoAndroidPackage(cwd: string): Promise<void> {
  try {
    const appJson = JSON.parse(await fs.readFile(path.join(cwd, "app.json"), "utf8"));
    const pkg = appJson?.expo?.android?.package;
    if (!pkg) {
      console.warn(
        "note: app.json has no expo.android.package — expo prebuild will pick one automatically.",
      );
    }
  } catch {
    /* no app.json (maybe app.config.js) — let the worker sort it out */
  }
}

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
