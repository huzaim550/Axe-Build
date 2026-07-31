export interface BuildSpec {
  buildId: string;
  /** Absolute path to the uploaded source tarball (read-only). */
  tarballPath: string;
  buildType: "apk" | "aab";
  profile: "release" | "debug";
  /** Comma-separated ABI list, e.g. "arm64-v8a". Fewer ABIs = far less C++ to compile. */
  abis: string;
  /** Fresh, empty directory the runner may do anything in. Deleted afterwards. */
  workspaceDir: string;
  /** Absolute deadline for the whole build. */
  deadline: number;
}

export interface RunnerResult {
  /** Path (inside the workspace) of the produced artifact. */
  artifactSourcePath: string;
}

/**
 * A runner turns a build spec into an artifact, yielding log lines as it goes.
 * Only AndroidRunner exists today; the interface keeps the door open without
 * stubbing other platforms.
 */
export interface Runner {
  run(spec: BuildSpec): AsyncGenerator<string, RunnerResult, void>;
}
