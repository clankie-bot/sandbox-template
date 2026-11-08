#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, runSandbox } from "../src/sandbox.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string", default: "sandbox.config.json" },
    keep: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

if (positionals[0] !== "check") {
  console.error("usage: sandbox check [--config sandbox.config.json] [--keep] [--json]");
  process.exit(2);
}

const config = await loadConfig(values.config);
const run = await runSandbox(config, { keep: values.keep });

const outDir = path.join(config.baseDir, ".sandbox");
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "last-run.json"), JSON.stringify(run, null, 2) + "\n");

if (values.json) {
  console.log(JSON.stringify(run, null, 2));
} else {
  for (const r of run.results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.durationMs} ms)${r.reason ? `  ${r.reason}` : ""}`);
    if (!r.ok) process.stdout.write((r.stderr || r.stdout).replace(/^/gm, "      "));
  }
  if (run.root) console.log(`kept sandbox: ${run.root}`);
  console.log(run.ok ? "all checks passed" : "checks failed");
}
process.exit(run.ok ? 0 : 1);
