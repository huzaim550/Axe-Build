/**
 * Short names for the ABI lists the server accepts.
 *
 * `--abi arm64-v8a,armeabi-v7a` is the right answer for a phone app and nobody
 * can type it from memory, so the useful spellings get names. Resolution
 * happens here rather than on the server so a CLI newer than the server it
 * talks to still works: what goes over the wire is always a string the server
 * already understood.
 */
const ALIASES: Record<string, string> = {
  arm64: "arm64-v8a",
  "arm64-v8a": "arm64-v8a",
  phone: "arm64-v8a,armeabi-v7a",
  phones: "arm64-v8a,armeabi-v7a",
  "arm64-v8a,armeabi-v7a": "arm64-v8a,armeabi-v7a",
  all: "all",
};

/** Every spelling a user might reasonably type, for error messages and --help. */
export const ABI_CHOICES = "arm64 | phone | all";

export function resolveAbi(input: string): string {
  const hit = ALIASES[input.trim()];
  if (hit) return hit;
  throw new Error(
    `Unknown --abi '${input}'. Use one of:\n` +
      `  arm64   arm64-v8a only — every phone from ~2015 on, fastest build\n` +
      `  phone   arm64-v8a,armeabi-v7a — the above plus old 32-bit devices\n` +
      `  all     adds x86,x86_64 for emulators and Chromebooks — much heavier`,
  );
}
