import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  findIdentityDirectories,
  findSshPrivateKeys,
} from "../src/core/file-search.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("findSshPrivateKeys", () => {
  test("finds private keys while excluding public SSH files", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-file-search-"));
    temporaryDirectories.push(home);
    const idealityHome = path.join(home, ".ideality");
    const sshHome = path.join(home, ".ssh");
    const managedSshHome = path.join(idealityHome, "ssh");
    await mkdir(sshHome, { recursive: true });
    await mkdir(managedSshHome, { recursive: true });

    const homeKey = path.join(sshHome, "id_ed25519");
    const managedKey = path.join(managedSshHome, "sample");
    await writeFile(homeKey, "-----BEGIN OPENSSH PRIVATE KEY-----\nvalue\n");
    await writeFile(managedKey, "-----BEGIN RSA PRIVATE KEY-----\nvalue\n");
    await writeFile(`${homeKey}.pub`, "ssh-ed25519 public-key\n");
    await writeFile(path.join(sshHome, "known_hosts"), "example.invalid key\n");
    await writeFile(path.join(sshHome, "config"), "Host example\n");

    expect(await findSshPrivateKeys({ home, idealityHome })).toEqual([
      managedKey,
      homeKey,
    ]);
  });

  test("ranks a valid preferred key first", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-file-search-"));
    temporaryDirectories.push(home);
    const idealityHome = path.join(home, ".ideality");
    const preferred = path.join(home, "keys", "preferred");
    await mkdir(path.dirname(preferred), { recursive: true });
    await writeFile(preferred, "-----BEGIN OPENSSH PRIVATE KEY-----\nvalue\n");

    expect(
      await findSshPrivateKeys({ home, idealityHome, preferred }),
    ).toEqual([preferred]);
  });

  test("includes private keys linked into an SSH directory", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-file-search-"));
    temporaryDirectories.push(home);
    const idealityHome = path.join(home, ".ideality");
    const sshHome = path.join(home, ".ssh");
    const source = path.join(home, "key-store", "linked-key");
    const linked = path.join(sshHome, "linked-key");
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(sshHome, { recursive: true });
    await writeFile(source, "-----BEGIN OPENSSH PRIVATE KEY-----\nvalue\n");
    await symlink(source, linked);

    expect(await findSshPrivateKeys({ home, idealityHome })).toEqual([linked]);
  });
});

describe("findIdentityDirectories", () => {
  test("discovers project directories without descending into metadata", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-file-search-"));
    temporaryDirectories.push(home);
    const code = path.join(home, "code");
    const project = path.join(code, "sample-project");
    await mkdir(path.join(project, "src"), { recursive: true });
    await mkdir(path.join(project, "node_modules", "dependency"), {
      recursive: true,
    });
    await mkdir(path.join(project, ".git", "objects"), { recursive: true });

    const directories = await findIdentityDirectories(home);

    expect(directories).toContain(project);
    expect(directories).toContain(path.join(project, "src"));
    expect(
      directories.some((directory) => directory.includes("node_modules")),
    ).toBe(false);
    expect(directories.some((directory) => directory.includes("/.git/"))).toBe(
      false,
    );
  });
});
