/**
 * What a build may be asked for. Shared by the CLI upload route and Rebuild, so
 * the two can never drift into accepting different things.
 */

// Every extra ABI means compiling the whole native (C++) module graph again, so
// the default is the one architecture essentially every modern phone uses.
const ALL_ABIS = "armeabi-v7a,arm64-v8a,x86,x86_64";

export const ABI_PRESETS: Record<string, string> = {
  "arm64-v8a": "arm64-v8a",
  "arm64-v8a,armeabi-v7a": "arm64-v8a,armeabi-v7a",
  all: ALL_ABIS,
};

export const BUILD_TYPES = ["apk", "aab", "update"] as const;
export const PROFILES = ["release", "debug"] as const;

export type BuildType = (typeof BUILD_TYPES)[number];
export type Profile = (typeof PROFILES)[number];

export function isBuildType(value: unknown): value is BuildType {
  return typeof value === "string" && (BUILD_TYPES as readonly string[]).includes(value);
}

export function isProfile(value: unknown): value is Profile {
  return typeof value === "string" && (PROFILES as readonly string[]).includes(value);
}

/**
 * Resolve an ABI request to the comma-separated list Gradle gets.
 *
 * Accepts a preset name ("all") or a list that is already resolved, which is
 * what a rebuild passes back in from a stored build row.
 */
export function resolveAbi(input: string): string | null {
  if (ABI_PRESETS[input]) return ABI_PRESETS[input];
  return Object.values(ABI_PRESETS).includes(input) ? input : null;
}
