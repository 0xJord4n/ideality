export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  inherit?: boolean;
  signal?: AbortSignal;
}

export type ProcessRunner = (
  command: string[],
  options?: ProcessOptions,
) => Promise<ProcessResult>;

export const runProcess: ProcessRunner = async (command, options = {}) => {
  const inherit = options.inherit === true;
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: options.input === undefined ? (inherit ? "inherit" : "ignore") : "pipe",
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
    signal: options.signal,
  });
  if (options.input !== undefined && child.stdin) {
    child.stdin.write(options.input);
    child.stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    inherit ? Promise.resolve("") : new Response(child.stdout).text(),
    inherit ? Promise.resolve("") : new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

export async function requireSuccessfulProcess(
  command: string[],
  options: ProcessOptions = {},
  runner: ProcessRunner = runProcess,
): Promise<ProcessResult> {
  const result = await runner(command, options);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `Command failed (${result.exitCode}): ${command.join(" ")}${detail ? `\n${detail}` : ""}`,
    );
  }
  return result;
}
