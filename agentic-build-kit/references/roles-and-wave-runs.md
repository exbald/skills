# Roles and wave runs

## The roles

| Role | Who (worked example) | Does | Never does |
|---|---|---|---|
| **Owner** | the human | approves the product spec and the plan (G0), pre-approves within named limits, holds secrets, accounts, payments, the phone, releases to stores | gets waited on for anything pre-approved |
| **Lead** | the strongest model (Opus) in Claude Code | writes specs, runs the adversarial spec review, launches waves, audits, merges, deploys, writes `BLOCKED.md` resolutions, keeps STATUS and the log, files follow-up issues, runs the screen check | builds a wave itself while a builder could |
| **Builders** | `agentkit.config.json`'s `builders`: GLM 5.3 in OpenCode, Sonnet 5.5 in Claude Code | build one wave each, unattended, in a clone beside the repo; open one PR; answer the reviewer bot | merge, deploy, touch unlisted files, file issues |
| **Reviewer bot** | `reviewer` (Muse in the worked example, running a model family neither builder uses) | reviews every PR, approves or asks for changes | — |
| **Adversarial reviewer** | Codex, read-only | tries to break each spec before it merges | builds |

Model-agnostic by design (the source project's decision 0009): assign by role and swap models freely. Record the agent and model of every task in `specs/LEDGER.md`, so you learn which models do which work best.

## Who builds which wave

From the source project's decision 0024 (2026-10-23), after three pilots had Sonnet 5.5, GLM 5.3 and Grok 4.7 build the same specs (Sonnet placed first; GLM built cleanly at no metered cost on the owner's plan):

| Waves | Builder | Why |
|---|---|---|
| Code given in the task (proven tasks) | the cheap builder (GLM in OpenCode, max effort) | the judgment is already in the task; keep the spend where judgment matters |
| Code the builder writes (lighter tasks, `(strong model)` tags) | the strong builder (Sonnet in Claude Code, high effort), under a spend cap ($10 a wave by default) | judgment the file can't pin down |
| A cheap-builder wave the runner hands back | the strong builder, resuming the same branch | the clone starts from the pushed branch, so the work continues |
| Specs, launches, audits, merges, deploys | the lead | |

A wave with any `(strong model)` task runs with the strong builder. Pin model ids in the config, never a moving alias like `sonnet`: a wave is built, audited and costed as the model the config names.

Harness facts that shaped this: GLM 5.3 reads text only (`glm-5.3-flash` takes images), so screen comparisons go to a vision model. In six short OpenCode runs, three went silent mid-session and never recovered on their own, hence the watchdog.

## Running a wave

```sh
node tools/build/run-wave.mjs --spec specs/NN-name --wave N --builder <name> [--budget USD] [--dry-run]
```

Run it in the background from the lead's session; it exits on its own. `--dry-run` prints the plan, the builder's command and the brief, and runs nothing. Full detail: [../kit/tools/build/README.md](../kit/tools/build/README.md). In outline:

1. **A clone beside the repository**, on `build/spec-NN-wave-MM`: `../<repo>-builds/build-spec-NN-wave-MM`. A clone, never a worktree, so the wave shares no index, branches or hooks with the lead's checkout; never inside the repo, where a second copy of config files (a second `biome.json`) breaks the tools. It starts from `origin/<defaultBranch>`, or from the wave's branch when an earlier run pushed it. Then the install (`build.install`, or `npm ci` when there's a lockfile).
2. **The builder, with the wave's brief:** the tasks in order, the work loop, one PR into the default branch (never merged by the builder), the review rules, the narrow-rounds rule, and when to stop. It keeps the builder to the files its tasks list, even between tasks: the log and STATUS are the lead's, and a review note that needs an unlisted file is answered and left to the lead.
3. **The watchdog.** After 10 silent minutes: a builder waiting on the bot (up to 30 minutes) or CI is left alone; a shell command past its limit (10 minutes, or 30 for installs, builds, tests and `build.longCommands`) is stopped by PID with everything under it; with nothing running, the builder is restarted in the same session. Its private server, MCP servers and language servers are never touched. No pinging on a timer: it reacts only to silence or an early stop.
4. **When the builder stops,** the runner reads the wave's state: tasks, `BLOCKED.md`, files changed outside every task's lists (checked over the whole branch, since the guard holds a builder to a task's lists only while that task is active), uncommitted or unpushed work, the PR, the bot's latest review, CI. Work left gets one message and a resumed session, at most three times. A conflicting PR is told to merge the default branch, since CI can't run on it. The bot or CI working: it waits, up to 45 minutes.
5. **Exit codes:** `0` done (approved on the head, notes answered, CI green), `2` blocked (`BLOCKED.md`), `3` for the lead (out of nudges, budget or five review rounds, a run that didn't report its cost, waiting past 45 minutes, past the wave's 8 hours, a guard that didn't show it loaded), `1` the runner failed or the config stopped it.

One runner per wave: a pidfile beside the clone refuses a second one, and a runner taking over a dead one's wave kills that builder first. Stopping the runner (SIGTERM, Ctrl-C) takes its builder down and releases the wave; once stopped, it never starts, resumes or nudges a builder.

## The guard, per harness

The runner never lets a builder work unguarded:

- **OpenCode** runs none of Claude Code's hooks, and its 2.x plugin API changed (a default definition with `setup`, `ctx.tool.hook("execute.before", …)`). The repository's `.opencode/plugins/guardrails.js` hands every tool call to the same `guard.mjs`, and fails closed: an unknown tool, OpenCode's own `execute`, MCP tools and a call it can't read are blocked; `task` (subagents) and `question` are blocked too, since nobody has shown a subagent's calls reach the hook, and an unattended builder has nobody to answer. The runner starts it with `--standalone` (a private server, so its commands run under the runner and off the shared OpenCode service next to the owner's sessions) and `--print-logs`, and stops the builder at once unless OpenCode logs loading `guardrails.js` **from the wave's own clone** within two minutes, with no failure after it.
- **Claude Code** runs headless with `--dangerously-skip-permissions`, because a headless run can't answer permission prompts and would hang on the first. That skips prompts, not hooks: checked live on 2026-10-23, a Read of a fake `.env.example` came back as a PreToolUse hook error and the value appeared nowhere. The runner launches it only in a clone whose `.claude/settings.json` runs `guard.mjs`.
- **The builder's `PWD` is the clone.** OpenCode 2.0.20 works where `$PWD` says, not where the process stands: the first live wave (2026-10-23) inherited the lead's `PWD` and worked in the main checkout, and was stopped before it changed anything. The runner sets `PWD` and strips `CLAUDE_PROJECT_DIR` and the `GIT_*` locators.

## Budgets and cost

A Claude Code builder's wave stops at its budget (`--budget`, else the builder's `budgetUsd`, else $10). The accounting, each rule from a live wave on 2026-10-23:

- **Keep a run's highest total, never the sum.** A run prints a `result` each time background work wakes it, each with the run's total so far: one run printed six totals from $7.63 to $9.98, which summed to $55.13.
- **A resumed run reports the whole session.** Its `total_cost_usd` included the first run ($6.48 after $6.26), while `usage` counts its own tokens; the runner tells which from the first result and adds only the difference.
- **`--max-budget-usd` holds a run, not the session**, and stops after the turn that crosses it (a 10-cent cap allowed one 16-cent turn). So the runner adds runs up in whole cents (0.7 + 0.1 is 0.7999… in floating point) and gives each new run what the wave has left.
- **A run that never reported its cost** spent an unknown amount: the wave goes to the lead rather than start another run on a guess.

OpenCode's builder has no metered cost in the worked example.

## After the runner exits

The lead audits ([work-loop-and-gates.md](work-loop-and-gates.md#the-leads-audit-before-a-merge)), merges with `merge-approved.mjs` and deploys with `deploy-approved.mjs`, reporting what it printed. A failed deploy or a rollback goes under Blockers in `docs/STATUS.md`, and the deploy isn't run again until the cause is fixed. The lead files the deferred notes as issues, adds the log entry, and updates STATUS.

Teardown: once the PR merged, delete the clone and keep its logs (`<clone>.log`, `.events.jsonl`, `.stderr.log`). After a project's first OpenCode wave, grep its event log for blocks the guard shouldn't have made (`doesn't know the tool`, `names no file`, `no command the guard can read`) and fix the mapping in `lib/opencode.mjs`; only `write` was seen live.

## One spec at a time

Two specs can build side by side only when `node tools/spec-check/check.mjs --across specs/A specs/B` is clean: a second builder that meets code its spec didn't describe stops with `BLOCKED.md`, by design. In the source project every pair of the later specs shared files (the route index, the gallery registry, the shared contracts' index), so from spec 05 on, one spec builds at a time, in a fixed order, and a spec's first wave starts when the one before it has merged its last (decision 0031, 2026-10-24). Splitting shared index files per feature to allow parallelism was rejected as indirection for the build plan's sake. Waves inside a spec still run as before, on disjoint files. Migrations take numbers in build order, written in `specs/README.md`.

## Pre-approval and its limits

Unattended work needs the owner's approval in advance, and approval reaches only what was named.

- **Builds (2026-10-23):** "i pre-approve all the next specs and waves to start building" and "DO NOT WAIT ON ME. use your experience and best judgement." Merge approved PRs and deploy without waiting. A wave that migrates the live database merges too: the migration's own backup is the safety net, and a failed deploy goes under Blockers.
- **Screens, specs and Codex reviews (0029, 2026-10-23 evening):** screens designed by a builder and frozen after the lead's batch review, every spec the dependencies allow, written without stopping to ask.
- **What pre-approval doesn't cover:** payments and accounts (CI billing, store accounts, OAuth apps and consent screens), the owner's own keys, the owner's phone. Specs that need them are still written; their `action-required.md` says what waits.
- **Silence isn't consent for a reserved call.** The lead's reply named two proposed decisions as covered; the owner's answers engaged with the plan without mentioning them. Both records reserved the call to the owner, so they stayed Proposed and the work they enabled went ahead as evidence only (0029, point 5).
- **The one who skipped a gate proposes the fix, and doesn't approve it.** The screen check never ran for seven waves; the lead proposed the gallery (0027) and left accepting it to the owner.

Record each pre-approval as a decision record quoting the owner, so a later session can tell what it covers.

## When the lead tells the owner

A wave that needs them, a rollback, a `BLOCKED.md` only they can clear, a PR still unapproved after five rounds, a decision reserved to them. Otherwise one report per spec, and the rest in `docs/log.md` and `docs/STATUS.md` (Waiting on the owner).
