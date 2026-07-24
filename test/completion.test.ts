import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  installCompletion,
  renderCompletion,
  syncInstalledCompletions,
} from "../src/integrations/completion.js";

describe("renderCompletion", () => {
  test("renders dynamic zsh completion for commands, identities, and tools", () => {
    const output = renderCompletion("zsh", {
      identities: ["default", "sample"],
      tools: ["gh", "vercel"],
    });

    expect(output).toContain("#compdef ideality");
    expect(output).toContain("explain");
    expect(output).toContain("default sample");
    expect(output).toContain("gh vercel");
  });

  test("supports bash and fish", () => {
    const values = { identities: ["default"], tools: ["sample"] };
    expect(renderCompletion("bash", values)).toContain("complete -F");
    expect(renderCompletion("fish", values)).toContain("complete -c ideality");
  });

  test("installs a locked completion file under the ideality home", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-completion-"));
    const file = await installCompletion("zsh", "# completion\n", home);
    expect(await Bun.file(file).text()).toBe("# completion\n");
    expect((await Bun.file(file).stat()).mode & 0o777).toBe(0o600);
    await syncInstalledCompletions(
      {
        version: 1,
        defaultIdentity: "sample",
        identities: {
          sample: { label: "Sample", roots: ["/workspace"], tools: {} },
        },
        tools: { demo: { executable: "demo" } },
      },
      home,
    );
    expect(await Bun.file(file).text()).toContain("sample");
    expect(await Bun.file(file).text()).toContain("demo");
  });
});
