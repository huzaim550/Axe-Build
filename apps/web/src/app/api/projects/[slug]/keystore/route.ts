import fsp from "node:fs/promises";
import path from "node:path";
import { db } from "@axebuild/db";
import { isAuthorized, unauthorized } from "@/lib/auth";

const KEYSTORES_DIR = process.env.KEYSTORES_DIR ?? "/data/keystores";
// A keystore holding one key is a couple of kilobytes. Anything near this is
// the wrong file.
const MAX_KEYSTORE_BYTES = 1024 * 1024;

/**
 * Does this look like a Java keystore at all?
 *
 * JKS files start with the magic 0xFEEDFEED; PKCS#12 (what `keytool` produces
 * by default now) is DER, so it starts with a SEQUENCE tag, 0x30. This catches
 * the actual mistake people make — uploading the APK, or a .txt of the
 * passwords — and cannot catch a wrong password, which only Gradle can tell us.
 */
function looksLikeKeystore(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  const jks = bytes.readUInt32BE(0) === 0xfeedfeed;
  const pkcs12 = bytes[0] === 0x30;
  return jks || pkcs12;
}

/**
 * Attach a release keystore to a project.
 *
 * Every build after this is signed with it, which is what makes an APK
 * upgradable in place. Android identifies an app by package name *and* signing
 * key, so this is a one-way door in practice: change the key later and existing
 * installs can only take the new version by being uninstalled first.
 *
 * multipart/form-data: keystore (file), keyAlias, storePassword, keyPassword.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { slug } = await params;

  const project = await db().project.findUnique({ where: { slug } });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected multipart form data" }, { status: 400 });

  const file = form.get("keystore");
  const keyAlias = String(form.get("keyAlias") ?? "").trim();
  const storePassword = String(form.get("storePassword") ?? "");
  // Most keystores use the same password for both; an empty key password means
  // "same as the store", which is what keytool does when you press enter.
  const keyPassword = String(form.get("keyPassword") ?? "") || storePassword;

  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "keystore file is required" }, { status: 400 });
  }
  if (file.size > MAX_KEYSTORE_BYTES) {
    return Response.json({ error: "that file is far too large to be a keystore" }, { status: 413 });
  }
  if (!keyAlias) return Response.json({ error: "keyAlias is required" }, { status: 400 });
  if (!storePassword) {
    return Response.json({ error: "storePassword is required" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLikeKeystore(bytes)) {
    return Response.json(
      { error: "that file is not a JKS or PKCS#12 keystore — see DOCS.md on creating one" },
      { status: 400 },
    );
  }

  // Named after the project id, never after anything from the URL: this path is
  // handed to `fs` and later to Gradle.
  const storePath = path.join(KEYSTORES_DIR, `${project.id}.jks`);
  await fsp.mkdir(KEYSTORES_DIR, { recursive: true });
  // 0600: the passwords are in the database, but the key material itself has no
  // business being world-readable inside the volume.
  await fsp.writeFile(storePath, bytes, { mode: 0o600 });

  await db().keystore.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id, path: storePath, keyAlias, storePassword, keyPassword },
    update: { path: storePath, keyAlias, storePassword, keyPassword },
  });

  // Deliberately no passwords in the response — this lands in a browser.
  return Response.json({ project: project.slug, keyAlias, bytes: bytes.length }, { status: 201 });
}

/**
 * Detach the keystore. The next build falls back to Gradle's debug key, and
 * anything already installed from a signed build can no longer be upgraded in
 * place — so this is worth being sure about.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { slug } = await params;

  const project = await db().project.findUnique({
    where: { slug },
    include: { keystore: true },
  });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });
  if (!project.keystore) {
    return Response.json({ error: "this project has no keystore" }, { status: 404 });
  }

  // Path check before unlinking: the row is ours, but this is still an rm.
  const stored = path.resolve(project.keystore.path);
  if (stored.startsWith(path.resolve(KEYSTORES_DIR) + path.sep)) {
    await fsp.rm(stored, { force: true });
  }
  await db().keystore.delete({ where: { projectId: project.id } });

  return Response.json({ project: project.slug, deleted: true });
}
