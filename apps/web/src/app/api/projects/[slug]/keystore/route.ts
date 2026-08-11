import fsp from "node:fs/promises";
import path from "node:path";
import { db } from "@axebuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";

/**
 * The upload key a project's `aab` builds are signed with.
 *
 * Without one, every bundle this server produces is signed with the Android
 * debug key and the Play Store refuses it on upload. Only `aab` builds use it:
 * signing the APKs too would change the signature of the sideloaded flavour,
 * and Android will not install an update signed by a different key.
 *
 * The passwords are stored in plaintext, like the rest of this server's
 * credentials. That is defensible only because the whole thing is
 * localhost/LAN-only with a single hardcoded token -- the same reasoning
 * already applied to the admin password and the R2 keys. It must never be
 * exposed through a tunnel.
 */

const KEYSTORES_DIR = process.env.KEYSTORES_DIR ?? "/data/keystores";
const MAX_KEYSTORE_BYTES = 1024 * 1024;

/** What is safe to hand back: never the passwords, never the file. */
function summarise(ks: { keyAlias: string; path: string } | null) {
  if (!ks) return { configured: false };
  return { configured: true, keyAlias: ks.keyAlias, file: path.basename(ks.path) };
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { slug } = await params;
  const project = await db().project.findUnique({
    where: { slug },
    include: { keystore: true },
  });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });
  return Response.json(summarise(project.keystore));
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { slug } = await params;

  const project = await db().project.findUnique({
    where: { slug },
    include: { keystore: true },
  });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected multipart form data" }, { status: 400 });

  const keyAlias = String(form.get("keyAlias") ?? "").trim();
  const storePassword = String(form.get("storePassword") ?? "");
  const keyPassword = String(form.get("keyPassword") ?? "") || storePassword;
  const file = form.get("keystore");

  if (!keyAlias) return Response.json({ error: "keyAlias is required" }, { status: 400 });
  if (!storePassword) {
    return Response.json({ error: "storePassword is required" }, { status: 400 });
  }
  if (!(file instanceof Blob) || file.size === 0) {
    return Response.json({ error: "keystore file is required" }, { status: 400 });
  }
  if (file.size > MAX_KEYSTORE_BYTES) {
    return Response.json({ error: "keystore file is implausibly large" }, { status: 413 });
  }

  // Named for the project, not the upload, so replacing a key overwrites the
  // old one rather than leaving a stale copy on the volume forever.
  const dest = path.join(KEYSTORES_DIR, `${project.slug}.jks`);
  try {
    await fsp.mkdir(KEYSTORES_DIR, { recursive: true });
    await fsp.writeFile(dest, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  } catch (err) {
    // An uncaught throw here is a bare 500 with no body, which sends whoever
    // hit it off to read container logs to discover something as ordinary as a
    // full disk or an unwritable volume. Say which, in the response.
    const code = (err as NodeJS.ErrnoException)?.code;
    const reason =
      code === "EACCES" || code === "EPERM"
        ? `${KEYSTORES_DIR} is not writable by this container — check the keystores volume`
        : code === "ENOSPC"
          ? "no space left on the server's disk"
          : `${code ?? "unknown error"} writing the keystore`;
    return Response.json({ error: `could not store the keystore: ${reason}` }, { status: 500 });
  }

  const data = { path: dest, keyAlias, storePassword, keyPassword };
  const keystore = await db().keystore.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id, ...data },
    update: data,
  });

  return Response.json(summarise(keystore));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { slug } = await params;
  const project = await db().project.findUnique({
    where: { slug },
    include: { keystore: true },
  });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });
  if (!project.keystore) return Response.json({ configured: false });

  // The row goes first: a keystore the database has forgotten is harmless, but
  // a row pointing at a file that is gone fails every aab build with an error
  // from deep inside Gradle.
  await db().keystore.delete({ where: { projectId: project.id } });
  await fsp.rm(project.keystore.path, { force: true });
  return Response.json({ configured: false, deleted: true });
}
