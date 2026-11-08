import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Only these variables reach a check. Everything else (tokens, cloud
// credentials, agent session state) stays outside the sandbox.
const PASSTHROUGH_ENV = ["PATH", "LANG", "LC_ALL", "TERM", "TZ"];

export async function loadConfig(configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (!config.workdir || !Array.isArray(config.checks) || config.checks.length === 0) {
    throw new Error(`${configPath}: needs "workdir" and a non-empty "checks" array`);
  }
  for (const check of config.checks) {
    if (!check.name || !Array.isArray(check.run) || check.run.length === 0) {
      throw new Error(`${configPath}: each check needs "name" and a non-empty "run" array`);
    }
  }
  return { timeoutMs: 60_000, env: {}, ...config, baseDir: path.dirname(path.resolve(configPath)) };
}

export function sandboxEnv(root, extra = {}) {
  const env = {};
  for (const key of PASSTHROUGH_ENV) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, ...extra, HOME: path.join(root, "home"), TMPDIR: path.join(root, "tmp"), SANDBOX: "1" };
}

// Copies the workdir into a fresh temporary directory, runs each check there
// with an isolated HOME/TMPDIR and a filtered environment, and returns results.
// The source tree is never written to.
export async function runSandbox(config, { keep = false } = {}) {
  const source = path.resolve(config.baseDir, config.workdir);
  const root = await mkdtemp(path.join(tmpdir(), "sandbox-"));
  const work = path.join(root, "work");
  await cp(source, work, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes("node_modules"),
  });
  await mkdir(path.join(root, "home"));
  await mkdir(path.join(root, "tmp"));
  const env = sandboxEnv(root, config.env);

  const results = [];
  try {
    for (const check of config.checks) {
      const started = Date.now();
      const [cmd, ...args] = check.run;
      const proc = spawnSync(cmd, args, {
        cwd: work,
        env,
        encoding: "utf8",
        timeout: check.timeoutMs ?? config.timeoutMs,
        killSignal: "SIGKILL",
      });
      const timedOut = proc.error?.code === "ETIMEDOUT";
      let ok = proc.status === 0 && !proc.error;
      let reason = timedOut ? "timeout" : proc.error ? proc.error.message : ok ? null : `exit ${proc.status ?? proc.signal}`;
      if (ok && check.expectStdout !== undefined && proc.stdout.trim() !== check.expectStdout) {
        ok = false;
        reason = `stdout ${JSON.stringify(proc.stdout.trim())} != ${JSON.stringify(check.expectStdout)}`;
      }
      results.push({
        name: check.name,
        ok,
        reason,
        durationMs: Date.now() - started,
        stdout: proc.stdout ?? "",
        stderr: proc.stderr ?? "",
      });
    }
  } finally {
    if (!keep) await rm(root, { recursive: true, force: true });
  }
  return { ok: results.every((r) => r.ok), root: keep ? root : null, results };
}
