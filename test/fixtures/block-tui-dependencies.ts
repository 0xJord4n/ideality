import { mock } from "bun:test";

for (const packageName of ["@opentui/core", "@opentui/react", "react"]) {
  const resolved = Bun.resolveSync(packageName, import.meta.dir);
  mock.module(resolved, () => {
    throw new Error(`Unexpected TUI dependency evaluation: ${packageName}`);
  });
}
