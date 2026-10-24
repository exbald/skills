# Wave runs

`run-wave.mjs` builds one wave of a spec with a builder model, unattended, and watches it until the wave's pull request is ready for the lead. Node 24, git, `gh` (signed in) and the builder's CLI on the `PATH`: `opencode` for an OpenCode builder, `claude` for a Claude Code builder. No dependencies.

```sh
node tools/build/run-wave.mjs --spec specs/02-app-api --wave 1 --builder glm
node tools/build/run-wave.mjs --spec specs/03-mobile-chat --wave 5 --builder sonnet --budget 10
node tools/build/run-wave.mjs --spec specs/02-app-api --wave 1 --builder glm --dry-run   # the plan and the brief, nothing run
```

Run it in the background from the lead's session; it exits on its own. Stopping the runner (SIGTERM or Ctrl-C) stops its builder too, and releases the wave, even mid-install, since the install runs without blocking it. Once stopped, it never starts, resumes or nudges a builder, even in the five seconds it gives the old one to exit. The event log beside the checkout grows with the run, up to a few megabytes over an 8-hour wave; delete it with the checkout. At start it reads its own line from `ps`, the way the watchdog will, and stops if it can't. Checked on macOS, where the lead ran it. One runner per wave: a pidfile beside the checkout makes a second one refuse to start while the first lives. `--root` points it at another repository, which the tests use. `--wave` must be a whole number and `--budget` a positive number of dollars, or it stops before doing anything.

## What it reads from agentkit.config.json

The repository's `agentkit.config.json` (`tools/guardrails/lib/config.mjs`) holds everything that differs between projects. The runner reads:

| Key | What the runner does with it |
|---|---|
| `builders` | The builders `--builder` can name. Each is `{ harness, model, label?, effort?, budgetUsd? }`. `harness` is `opencode` or `claude`; `model` is the id in that CLI's own form, pinned, never a moving alias; `budgetUsd` is a Claude Code wave's default spend cap ($10 when absent, and `--budget` overrides it). An unknown name stops the runner, listing the configured ones. |
| `repo` | The GitHub repository, `owner/name`, for every `gh` call. Required. |
| `reviewer` | The reviewer bot: `login` (required) to recognize its reviews, `name` for the brief and the log, `trigger` (such as `/review`) for the comment that asks it for a review. |
| `defaultBranch` | Where a new wave branch starts, the pull request's base, and the branch the wave's changes are diffed against. |
| `project` | The project's name in the brief. |
| `ci` | The jobs the runner waits for before it calls a wave done, as `merge-approved.mjs` reads them (`requiredChecks` in `tools/guardrails/lib/ci.mjs`). |
| `build.install` | The install a new or found checkout gets before its builder starts, as a list of words. Without it: `npm ci --no-audit --no-fund` when the checkout has a `package-lock.json`, and nothing otherwise. |
| `build.installEnv` | Variables added to the install's environment. On a machine whose global npmrc breaks project installs (`EALLOWSCRIPTS`), `{ "npm_config_userconfig": "/dev/null" }`. |
| `build.longCommands` | The project's own commands that may legitimately run 30 minutes, such as `eve build` or `expo export`, matched as whole words anywhere in the command line. |

A missing `repo` or `reviewer.login`, or a config file that doesn't fit, stops the runner before it clones, installs or starts anything.

## What it does

1. **The checkout.** It makes the wave's own checkout beside the repository, in a folder named after the repository's own (`/work/acme` builds in `/work/acme-builds/build-spec-02-wave-01`), on branch `build/spec-02-wave-01`.
   - **It's a clone, never a git worktree** (`lib/checkout.mjs`), so the wave shares no index, branches or hooks with the repository's checkout. The clone borrows the repository's objects to start quickly, then stands on its own (`--reference … --dissociate`).
   - **The builder's `PWD` is the checkout** (`builderEnv` in `lib/builders.mjs`). OpenCode 2.0.20 takes its working directory from `$PWD`, not from the process's own directory: on 2026-10-23 the same process in the same folder worked in whichever directory `PWD` named. The first live wave (also 2026-10-23) inherited the lead's `PWD` and worked in the main checkout: the builder's `git status` printed "On branch main", in a worktree and then again in a clone, and both runs were stopped before they changed anything. The worktree was blamed at first; it wasn't the cause.
   - It starts from `origin/<defaultBranch>`, or from the wave's branch when an earlier run pushed it. So a wave an OpenCode builder handed back continues where it stopped, under a Claude Code builder.
   - A checkout an earlier run left is fast-forwarded to what that run pushed, never past local work. It must be a clone of the repository's own origin: a worktree, a clone of another remote, or a folder that isn't a checkout is refused, with what to remove.
   - It runs the install there (`build.install`, or `npm ci`).
   - Never inside the repository: a second copy of the repository's config files under it gets in the tools' way (a second `biome.json` broke Biome's lint).
2. **The builder.** It starts the builder with the wave's brief (`lib/brief.mjs`): the tasks in order, AGENTS.md's work loop, one pull request into the default branch, the review rules, and when to stop. The brief never lets it merge. It keeps the builder to the files its tasks list, even between tasks, so the progress log and STATUS are left to the lead unless a task lists them, and a review note that needs an unlisted file is answered and left to the lead too. Deferred notes go in its last message, and the lead files the issues. From the reviewer bot's fourth review on, it answers notes instead of changing code, except for correctness, security and data bugs in files the wave's tasks list.
   - **An OpenCode builder** (the worked example: GLM 5.3 at max effort): `opencode run --standalone --print-logs -m <model> --auto --format json`.
     - The private server keeps its commands under this process and off the OpenCode service other sessions share.
     - The checkout's `.opencode/plugins/guardrails.js` runs the guard before each tool call.
     - The server's log goes to stderr. The runner needs OpenCode's `loading plugin … guardrails.js` line within two minutes, loaded from the wave's own checkout, with no `failed to load plugin` after it. A plugin loaded from another checkout means OpenCode works there, not in the wave. Otherwise it stops the builder at once and hands the wave to the lead (exit 3), so an OpenCode builder never works unguarded, even if a later OpenCode skips the plugin without a word.
   - **A Claude Code builder** (the worked example: Sonnet 5.5 at high effort): `claude -p --model <model> [--effort <effort>] --output-format stream-json --verbose --dangerously-skip-permissions`, with the model id the config pins rather than the moving `sonnet` alias, and `--max-budget-usd` set to what's left of the wave's budget. The cap stops the run after the turn that crosses it, so a wave can end a little over: a 10-cent cap allowed one 16-cent turn when checked on 2026-10-23.
     - The flag only skips permission prompts, which a headless run can't answer and would hang on. It doesn't skip the guard: Claude Code still runs the repository's PreToolUse hook, and its denials hold (AGENTS.md, Never: approvals and auth checks stay as they are).
     - **Checked live on 2026-10-23,** with exactly these flags, in a scratch clone: the builder's Read of a fake `.env.example` came back as `PreToolUse:Read hook error: AGENTS.md: never read, edit or print .env* files…`, and the file's value appeared nowhere in the output.
     - **The runner launches a Claude Code builder only in a checkout** whose `.claude/settings.json` runs `tools/guardrails/hooks/guard.mjs` (`hooksWired`). Otherwise the wave goes to the lead.
     - **Its cost:** a run can print several `result` events, one each time background work wakes it, and each reports the run's `total_cost_usd` so far. The runner keeps the highest, never their sum: one live run printed six totals from $7.63 to $9.98, which summed to $55.13 (2026-10-23). A run resumed with `--resume` reports the whole session: in Claude Code 2.1.309, its `total_cost_usd` and `modelUsage` include the earlier runs, while `usage` counts the run's own tokens (checked 2026-10-23: a resume reported $6.48 after a first run of $6.26, with 2,556 output tokens of its own and 143,881 for the session). The runner tells which from the run's first result (`includesEarlierRuns`): the session's output tokens outnumber the run's. Such a run adds only what it reported beyond the session's earlier total. A total without `modelUsage` counts as the run's own. `--max-budget-usd` holds a run to its own spend, not the session's: a resume capped at $0.005, with the session already at $0.0102, ran 5 turns and spent $0.0030. So the runner adds the runs up, in whole cents, and gives each new run what the wave has left. A run that ends without its `result` event spent an unknown amount: stopped for silence, say, or its output changed. Unless the wave is done or blocked, it then goes to the lead rather than start another run on a guess.
3. **Silence.** It watches the builder's output, stdout and stderr alike. After 10 silent minutes (`lib/processes.mjs`):
   - a builder waiting on the reviewer bot (for up to 30 minutes) or on CI is left alone, since polling for either is quiet with nothing running;
   - it stops a shell command that has run past its limit, and everything under it, by PID: SIGTERM, then SIGKILL 30 seconds later. The limit is 10 minutes, or 30 for installs, builds and tests (`npm ci`, `verify.mjs`, the suites, and `build.longCommands`), which can legitimately run long on a cold cache. A dev server or tests in watch mode are typical. It leaves that command alone while the wave's pull request waits on the reviewer bot, since that's the builder's own wait;
   - if nothing is running, it restarts the builder in the same session. It stops the builder's process group (SIGTERM, then SIGKILL), and moves on after a minute even if something still holds its output open;
   - the builder's private server, MCP servers and language servers are never touched.
   - **How it tells a command from a helper:** a command is a shell reached from the builder only through the harness's own processes, which are `opencode` or `claude` by program name (or a script of either under `node` or `bun`). A process whose path merely mentions one, like an MCP server under `~/.claude/plugins/`, is a helper, and its shells are its own. Under Claude Code, the Bash tool's command is a direct `zsh -c source '<snapshot>' … && eval '<command>'` child, and the limits read the command inside it. That tree was captured live from `claude -p` on 2026-10-23 and is a fixture in `watch.test.mjs`.
4. **When the builder stops,** it reads where the wave stands (`lib/wave.mjs`): the tasks' status, `BLOCKED.md`, uncommitted or unpushed work, the pull request, the reviewer bot's latest review and CI on the head.
   - **Files outside the lists:** every file the branch changed, committed or not, must be in a wave task's lists, read the way the guard reads them. The guard only holds a builder to a task's lists while that task is marked active. This comes before "commit and push", so a builder is never told to commit such a file.
   - **A conflict with the default branch:** CI can't run on a conflicting pull request, so the builder is told to merge `origin/<defaultBranch>` and resolve it.
   - **Waiting:** while the reviewer bot or CI is working, it waits, for up to 45 minutes.
   - **Work left:** the builder gets one message saying what's left and resumes its session. After three such messages, the wave goes to the lead.
   - **Resuming survives a restart.**
     - OpenCode keeps sessions on disk, not in the private server's memory. Checked on 2026-10-23 with OpenCode 2.0.20: a `--standalone` run was killed, group and server, mid-command, then `opencode run --session <id>` carried on and recalled what was said before the kill.
     - Claude Code 2.1.308 resumes with `--resume <session-id>` (`claude --help`).
5. **Exit codes.**
   - `0` done: approved on the head, every note answered, CI green.
   - `2` blocked: `BLOCKED.md`.
   - `3` for the lead: out of nudges, budget or review rounds (five), a Claude Code run that didn't report its cost, still waiting after 45 minutes, past the wave's 8 hours, or a guard that didn't show it loaded.
   - `1` the runner itself failed, or the config stopped it before it started.

## Files it writes

Beside the checkout, never in the repository:

| File | What's in it |
|---|---|
| `<checkout>.log` | Every decision the runner made, with its time |
| `<checkout>.events.jsonl` | The builder's whole event stream, for audits and pilots |
| `<checkout>.stderr.log` | The builder's stderr, and all of the install's |

## After the first OpenCode wave

The OpenCode argument names the plugin reads were seen live only for `write` (2026-10-23). The others (`read`, `grep`, `edit`, `multiedit`, `apply_patch`) are read from OpenCode's docs and tested against stand-ins. A wrong one fails closed, so the builder is blocked and nothing leaks. After a project's first OpenCode wave, search its event log for blocked calls the guard shouldn't have made, and fix the mapping in `tools/guardrails/lib/opencode.mjs`:

```sh
grep -c "doesn't know the tool\|names no file\|no command the guard can read" ../<repository>-builds/build-spec-02-wave-01.events.jsonl
```

## Teardown

Once the wave's pull request has merged, delete its clone, and keep the logs: `rm -rf ../<repository>-builds/build-spec-02-wave-01`. The repository itself gets no branch or worktree of the wave's. The one exception is a branch an older, worktree-based run left there: its work is copied into the clone and also left in place, so deleting the clone can't lose it. Delete it with `git branch -d` once the wave has merged.

## After it exits

The lead audits before merging:
- each commit's files are inside its task's lists;
- test files gained lines and lost none, except tests a task's Notes retire;
- `npm run verify` passes at the head, and the ledger has a row for each task;
- each note in the reviewer bot's approving review has its own answer. The runner only sees that someone replied after the review;
- commits made after the bot's third review fix only correctness, security or data bugs, in files the wave's tasks list, and anything else the bot raised has a reply and a follow-up issue (AGENTS.md, Pull requests).

Then the lead merges with `node tools/guardrails/merge-approved.mjs <number>` and deploys with `node tools/guardrails/deploy-approved.mjs`, without waiting for the owner when the owner has pre-approved the builds. A failed deploy goes under Blockers in docs/STATUS.md.

## Test

```sh
node --test "tools/build/test/*.test.mjs"
```

The decisions are pure functions over facts the runner gathers, so the tests cover every case without git, GitHub or a model. `test/acme.mjs` holds the test data: a made-up project's config with the worked example's two builders.
- `github.test.mjs` feeds `pullRequestFacts` canned gh answers, and runs its `--jq` filters through the real `jq`;
- `claim.test.mjs` covers the pidfile, a takeover included;
- `cli.test.mjs` covers the arguments and the config checks that stop the runner before anything runs;
- `run.test.mjs` runs the real runner through a whole wave, in a throwaway repository with a bare remote and stand-ins for `opencode`, `claude`, `npm` and `gh` on the `PATH`. The builder stops early, is nudged, resumes its session, finishes and pushes, and the runner exits done. For a Claude Code builder, it also checks each run's `--max-budget-usd` against what's left, and that a wave at its cap goes to the lead;
- `flags.test.mjs` checks every flag the runner passes against the installed `opencode` and `claude`, and every `gh pr list --json` field against the installed `gh`. Each skips where its CLI isn't installed.
