import readline from "node:readline";

/**
 * Ask for a secret without echoing it.
 *
 * A password on the command line ends up in shell history and in `ps`, so the
 * keystore commands prompt instead. When stdin is not a terminal the value is
 * read as a plain line, which is what makes `echo "$PW" | axe keystore set ...`
 * work in a script without a second code path.
 */
export function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) return readLine();

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Suppress the echo of everything after the question itself.
    let muted = false;
    const asAny = rl as unknown as { _writeToOutput: (s: string) => void };
    asAny._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.once("line", (line) => {
      // Resolve BEFORE closing: rl.close() emits "close" synchronously, so
      // closing first lets the handler below win the race and resolve "".
      resolve(line);
      rl.close();
    });
    rl.once("close", () => resolve(""));
  });
}
