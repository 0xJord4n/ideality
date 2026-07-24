import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { IdealityConfig } from "../domain/config.js";

const MANIFEST = ".ideality-shims.json";
const SAFE_TOOL_NAME = /^[a-z][a-z0-9_-]*$/;

export function renderShim(tool: string): string {
  if (!SAFE_TOOL_NAME.test(tool)) {
    throw new Error(`Invalid tool name '${tool}'`);
  }
  return `#!/bin/sh\nexec ideality run '${tool}' -- "$@"\n`;
}

async function writeManagedFile(
  file: string,
  content: string,
  mode: number,
): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await Bun.write(temporary, content);
  await chmod(temporary, mode);
  await rename(temporary, file);
}

async function readManifest(file: string): Promise<string[]> {
  try {
    const parsed: unknown = await Bun.file(file).json();
    if (
      parsed &&
      typeof parsed === "object" &&
      "tools" in parsed &&
      Array.isArray(parsed.tools)
    ) {
      return parsed.tools.filter(
        (tool): tool is string =>
          typeof tool === "string" && SAFE_TOOL_NAME.test(tool),
      );
    }
  } catch {
    // A missing or malformed manifest owns no files.
  }
  return [];
}

export async function installShims(
  config: IdealityConfig,
  idealityHome: string,
): Promise<{ directory: string; tools: string[] }> {
  const directory = path.join(idealityHome, "bin");
  const manifestPath = path.join(directory, MANIFEST);
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const previous = await readManifest(manifestPath);
  const configuredTools = new Set(
    Object.values(config.identities).flatMap((identity) =>
      Object.entries(identity.tools)
        .filter(([, profile]) => profile.enabled !== false)
        .map(([tool]) => tool),
    ),
  );
  const tools = [...configuredTools]
    .filter((tool) => config.tools[tool]?.shim !== false)
    .sort();
  const active = new Set(tools);
  for (const stale of previous) {
    if (!active.has(stale)) {
      await rm(path.join(directory, stale), { force: true });
    }
  }
  for (const tool of tools) {
    await writeManagedFile(path.join(directory, tool), renderShim(tool), 0o755);
  }
  await writeManagedFile(
    manifestPath,
    `${JSON.stringify({ tools }, null, 2)}\n`,
    0o600,
  );
  return { directory, tools };
}
