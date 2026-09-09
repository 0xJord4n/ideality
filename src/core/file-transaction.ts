import { cp, lstat, mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface SnapshotEntry {
  path: string;
  backup: string;
  existed: boolean;
}

export interface FileTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function snapshotPaths(paths: string[]): Promise<FileTransaction> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ideality-transaction-"));
  const entries: SnapshotEntry[] = [];
  const unique = [...new Set(paths.map((entry) => path.resolve(entry)))];

  try {
    for (const [index, target] of unique.entries()) {
      const backup = path.join(root, String(index));
      const existed = await exists(target);
      if (existed) {
        await cp(target, backup, {
          recursive: true,
          force: true,
          preserveTimestamps: true,
        });
      }
      entries.push({ path: target, backup, existed });
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await rm(root, { recursive: true, force: true });
  };

  return {
    async commit() {
      await close();
    },
    async rollback() {
      if (closed) return;
      try {
        for (const entry of [...entries].reverse()) {
          await rm(entry.path, { recursive: true, force: true });
          if (entry.existed) {
            await mkdir(path.dirname(entry.path), { recursive: true });
            await cp(entry.backup, entry.path, {
              recursive: true,
              force: true,
              preserveTimestamps: true,
            });
          }
        }
      } finally {
        await close();
      }
    },
  };
}
