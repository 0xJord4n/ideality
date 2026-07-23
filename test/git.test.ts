import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { renderGitIncludes } from "../src/integrations/git.js";
import type { IdealityConfig } from "../src/domain/config.js";

const config: IdealityConfig = {
  version: 1,
  defaultIdentity: "personal",
  identities: {
    personal: {
      label: "Personal",
      roots: ["~/code/personal"],
      git: {
        name: "Example Developer",
        email: "developer@example.com",
        sshKey: "~/.ideality/ssh/personal",
      },
      tools: {},
    },
  },
  tools: {},
};

describe("renderGitIncludes", () => {
  test("renders an includeIf entry and identity file without shell interpolation", () => {
    const rendered = renderGitIncludes(config, "/home/dev", "/home/dev/.ideality");

    expect(rendered.includes).toContain(
      '[includeIf "gitdir:/home/dev/code/personal/"]',
    );
    expect(rendered.includes).toContain(
      `path = "/home/dev/.ideality/git/personal.gitconfig"`,
    );
    expect(rendered.identities.personal).toContain(`name = "Example Developer"`);
    expect(rendered.identities.personal).toContain(`email = "developer@example.com"`);
    expect(rendered.identities.personal).toContain(
      `sshCommand = "ssh -i '/home/dev/.ideality/ssh/personal' -o IdentitiesOnly=yes"`,
    );
  });

  test("quotes Git values and SSH key paths with special characters", async () => {
    const special = structuredClone(config);
    special.identities.personal!.git!.name = "Example # Developer";
    special.identities.personal!.git!.sshKey = "/tmp/key with space";
    const rendered = renderGitIncludes(special, "/home/dev", "/home/dev/.ideality");
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-git-"));
    const file = path.join(directory, "identity.gitconfig");
    await Bun.write(file, rendered.identities.personal!);

    const name = Bun.spawnSync(["git", "config", "--file", file, "--get", "user.name"]);
    const ssh = Bun.spawnSync(["git", "config", "--file", file, "--get", "core.sshCommand"]);

    expect(name.stdout.toString().trim()).toBe("Example # Developer");
    expect(ssh.stdout.toString().trim()).toBe(
      "ssh -i '/tmp/key with space' -o IdentitiesOnly=yes",
    );
  });
});
