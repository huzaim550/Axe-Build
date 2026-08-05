/**
 * An upload key, for builds that have to be accepted by a store.
 *
 * Only ever applied to `aab` builds. Signing the APKs too would change the
 * signature of the sideloaded flavour, and Android refuses to install an update
 * signed by a different key -- so every existing install would have to be
 * uninstalled, losing its data, the first time a project uploaded a keystore.
 */
export interface KeystoreSpec {
  /** Absolute path to the .jks/.keystore on the keystores volume. */
  path: string;
  keyAlias: string;
  storePassword: string;
  keyPassword: string;
}

export interface BuildSpec {
  buildId: string;
  /** Absolute path to the uploaded source tarball (read-only). */
  tarballPath: string;
  /** "update" is OTA-only: it exports a JS bundle and never runs prebuild/Gradle. */
  buildType: "apk" | "aab" | "update";
  profile: "release" | "debug";
  /** Comma-separated ABI list, e.g. "arm64-v8a". Fewer ABIs = far less C++ to compile. */
  abis: string;
  /** Also export an OTA bundle alongside the apk/aab. Ignored when buildType is "update". */
  ota: boolean;
  /** Fresh, empty directory the runner may do anything in. Deleted afterwards. */
  workspaceDir: string;
  /** Absolute deadline for the whole build. */
  deadline: number;
  /** Aborted when the build is cancelled from the dashboard. */
  signal: AbortSignal;
  /** Set when the project has one and this build is an aab. See KeystoreSpec. */
  keystore?: KeystoreSpec;
}

/** App identity, read from `expo config` — all optional, a build still succeeds without it. */
export interface AppMeta {
  versionName?: string;
  versionCode?: number;
  androidPackage?: string;
  runtimeVersion?: string;
}

export interface RunnerResult {
  /** Path (inside the workspace) of the produced artifact. Absent for OTA-only builds. */
  artifactSourcePath?: string;
  /** Directory (inside the workspace) holding the `expo export` output, if one was made. */
  updateSourceDir?: string;
  meta: AppMeta;
}

/**
 * A runner turns a build spec into an artifact, yielding log lines as it goes.
 * Only AndroidRunner exists today; the interface keeps the door open without
 * stubbing other platforms.
 */
export interface Runner {
  run(spec: BuildSpec): AsyncGenerator<string, RunnerResult, void>;
}
