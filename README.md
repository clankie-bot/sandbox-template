<div align="center">

# sandbox-template

**A disposable workspace where agents build and test.**

Copy a project into a throwaway directory, run its checks with a clean environment and timeouts, and keep the results.

Part of [Clankie](https://clankie.bot): [clankie-decision-log](https://github.com/clankie-bot/clankie-decision-log) · [clankie-extension-sdk](https://github.com/clankie-bot/clankie-extension-sdk) · [clankie-fast-ci](https://github.com/clankie-bot/clankie-fast-ci) · [sandbox-template](https://github.com/clankie-bot/sandbox-template)

</div>

Each `sandbox check` run:

1. copies the configured `workdir` into a fresh temporary directory (skipping
   `node_modules`), so the agent's build and test writes never touch the source tree;
2. gives every check its own `HOME` and `TMPDIR` inside that directory;
3. passes only an allowlisted environment (`PATH`, `LANG`, `LC_ALL`, `TERM`, `TZ`,
   plus anything listed in the config's `env`), so tokens and credentials in the
   caller's shell don't leak into the checks;
4. runs each check with a timeout, kills checks that hang, and records results
   in `.sandbox/last-run.json`;
5. deletes the sandbox unless you pass `--keep`.

It is a workspace boundary, not a security boundary: checks still run as your
user, with network access. Use a container or VM for untrusted code.

## Use

Requires Node 22.5 or newer. There are no dependencies.

```sh
node bin/sandbox.mjs check            # run sandbox.config.json
node bin/sandbox.mjs check --keep     # keep the sandbox dir for inspection
node bin/sandbox.mjs check --json     # machine-readable results
npm test                              # the template's own tests
```

Exit status is 0 when every check passes, 1 when any check fails, and 2 for usage errors.

## Config

```json
{
  "workdir": "example",
  "timeoutMs": 60000,
  "env": {},
  "checks": [
    { "name": "unit", "run": ["node", "--test", "test/add.test.mjs"] },
    { "name": "smoke", "run": ["node", "src/cli.mjs", "2", "3"], "expectStdout": "5" }
  ]
}
```

- `workdir`: the directory to copy, relative to the config file.
- `checks[].run`: argv, run without a shell, from the sandbox copy of `workdir`.
- `checks[].timeoutMs`: overrides the top-level `timeoutMs`.
- `checks[].expectStdout`: optional; the trimmed stdout must match it exactly.

## Layout

- `bin/sandbox.mjs`: the CLI.
- `src/sandbox.mjs`: `loadConfig`, `runSandbox` and `sandboxEnv`.
- `example/`: a minimal project the default config checks.
- `test/sandbox.test.mjs`: tests covering pass, failure, stdout mismatch, env
  isolation, source immutability and timeouts.

To adapt it, point `workdir` at your project and replace `checks` with its own
build and test commands.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
