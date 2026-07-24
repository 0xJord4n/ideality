import { defineConfig } from "@bunli/core";

import pkg from "./package.json";

export default defineConfig({
  name: "ideality",
  version: pkg.version,
  description: "Folder-based identity orchestration for developer tools",

  commands: {
    directory: "./src/commands",
  },

  plugins: [],

  build: {
    entry: "./src/index.ts",
    outdir: "./dist",
    targets: ["linux-x64"],
    minify: true,
    sourcemap: true,
    compress: true,
  },

  dev: {
    watch: true,
    inspect: false,
  },

  test: {
    pattern: ["**/*.test.ts", "**/*.spec.ts"],
    coverage: true,
    watch: false,
  },
});
