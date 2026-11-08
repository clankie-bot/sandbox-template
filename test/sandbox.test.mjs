import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, runSandbox } from "../src/sandbox.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function project(files, checks, extra = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "sandbox-test-"));
  await mkdir(path.join(dir, "app"));
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(dir, "app", name), body);
  const configPath = path.join(dir, "sandbox.config.json");
  await writeFile(configPath, JSON.stringify({ workdir: "app", checks, ...extra }));
  return { dir, config: await loadConfig(configPath) };
}

test("the bundled example passes through the CLI", () => {
  const out = execFileSync(process.execPath, ["bin/sandbox.mjs", "check"], { cwd: repo, encoding: "utf8" });
  assert.match(out, /PASS {2}unit/);
  assert.match(out, /PASS {2}smoke/);
  assert.match(out, /all checks passed/);
});

test("a failing check fails the run and reports why", async () => {
  const { config } = await project({ "x.mjs": "process.exit(3)" }, [{ name: "boom", run: ["node", "x.mjs"] }]);
  const run = await runSandbox(config);
  assert.equal(run.ok, false);
  assert.equal(run.results[0].reason, "exit 3");
});

test("expectStdout mismatch fails", async () => {
  const { config } = await project({ "x.mjs": "console.log('4')" }, [
    { name: "smoke", run: ["node", "x.mjs"], expectStdout: "5" },
  ]);
  const run = await runSandbox(config);
  assert.equal(run.ok, false);
  assert.match(run.results[0].reason, /stdout/);
});

test("checks see an isolated HOME and no unlisted secrets", async () => {
  process.env.SANDBOX_TEST_SECRET = "hunter2";
  const { config } = await project(
    { "env.mjs": "console.log(JSON.stringify({ home: process.env.HOME, secret: process.env.SANDBOX_TEST_SECRET ?? null, allowed: process.env.ALLOWED }))" },
    [{ name: "env", run: ["node", "env.mjs"] }],
    { env: { ALLOWED: "yes" } },
  );
  const run = await runSandbox(config);
  delete process.env.SANDBOX_TEST_SECRET;
  const seen = JSON.parse(run.results[0].stdout);
  assert.equal(seen.secret, null);
  assert.equal(seen.allowed, "yes");
  assert.notEqual(seen.home, process.env.HOME);
});

test("writes inside the sandbox never touch the source tree", async () => {
  const { dir, config } = await project({ "w.mjs": "import fs from 'node:fs'; fs.writeFileSync('junk.txt', 'x')" }, [
    { name: "write", run: ["node", "w.mjs"] },
  ]);
  const run = await runSandbox(config);
  assert.equal(run.ok, true);
  assert.deepEqual(await readdir(path.join(dir, "app")), ["w.mjs"]);
});

test("a hung check is killed at its timeout", async () => {
  const { config } = await project({ "hang.mjs": "setInterval(() => {}, 1000)" }, [
    { name: "hang", run: ["node", "hang.mjs"], timeoutMs: 300 },
  ]);
  const run = await runSandbox(config);
  assert.equal(run.ok, false);
  assert.equal(run.results[0].reason, "timeout");
});
