import { expect, test } from "bun:test";
import {
  chmod,
  chown,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rollbackAfterFailure } from "../src/core/file-transaction.js";

test("rollback failure reports both the operation and rollback errors", async () => {
  const operationError = new Error("operation failed");
  const rollbackError = new Error("rollback failed");
  try {
    await rollbackAfterFailure(
      {
        async commit() {},
        async rollback() {
          throw rollbackError;
        },
      },
      operationError,
    );
    throw new Error("expected rollbackAfterFailure to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    const aggregate = error as AggregateError;
    expect(aggregate.errors).toEqual([operationError, rollbackError]);
  }
});

test("filesystem rollback continues after metadata errors and preserves recovery data", async () => {
  if (process.platform !== "linux" || process.geteuid?.() !== 0) return;
  const setpriv = Bun.which("setpriv");
  if (!setpriv) return;

  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ideality-transaction-recovery-"),
  );
  const marker = path.join(directory, "marker");
  const target = path.join(directory, "target");
  const link = path.join(directory, "link");
  const originalMarker = "original-marker\n";
  const originalTarget = "original-target\n";
  let recoveryRoot: string | null = null;

  try {
    await chmod(directory, 0o777);
    await writeFile(marker, originalMarker);
    await writeFile(target, originalTarget);
    await chown(marker, 65534, 65534);
    await chown(target, 65534, 65534);
    await symlink(path.basename(target), link);

    const script = `
      import { writeFile } from "node:fs/promises";
      import { snapshotPaths } from "./src/core/file-transaction.ts";
      const tx = await snapshotPaths([
        process.env.MARKER,
        process.env.LINK,
        process.env.TARGET,
      ]);
      await writeFile(process.env.MARKER, "changed-marker\\n");
      await writeFile(process.env.TARGET, "changed-target\\n");
      try {
        await tx.rollback();
        console.log(JSON.stringify({ ok: true }));
      } catch (error) {
        console.log(JSON.stringify({
          ok: false,
          name: error?.name,
          message: error?.message,
        }));
      }
    `;
    const result = Bun.spawnSync({
      cmd: [
        setpriv,
        "--reuid=65534",
        "--regid=65534",
        "--clear-groups",
        process.execPath,
        "-e",
        script,
      ],
      cwd: path.resolve(import.meta.dir, ".."),
      env: { ...process.env, MARKER: marker, LINK: link, TARGET: target },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const outcome = JSON.parse(result.stdout.toString());
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("recovery data preserved at");
    const match = outcome.message.match(/recovery data preserved at '([^']+)'/);
    expect(match).not.toBeNull();
    recoveryRoot = match?.[1] ?? null;
    expect(recoveryRoot).not.toBeNull();
    expect((await stat(recoveryRoot!)).isDirectory()).toBe(true);
    expect(await readFile(marker, "utf8")).toBe(originalMarker);
    expect(await readFile(target, "utf8")).toBe(originalTarget);
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (recoveryRoot) {
      await rm(recoveryRoot, { recursive: true, force: true });
    }
  }
});
