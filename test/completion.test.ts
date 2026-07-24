import { describe, expect, test } from "bun:test";

import { renderCompletion } from "../src/integrations/completion.js";

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
    expect(renderCompletion("fish", values)).toContain(
      "complete -c ideality",
    );
  });
});
