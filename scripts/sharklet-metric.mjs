#!/usr/bin/env node
// Prints one number for a metric loop (scripts/sharklet-loop.sh metric <name>).
// Lower is better for every metric here. The programs that use them live in
// the docs repo, docs/loops/<name>.md.
//
// Usage: node scripts/sharklet-metric.mjs startup-bytes|openclaw-residual
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function startupBytes() {
  execSync("corepack pnpm ui:build", { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  // The check exits non-zero when a budget is over; its JSON is still the measure.
  const run = spawnSync(
    process.execPath,
    ["--import", "./scripts/tsx.mjs", "scripts/check-control-ui-performance.mts", "--json"],
    { cwd: root, encoding: "utf8" },
  );
  return JSON.parse(run.stdout).metrics.startup.js.gzipBytes;
}

// "OpenClaw" as the product name inside string literals of the UI, plus links
// to upstream's docs. Lowercase `openclaw` (the CLI, package and config names)
// is not counted: AGENTS.md keeps those names.
// ponytail: regex string literals, so a quote inside a comment can skew the
// count by a few; an AST walk with the TypeScript parser if that ever matters.
function openclawResidual() {
  const literal = /(["'`])(?:\\.|(?!\1)[^\\\n])*\1/gu;
  let count = 0;
  for (const file of walk(path.join(root, "ui/src"))) {
    for (const [text] of fs.readFileSync(file, "utf8").matchAll(literal)) {
      count += (text.match(/OpenClaw|docs\.openclaw\.ai/gu) ?? []).length;
    }
  }
  return count;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (entry.name !== "test" && entry.name !== "__tests__") {
        yield* walk(full);
      }
    } else if (
      /\.ts$/u.test(entry.name) &&
      !/\.(test|d)\.ts$|test-support/u.test(entry.name) &&
      // English is the source; the other locales are generated from it.
      !/i18n\/locales\/(?!en[.-])/u.test(rel)
    ) {
      yield full;
    }
  }
}

const metrics = { "startup-bytes": startupBytes, "openclaw-residual": openclawResidual };
const metric = metrics[process.argv[2]];
if (!metric) {
  console.error(`usage: node scripts/sharklet-metric.mjs ${Object.keys(metrics).join("|")}`);
  process.exit(2);
}
console.log(metric());
