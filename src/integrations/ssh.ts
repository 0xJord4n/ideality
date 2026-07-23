import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

export interface GenerateSshKeyOptions {
  identity: string;
  email: string;
  idealityHome: string;
  force?: boolean;
}

interface SshDependencies {
  exists: (path: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<void>;
  run: (args: string[]) => Promise<void>;
}

export interface GeneratedSshKey {
  privateKey: string;
  publicKey: string;
}

const IDENTITY_ID = /^[a-z][a-z0-9_-]*$/;

const defaultDependencies: SshDependencies = {
  exists: async (file) => Bun.file(file).exists(),
  mkdir: async (directory) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  },
  run: async (args) => {
    const process = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
    const exitCode = await process.exited;
    if (exitCode !== 0) {
      throw new Error(`ssh-keygen exited with code ${exitCode}`);
    }
  },
};

export async function generateSshKey(
  options: GenerateSshKeyOptions,
  dependencies: SshDependencies = defaultDependencies,
): Promise<GeneratedSshKey> {
  if (!IDENTITY_ID.test(options.identity)) {
    throw new Error(
      "Identity ID must start with a lowercase letter and contain only letters, numbers, _ or -",
    );
  }
  const directory = path.join(options.idealityHome, "ssh");
  const privateKey = path.join(directory, options.identity);
  if ((await dependencies.exists(privateKey)) && !options.force) {
    throw new Error(`SSH key '${privateKey}' already exists`);
  }

  await dependencies.mkdir(directory);
  await dependencies.run([
    "ssh-keygen",
    "-t",
    "ed25519",
    "-C",
    options.email,
    "-f",
    privateKey,
    "-N",
    "",
  ]);
  if (dependencies === defaultDependencies) {
    await chmod(privateKey, 0o600);
  }
  return { privateKey, publicKey: `${privateKey}.pub` };
}
