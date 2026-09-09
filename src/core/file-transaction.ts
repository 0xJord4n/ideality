import {
  chmod,
  chown,
  cp,
  lchown,
  lstat,
  lutimes,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  utimes,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface SnapshotMetadata {
  relativePath: string;
  depth: number;
  mode: number;
  uid: number;
  gid: number;
  atime: Date;
  mtime: Date;
  symbolicLink: boolean;
}

interface SnapshotEntry {
  path: string;
  backup: string;
  existed: boolean;
  metadata: SnapshotMetadata[];
}

export interface FileTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export async function rollbackAfterFailure(
  transaction: FileTransaction | null,
  operationError: unknown,
): Promise<never> {
  try {
    await transaction?.rollback();
  } catch (rollbackError) {
    throw new AggregateError(
      [operationError, rollbackError],
      "Operation failed and rollback was incomplete",
      { cause: operationError },
    );
  }
  throw operationError;
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

async function captureMetadata(
  target: string,
  relativePath = "",
): Promise<SnapshotMetadata[]> {
  const current = relativePath ? path.join(target, relativePath) : target;
  const info = await lstat(current);
  const metadata: SnapshotMetadata[] = [
    {
      relativePath,
      depth: relativePath ? relativePath.split(path.sep).length : 0,
      mode: info.mode & 0o7777,
      uid: info.uid,
      gid: info.gid,
      atime: info.atime,
      mtime: info.mtime,
      symbolicLink: info.isSymbolicLink(),
    },
  ];
  if (info.isDirectory() && !info.isSymbolicLink()) {
    for (const child of await readdir(current)) {
      metadata.push(
        ...(await captureMetadata(target, path.join(relativePath, child))),
      );
    }
  }
  return metadata;
}

async function restoreMetadata(
  target: string,
  metadata: SnapshotMetadata[],
): Promise<void> {
  for (const entry of [...metadata].sort((a, b) => b.depth - a.depth)) {
    const current = entry.relativePath
      ? path.join(target, entry.relativePath)
      : target;
    if (entry.symbolicLink) {
      if (process.platform !== "win32") {
        await lchown(current, entry.uid, entry.gid);
      }
      await lutimes(current, entry.atime, entry.mtime);
      continue;
    }
    if (process.platform !== "win32") {
      await chown(current, entry.uid, entry.gid);
    }
    await chmod(current, entry.mode);
    await utimes(current, entry.atime, entry.mtime);
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
      const metadata = existed ? await captureMetadata(target) : [];
      if (existed) {
        await cp(target, backup, {
          recursive: true,
          force: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
      }
      entries.push({ path: target, backup, existed, metadata });
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    await rm(root, { recursive: true, force: true });
    closed = true;
  };

  return {
    async commit() {
      await close();
    },
    async rollback() {
      if (closed) return;
      const failures: Error[] = [];
      for (const entry of [...entries].reverse()) {
        try {
          await rm(entry.path, { recursive: true, force: true });
          if (entry.existed) {
            await mkdir(path.dirname(entry.path), { recursive: true });
            await cp(entry.backup, entry.path, {
              recursive: true,
              force: true,
              preserveTimestamps: true,
              verbatimSymlinks: true,
            });
            await restoreMetadata(entry.path, entry.metadata);
          }
        } catch (error) {
          failures.push(
            new Error(`Failed to restore '${entry.path}'`, { cause: error }),
          );
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `Rollback incomplete; recovery data preserved at '${root}'`,
        );
      }
      await close();
    },
  };
}
