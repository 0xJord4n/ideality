import { describe, expect, test } from "bun:test";

import { generateSshKey } from "../src/integrations/ssh.js";

describe("generateSshKey", () => {
  test("creates an identity-scoped Ed25519 key with locked-down arguments", async () => {
    const calls: string[][] = [];
    const generated = await generateSshKey(
      {
        identity: "work",
        email: "developer@example.com",
        idealityHome: "/home/dev/.ideality",
      },
      {
        exists: async () => false,
        mkdir: async () => undefined,
        run: async (args) => {
          calls.push(args);
        },
      },
    );

    expect(generated.privateKey).toBe("/home/dev/.ideality/ssh/work");
    expect(calls[0]).toEqual([
      "ssh-keygen",
      "-t",
      "ed25519",
      "-C",
      "developer@example.com",
      "-f",
      "/home/dev/.ideality/ssh/work",
      "-N",
      "",
    ]);
  });
});
