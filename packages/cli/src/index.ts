#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  cancelBuild,
  createProject,
  deleteKeystore,
  getBuild,
  getKeystore,
  listBuilds,
  listProjects,
  rebuildBuild,
  releaseBuild,
  setKeystore,
  uploadBuild,
} from "./api.js";
import { ABI_CHOICES, resolveAbi } from "./abi.js";
import {
  type GlobalConfig,
  loadGlobalConfig,
  loadProjectConfig,
  saveGlobalConfig,
  saveProjectConfig,
} from "./config.js";
import { packProject } from "./pack.js";
import { promptSecret } from "./prompt.js";

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
  .option("-t, --type <type>", "apk | aab | update (OTA-only: no Gradle, ~90s)", "apk")
  .option("-p, --profile <profile>", "release | debug", "release")
  .option("-a, --abi <abi>", `${ABI_CHOICES} — fewer ABIs build much faster`, "arm64")
  .option("--ota", "also export an OTA update bundle alongside the apk/aab")
  .option("-r, --release", "promote this build to the update channels once it succeeds")
  .action(async (opts: { type: string; profile: string; abi: string; ota?: boolean; release?: boolean }) => {
    const cfg = loadGlobalConfig();
    const cwd = process.cwd();
    const { projectSlug } = loadProjectConfig(cwd);
    const abi = resolveAbi(opts.abi);

    await warnIfNoAndroidPackage(cwd);

    console.log("Packing project (source only — no node_modules)...");
    const tarPath = await packProject(cwd);
    const tarball = await fs.readFile(tarPath);
    console.log(`Tarball: ${(tarball.length / 1024 / 1024).toFixed(1)} MB`);

    const { buildId } = await uploadBuild(cfg, {
      projectSlug,
      buildType: opts.type,
      profile: opts.profile,
      abi,
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
  .command("cancel")
  .description("Stop a queued or running build")
  .argument("<buildId>", "build id, or 'last' for this project's most recent build")
  .option("--force", "mark it canceled without waiting for the worker (stuck rows only)")
  .action(async (idOrLast: string, opts: { force?: boolean }) => {
    const cfg = loadGlobalConfig();
    const buildId = await resolveBuildId(cfg, idOrLast);
    const r = await cancelBuild(cfg, buildId, Boolean(opts.force));
    // "canceling" means the worker was asked to kill Gradle and hasn't finished
    // yet — saying "canceled" here would be a lie for another few seconds.
    console.log(
      r.status === "canceled"
        ? `Build ${buildId} canceled before it started.`
        : `Cancel requested — the worker is stopping build ${buildId}.`,
    );
  });

program
  .command("rebuild")
  .description("Queue the same source again, without re-uploading it")
  .argument("<buildId>", "build id, or 'last' for this project's most recent build")
  .option("-t, --type <type>", "override the build type (apk | aab | update)")
  .option("-p, --profile <profile>", "override the profile (release | debug)")
  .option("-a, --abi <abi>", `override the ABIs (${ABI_CHOICES})`)
  .option("--ota", "also export an OTA bundle this time")
  .action(
    async (
      idOrLast: string,
      opts: { type?: string; profile?: string; abi?: string; ota?: boolean },
    ) => {
      const cfg = loadGlobalConfig();
      const buildId = await resolveBuildId(cfg, idOrLast);
      const { buildId: newId } = await rebuildBuild(cfg, buildId, {
        buildType: opts.type,
        profile: opts.profile,
        abi: opts.abi === undefined ? undefined : resolveAbi(opts.abi),
        ota: opts.ota,
      });
      console.log(`Queued ${newId} from ${buildId}.`);
      console.log(`Dashboard: ${cfg.url}/builds/${newId}`);
    },
  );

program
  .command("release")
  .description("Promote a successful build so installed apps start receiving it")
  .argument("<buildId>", "build id, or 'last' for this project's most recent build")
  .option("--apk", "release only the APK (leave the current OTA bundle in place)")
  .option("--ota", "release only the OTA bundle (leave the current APK in place)")
  .option("--undo", "retire this build from both channels")
  .action(async (idOrLast: string, opts: { apk?: boolean; ota?: boolean; undo?: boolean }) => {
    const cfg = loadGlobalConfig();
    const buildId = await resolveBuildId(cfg, idOrLast);

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

const keystore = program
  .command("keystore")
  .description("The upload key this project's aab builds are signed with (Play Store)");

keystore
  .command("show", { isDefault: true })
  .description("Is an upload key configured for this project?")
  .action(async () => {
    const cfg = loadGlobalConfig();
    const { projectSlug } = loadProjectConfig(process.cwd());
    const ks = await getKeystore(cfg, projectSlug);
    if (!ks.configured) {
      console.log(`No upload key for '${projectSlug}'.`);
      console.log(`  aab builds will be debug-signed, and Google Play rejects those.`);
      console.log(`  Add one with:  axe keystore set <file.jks>`);
      return;
    }
    console.log(`Upload key configured for '${projectSlug}':`);
    console.log(`  alias: ${ks.keyAlias}`);
    console.log(`  file:  ${ks.file}`);
  });

keystore
  .command("set")
  .description("Upload a .jks so this project's aab builds are signed with it")
  .argument("<file>", "path to the keystore (.jks) file")
  .option("--alias <alias>", "key alias inside the keystore (auto-detected if there is only one)")
  .option("--key-password", "prompt for a separate key password (default: same as the store password)")
  .action(async (file: string, opts: { alias?: string; keyPassword?: boolean }) => {
    const cfg = loadGlobalConfig();
    const { projectSlug } = loadProjectConfig(process.cwd());

    const resolved = path.resolve(file);
    const bytes = await fs.readFile(resolved).catch(() => {
      throw new Error(`No such keystore file: ${resolved}`);
    });

    const storePassword = await promptSecret("Keystore password: ");
    if (!storePassword) throw new Error("A keystore password is required.");
    const keyPassword = opts.keyPassword
      ? await promptSecret("Key password: ")
      : undefined;

    // Ask keytool what is actually in the file before sending anything. This
    // catches the two mistakes the server cannot: a password that does not open
    // the keystore, and an alias that is not in it.
    const found = inspectKeystore(resolved, storePassword);

    if (found.kind === "bad-password") {
      throw new Error(
        `That password does not open ${path.basename(resolved)}. Nothing was uploaded.\n` +
          `  It is the password you typed at keytool's first prompt when you created the key.`,
      );
    }

    if (found.kind === "ok" && opts.alias && !found.aliases.includes(opts.alias)) {
      throw new Error(
        `No key called '${opts.alias}' in ${path.basename(resolved)}. Nothing was uploaded.\n` +
          `  It contains: ${found.aliases.join(", ")}`,
      );
    }

    // Typing the alias from memory is the other step people get wrong, and the
    // error it produces surfaces deep inside Gradle an hour later.
    const keyAlias =
      opts.alias ?? (found.kind === "ok" && found.aliases.length === 1 ? found.aliases[0] : undefined);

    if (!keyAlias) {
      const detail =
        found.kind === "ok"
          ? `  ${path.basename(resolved)} holds more than one key: ${found.aliases.join(", ")}`
          : `  (keytool could not tell us — list them with: keytool -list -keystore ${file})`;
      throw new Error(`Which key? Pass it explicitly:\n  axe keystore set ${file} --alias <alias>\n${detail}`);
    }

    if (found.kind === "unavailable") {
      console.warn(`note: could not verify the password with keytool — uploading it unchecked.`);
    }

    const r = await setKeystore(cfg, projectSlug, {
      file: bytes,
      filename: path.basename(resolved),
      keyAlias,
      storePassword,
      keyPassword,
    });
    console.log(`Upload key stored for '${projectSlug}' (alias ${r.keyAlias}).`);
    console.log(`Every 'axe build --type aab' for this project is now signed with it.`);
    console.log(`Back up ${path.basename(resolved)} and its password somewhere off this machine.`);
  });

keystore
  .command("rm")
  .description("Remove this project's upload key — aab builds go back to being debug-signed")
  .action(async () => {
    const cfg = loadGlobalConfig();
    const { projectSlug } = loadProjectConfig(process.cwd());
    const before = await getKeystore(cfg, projectSlug);
    if (!before.configured) {
      console.log(`No upload key for '${projectSlug}' — nothing to remove.`);
      return;
    }
    await deleteKeystore(cfg, projectSlug);
    console.log(`Removed the upload key for '${projectSlug}' (was alias ${before.keyAlias}).`);
    console.log(`The server's copy is gone. Your own .jks is untouched — do not lose it.`);
  });

type Inspection =
  | { kind: "ok"; aliases: string[] }
  | { kind: "bad-password" }
  | { kind: "unavailable" };

/**
 * Ask keytool what is in a keystore, and whether this password opens it.
 *
 * The password goes in on stdin, never on the argv: keytool accepts -storepass
 * but anything passed that way is readable in `ps` by every user on the box.
 *
 * Telling "wrong password" apart from "could not parse the output" is the whole
 * point. The server stores whatever password it is given without checking it,
 * so a typo here is not caught by anything until Gradle fails an hour into an
 * aab build with an error that names neither this command nor the password.
 */
function inspectKeystore(file: string, storePassword: string): Inspection {
  const r = spawnSync("keytool", ["-list", "-keystore", file], {
    input: `${storePassword}\n`,
    encoding: "utf8",
  });
  if (r.error) return { kind: "unavailable" };

  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) {
    // keytool says "keystore password was incorrect" for a JKS/PKCS12 whose
    // password is wrong, and "Keystore was tampered with" for some older files.
    return /password was incorrect|tampered with/i.test(output)
      ? { kind: "bad-password" }
      : { kind: "unavailable" };
  }

  const aliases = (r.stdout ?? "")
    .split("\n")
    .filter((line) => line.includes("PrivateKeyEntry"))
    .map((line) => line.split(",")[0]?.trim())
    .filter((a): a is string => Boolean(a));

  return aliases.length ? { kind: "ok", aliases } : { kind: "unavailable" };
}

/** Accepts a real build id, or `last` for the newest build of the current project. */
async function resolveBuildId(cfg: GlobalConfig, idOrLast: string): Promise<string> {
  if (idOrLast !== "last") return idOrLast;

  const { projectSlug } = loadProjectConfig(process.cwd());
  const builds = await listBuilds(cfg);
  // The list is newest-first, so the first match is the one meant by "last".
  const mine = builds.find((b) => b.project?.slug === projectSlug);
  if (!mine) throw new Error(`No builds yet for '${projectSlug}'.`);
  console.log(`last = ${mine.id} (${mine.buildType}, ${mine.status})`);
  return mine.id;
}

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
