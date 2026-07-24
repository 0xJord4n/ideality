import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

const PRIVATE_KEY_HEADERS = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN ENCRYPTED PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN EC PRIVATE KEY-----",
  "-----BEGIN DSA PRIVATE KEY-----",
  "PuTTY-User-Key-File-",
];
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".next",
  ".turbo",
  ".venv",
  "dist",
  "node_modules",
  "target",
]);

async function isPrivateKeyFile(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, "r");
    const buffer = Buffer.alloc(256);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString("utf8").trimStart();
    return PRIVATE_KEY_HEADERS.some((candidate) => header.startsWith(candidate));
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

async function collectFiles(
  directory: string,
  maxDepth: number,
  depth = 0,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile()) {
      files.push(candidate);
    } else if (entry.isSymbolicLink()) {
      try {
        if ((await stat(candidate)).isFile()) files.push(candidate);
      } catch {
        // Ignore broken or inaccessible links.
      }
    } else if (entry.isDirectory() && depth < maxDepth) {
      files.push(...(await collectFiles(candidate, maxDepth, depth + 1)));
    }
  }
  return files;
}

export async function findSshPrivateKeys(options: {
  home: string;
  idealityHome: string;
  preferred?: string;
}): Promise<string[]> {
  const candidates = [
    ...(options.preferred ? [path.resolve(options.preferred)] : []),
    ...(await collectFiles(path.join(options.idealityHome, "ssh"), 2)),
    ...(await collectFiles(path.join(options.home, ".ssh"), 3)),
  ];
  const unique = [...new Set(candidates)];
  const checks = await Promise.all(
    unique.map(async (file) => ({
      file,
      privateKey: await isPrivateKeyFile(file),
    })),
  );
  return checks
    .filter(({ privateKey }) => privateKey)
    .map(({ file }) => file);
}

async function collectDirectories(
  directory: string,
  maxDepth: number,
  depth = 0,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const directories: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (
      !entry.isDirectory() ||
      SKIPPED_DIRECTORIES.has(entry.name) ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const candidate = path.join(directory, entry.name);
    directories.push(candidate);
    if (depth < maxDepth) {
      directories.push(
        ...(await collectDirectories(candidate, maxDepth, depth + 1)),
      );
    }
  }
  return directories;
}

export async function findIdentityDirectories(home: string): Promise<string[]> {
  const roots = ["code", "projects", "workspace"]
    .map((name) => path.join(home, name))
    .filter((directory, index, all) => all.indexOf(directory) === index);
  return (
    await Promise.all(roots.map((directory) => collectDirectories(directory, 3)))
  ).flat();
}

export async function findNetworkConfigFiles(
  home: string,
  cwd: string,
): Promise<string[]> {
  const roots = [
    cwd,
    path.join(home, "Downloads"),
    path.join(home, ".config"),
    path.join(home, ".ideality"),
  ];
  const files = (
    await Promise.all(
      [...new Set(roots)].map((directory) => collectFiles(directory, 3)),
    )
  ).flat();
  return [...new Set(files)].filter((file) =>
    /\.(conf|ovpn|wireguard)$/i.test(file),
  );
}
