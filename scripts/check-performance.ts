import { stat } from "node:fs/promises";
import { resolve } from "node:path";

interface PerformanceBudgets {
  binary: string;
  standaloneBuild: {
    maxBytes: number;
    description: string;
  };
  startup: {
    args: string[];
    samples: number;
    warmups: number;
    maxMedianMs: number;
    description: string;
  };
}

const budgets = (await Bun.file(
  "performance-budgets.json",
).json()) as PerformanceBudgets;
const binary = resolve(budgets.binary);
const failures: string[] = [];

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function runBinary(): number {
  const startedAt = performance.now();
  const result = Bun.spawnSync([binary, ...budgets.startup.args], {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const durationMs = performance.now() - startedAt;

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(
      `Startup probe exited with code ${result.exitCode}${stderr ? `: ${stderr}` : ""}`,
    );
  }

  return durationMs;
}

let binarySize: number;
try {
  binarySize = (await stat(binary)).size;
} catch {
  console.error(
    `Standalone binary not found at ${binary}. Run \`bun run build\` first.`,
  );
  process.exit(1);
}

console.log(
  `Standalone build: ${formatBytes(binarySize)} (budget: ${formatBytes(
    budgets.standaloneBuild.maxBytes,
  )})`,
);
if (binarySize > budgets.standaloneBuild.maxBytes) {
  failures.push(
    `Standalone build exceeds its budget by ${formatBytes(
      binarySize - budgets.standaloneBuild.maxBytes,
    )}.`,
  );
}

for (let index = 0; index < budgets.startup.warmups; index += 1) {
  runBinary();
}

const samples = Array.from({ length: budgets.startup.samples }, runBinary).sort(
  (left, right) => left - right,
);
if (samples.length === 0) {
  throw new Error(
    "The startup performance budget requires at least one sample.",
  );
}

const midpoint = Math.floor(samples.length / 2);
const upper = samples[midpoint];
const lower = samples[midpoint - 1];
if (upper === undefined || (samples.length % 2 === 0 && lower === undefined)) {
  throw new Error("Unable to calculate the startup median.");
}
const medianMs = samples.length % 2 === 0 ? (lower + upper) / 2 : upper;

console.log(
  `Startup median: ${medianMs.toFixed(0)} ms across ${samples.length} samples ` +
    `(budget: ${budgets.startup.maxMedianMs} ms)`,
);
if (medianMs > budgets.startup.maxMedianMs) {
  failures.push(
    `Startup median exceeds its budget by ${(
      medianMs - budgets.startup.maxMedianMs
    ).toFixed(0)} ms.`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Performance budget failed: ${failure}`);
  }
  process.exit(1);
}

console.log("Performance budgets passed.");
