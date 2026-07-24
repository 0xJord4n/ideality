import { describe, expect, test } from "bun:test";

import { deriveIdentityId } from "../src/core/identity-id.js";

describe("deriveIdentityId", () => {
  test("creates a safe slug from a display label", () => {
    expect(deriveIdentityId("Client Alpha", [])).toBe("client-alpha");
    expect(deriveIdentityId("123 Team", [])).toBe("id-123-team");
  });

  test("adds a numeric suffix when the slug already exists", () => {
    expect(
      deriveIdentityId("Client Alpha", [
        "client-alpha",
        "client-alpha-2",
      ]),
    ).toBe("client-alpha-3");
  });
});
