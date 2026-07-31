import { spawn } from "node:child_process";
import readline from "node:readline";

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
