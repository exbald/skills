# Spec checker

A dependency-free Node script that keeps specs safe to write ahead with one model and build with another. The format it enforces is "Spec folder anatomy" in [specs/README.md](../../specs/README.md). It checks three things:

- **Format:** the files a spec needs, the 11 task sections in order, status, wave, file lists, dependencies, the Verification code block, and a README whose task list matches the task files. A task that lists a `package.json` must also list the repository's lockfile (`lockfile` in `agentkit.config.json`, `package-lock.json` by default; `null` turns the rule off). A broken `agentkit.config.json` is reported as a problem too.
- **Overlap:** no two tasks in the same wave, and (with `--across`) no two specs run in parallel, can touch the same file. In a file list only `*` and `?` make a glob; brackets are literal (an Expo route's `[botId]` folder).
- **Readiness:** (with `--ready`) every file a spec's pending tasks change exists, or an earlier wave creates it, and nothing they create exists yet.

It reads file lists with `tools/guardrails/lib/task.mjs`, the same code the guard uses, so the two can't disagree about which files a task may touch.

## Usage

```
node tools/spec-check/check.mjs [--ready] [--across] [specs/NN-name ...]
```

- With no folders it checks every spec under `specs/`. The repository root is the nearest folder, going up from the current directory, that contains `specs/`.
- It prints one `<file>: <message>` line per problem, then a summary.
- Exit codes: 0 no problems, 1 problems, 2 usage error (unknown option, a folder that isn't a spec, or `--across` with fewer than two specs).

## When to run each mode

- **Format and same-wave overlap:** on every change to a spec. `npm run verify` runs them.
- **`--ready specs/NN-name`:** before a spec's first task, to catch drift since it was written. Don't run it on a spec that has started: its own created files then count as "already exists".
- **`--across specs/A specs/B`:** before running two specs in parallel.

## Tests

```
node --test "tools/spec-check/test/*.test.mjs"
```
