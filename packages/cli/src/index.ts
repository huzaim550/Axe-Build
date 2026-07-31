#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { createProject, getBuild, uploadBuild } from "./api.js";
import {
  loadGlobalConfig,
  loadProjectConfig,
  saveGlobalConfig,
  saveProjectConfig,
} from "./config.js";
import { packProject } from "./pack.js";

const program = new Command();

program
  .name("build-cli")
  .description("Upload an Expo project to your local mybuild server and get an Android APK/AAB back");

program
  .command("login")
  .description("Save the server URL + token to ~/.mybuild/config.json")
  .argument("<url>", "server URL, e.g. http://localhost:3000")
  .option("--token <token>", "API token (LOCAL_TOKEN of the server)", "dev-local-token")
  .action((url: string, opts: { token: string }) => {
    saveGlobalConfig({ url, token: opts.token });
    console.log(`Saved. Server: ${url}`);
  });

program
  .command("init")
  .description("Create/link a project on the server and write mybuild.json here")
  .option("--name <name>", "project name (default: current directory name)")
  .option("--slug <slug>", "link an existing project instead of creating one")
  .action(async (opts: { name?: string; slug?: string }) => {
    const cfg = loadGlobalConfig();
    const cwd = process.cwd();

    if (opts.slug) {
      saveProjectConfig(cwd, { projectSlug: opts.slug });
      console.log(`Linked to existing project '${opts.slug}'.`);
      return;
    }

    const name = opts.name ?? path.basename(cwd);
    const project = await createProject(cfg, name);
    saveProjectConfig(cwd, { projectSlug: project.slug });
    console.log(`Created project '${project.name}' (slug: ${project.slug}). Wrote mybuild.json.`);
  });

program
  .command("build")
  .description("Tar the project source, upload it, and wait for the build to finish")
  .option("--type <type>", "apk | aab", "apk")
  .option("--profile <profile>", "release | debug", "release")
  .action(async (opts: { type: string; profile: string }) => {
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
        console.log("Build succeeded! Download your artifact:");
        console.log(`  ${cfg.url}/api/builds/${buildId}/artifact?token=${encodeURIComponent(cfg.token)}`);
        console.log("or:");
        console.log(`  curl -OJ -H "Authorization: Bearer ${cfg.token}" ${cfg.url}/api/builds/${buildId}/artifact`);
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
