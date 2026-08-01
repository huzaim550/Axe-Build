import { spawn } from "node:child_process";
import readline from "node:readline";

/**
 * Run a command and return its stdout. Unlike execStream this buffers, so it is
 * only for small, quick commands (`expo config --json`) — never Gradle.
 * stderr is dropped: the tools we call here chatter on it even on success.
 */
export function execCapture(
  command: string,
  args: string[],
  opts: ExecOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderrTail = "";
    child.stdout!.on("data", (c) => {
      stdout += c;
    });
    child.stderr!.on("data", (c) => {
      stderrTail = (stderrTail + c).slice(-2000);
    });

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            /* already gone */
          }
        }, opts.timeoutMs)
      : undefined;

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Command failed (exit ${code}): ${command} ${args.join(" ")}\n${stderrTail}`));
    });
  });
}

export interface ExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Kill the whole process group if it runs longer than this. */
  timeoutMs?: number;
}

/**
 * Run a command, yielding merged stdout+stderr line by line.
 * Spawns a detached process group so a timeout kills Gradle's child JVMs too.
 * Throws on non-zero exit or timeout.
 */
export async function* execStream(
  command: string,
  args: string[],
  opts: ExecOptions,
): AsyncGenerator<string, void, void> {
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines: string[] = [];
  let notify: (() => void) | undefined;
  let closed = false;
  let exitCode: number | null = null;
  let timedOut = false;

  const push = (line: string) => {
    lines.push(line);
    notify?.();
    notify = undefined;
  };

  readline.createInterface({ input: child.stdout! }).on("line", push);
  readline.createInterface({ input: child.stderr! }).on("line", push);

  const killGroup = () => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      /* already gone */
    }
  };

  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        killGroup();
      }, opts.timeoutMs)
    : undefined;

  child.on("error", (err) => {
    push(`[spawn error] ${err.message}`);
    closed = true;
    exitCode = -1;
    notify?.();
    notify = undefined;
  });

  child.on("close", (code) => {
    closed = true;
    exitCode = code;
    if (timer) clearTimeout(timer);
    notify?.();
    notify = undefined;
  });

  try {
    while (!closed || lines.length > 0) {
      if (lines.length > 0) {
        yield lines.shift()!;
        continue;
      }
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  } finally {
    // Generator abandoned early (worker shutdown): don't leave the build running.
    if (!closed) killGroup();
  }

  if (timedOut) {
    throw new Error(`Command timed out: ${command} ${args.join(" ")}`);
  }
  if (exitCode !== 0) {
    throw new Error(`Command failed (exit ${exitCode}): ${command} ${args.join(" ")}`);
  }
}
