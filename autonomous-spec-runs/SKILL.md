---
name: autonomous-spec-runs
description: Set up a codebase so an AI agent can build it unattended for hours or days, safely and resumably. Use when planning a large refactor or overhaul, breaking work into agent-executable specs, configuring ZCode or Claude Code for long autonomous runs, connecting an agent IDE to a remote dev box over SSH, writing guardrail hooks, or when the user says "have it code while I sleep", "goal mode", "remote dev", "spec-driven", or "run the whole plan unattended".
---

# Autonomous spec runs

How to make an agent build a large change unattended without wrecking anything, and be resumable when it stops. Written from a real overhaul (nine specs, 64 tasks) executed with ZCode Goal mode against a remote Linux box. Every pitfall listed here was actually hit.

## The shape

Four layers, each doing one job:

1. **An ADR.** One page naming the decision everything else depends on. Without it, agents and specs drift toward whatever the old docs still assert.
2. **Specs in git.** `specs/NN-name/` folders of self-contained tasks in dependency-ordered waves. This is the plan and the state.
3. **A contract.** `AGENTS.md`, read by every harness. The work loop, stop conditions, engineering rules.
4. **Guardrail hooks.** A plugin whose PreToolUse hook enforces the task's file boundary and a forbidden-command list, and whose Stop hook refuses to end a turn on unverified work.

State lives in git, never in the harness. That is what makes "stop at 2am, resume next week, possibly with a different model" work.

## Why the guard is not optional

In the first five minutes of the first live run, the agent was asked to write to `.env`. It read the rule forbidding it, reasoned that the risk was nil because the file was gitignored, decided to proceed anyway, and the hook stopped it. It then reached for a shell redirect rather than an edit tool, and the hook caught that path too.

A capable model will reason its way past a rule it finds unpersuasive. Rules in prose are advisory; hooks are enforcement. Build both and expect to need the second.

## Spec anatomy

```
specs/NN-name/
├── README.md          mermaid dependency graph, waves table, unchecked task list, per-wave goal text
├── requirements.md    goals, non-goals, acceptance criteria, decisions taken with rationale
├── action-required.md HUMAN-ONLY steps: secrets, DNS, payments, data migrations, cutovers
└── tasks/
    └── task-NN-slug.md
```

Task file sections, in order: `## Status` (pending/complete), `## Wave`, `## Description`, `## Dependencies`, `## Files to Modify`, `## Files to Create`, `## Technical Details` (exact code, conventions), `## Implementation Steps`, `## Verification` (literal commands), `## Acceptance Criteria`, `## Notes`.

Three properties that matter more than the format:

- **Self-contained.** An agent with a fresh context and no access to the conversation that produced it must be able to finish the task from the file alone. If it needs the conversation, it is not a task yet.
- **No two tasks in a wave share a file.** This is what makes a wave parallelisable. Enforce it mechanically, do not trust it.
- **Verification is literal commands with expected output**, not "make sure it works". The harness judges completion on command output; give it commands.

Size a task at one to three hours of agent work. Bigger and it will not fit a context; smaller and the ledger overhead dominates.

## The work loop

Put this in `AGENTS.md` and let the hooks enforce it.

1. **Bearings.** `git status`, `git log`, tail the ledger, read the spec README, find the first unchecked task in the lowest unfinished wave.
2. **One task.** Read it whole. Touch only its listed files.
3. **Verify.** Run every command in its Verification section. Two genuine failures means stop, not improvise.
4. **Commit and push.** Exactly one commit per task, containing code, status flip, README tick and ledger row. Push immediately.
5. **Log.** One ledger row: task id, description, date.
6. **Next.** Next task in the wave. Report at wave end.

Stop conditions that must produce a `BLOCKED.md` rather than improvisation: needing a file outside the list, a schema change the task does not describe, two failed verifications, needing a secret or anything in `action-required.md`, needing to weaken or skip a test, a task that contradicts the code.

A blocked run with a clear note is a success. A green run that deleted a failing test is a catastrophe.

## Pitfalls, all of them real

**Commit without push strands the work.** The agent commits on the remote box; a reviewer on another machine sees nothing, and losing the box loses the work. Push after every task. Feature branches usually do not trigger CI, so this is free.

**Placeholder-hash-then-amend is incompatible with push-per-task.** Recording the commit hash in the ledger requires an amend, amending a pushed commit requires a force push, and force push must be forbidden. Record the date; `git log --grep="task-NN"` retrieves the hash.

**Rules with no available alternative get ignored or produce noise.** A ban on `console.log` in a repo with 348 of them and no logger helper is not a rule, it is a trap. Either provide the alternative or write the rule to match reality.

**A mechanical checker reads file-list sections literally.** Informational backticked paths inside "Files to Modify" register as ownership and show up as false overlaps. Keep those sections to real paths only; put commentary in Technical Details. Route URLs like `/chat` are not paths; use `src/app/chat/`.

**The transcript is not evidence.** Verify claims yourself: run the gates, check `git diff --name-only` against the task's file list, check `git diff --numstat -- '*.test.ts'` shows zero deletions. An agent reporting VERIFIED four times is a hypothesis.

**Pure-function tests let an agent pass while breaking everything.** If the suite only covers pure helpers, a green run proves nothing about billing, auth or jobs. Land a database-backed integration harness before any autonomous product work, and gate on it.

**Do not write end-to-end tests before the surface stops moving.** If upcoming specs delete routes and restyle pages, browser tests written now get rewritten twice.

## Remote dev box

Worth it mainly for **filesystem case sensitivity**: macOS is case-insensitive, Linux is not, so an agent writing `./Foo` for `foo.ts` passes locally and fails in CI forever. Running on the same OS as CI and production catches that class immediately. Secondary benefits: heavy toolchain off the desktop, and the agent runtime itself runs remotely (measured around 1.2 GB) so the desktop only holds the UI.

It does **not** let the desktop sleep. The harness client must stay running for a goal to advance.

Setup, in order:

1. **Choose the host.** Prefer one that is not the production control plane for the app being built. If it carries someone else's workloads, that changes the next step.
2. **Unprivileged user.** Create `dev`; copy root's `authorized_keys` so existing machines can log in unchanged. **Do not add it to the docker group** if the box has workloads you cannot afford to break, since docker group is effectively root.
3. **Per-host deploy key** registered with the repository, read-write, titled by host so it can be revoked individually.
4. **No production secrets on the box.** Tasks that boot the app need env, so provision a `.env.local` of dummy third-party keys plus a locally generated auth secret and a local database URL. Mode 600, gitignored, and denied to agents by the guard so it can be read but never changed.
5. **Separate dev and test databases.** Integration suites truncate every table; sharing one database means the suite wipes the running app.
6. **Host-managed test database.** Start it as root, matching the compose definition the spec expects, so the agent never needs docker. Have the spec's first task probe the port and skip starting a container when one already answers.
7. **Verify before trusting.** Install, typecheck, full test suite, then boot the app and hit its health endpoint. Do it before pointing an agent at it.
8. **SSH alias for the unprivileged user**, separate from the root alias. Connecting as root produces git's "dubious ownership" error, which is the separation working; the fix is to be the right user, not to silence git.

## Harness facts (ZCode)

Verified against its docs and live behaviour. Check for drift.

- **`AGENTS.md` is read natively**, global at `~/.zcode/AGENTS.md` then the workspace copy. `CLAUDE.md` is only a one-time migration source, so put the contract in AGENTS.md.
- **Goal mode** is `/goal <objective>`, plus `pause`, `resume`, `replace`, `clear`. It judges completion on changed files, command output and test results rather than on the model's claims, and unfinished to-dos block completion. State survives app restarts. One goal per session. Unavailable in Plan mode. A per-goal usage budget will stop it, so set it generously for long runs.
- **Execution modes** cycle with `Shift+Tab`: Ask before changes, Edit automatically, Plan, Full access. Unattended runs need Full access plus hooks as the real safety.
- **Unanswered questions auto-continue after five minutes.** The model then guesses. Leave it on, because stalling all night is worse, and rely on the guard to catch a wrong guess.
- **Project-level hooks are not executed.** Only user-level (`~/.zcode/cli/config.json`) and **plugin-level** (`hooks/hooks.json`). Ship guardrails as a plugin.
- **Plugins** bundle skills, commands, subagents, MCP servers and hooks. Manifest at `.zcode-plugin/plugin.json`, with `.claude-plugin/plugin.json` accepted, so one directory serves both ZCode and Claude Code. Installed from Settings, Plugins, Personal, pointing at a marketplace directory.
- **With a remote workspace, plugin paths resolve on the remote host.** Give it the repo path on the box, not a local one. This also implies hooks execute remotely, which is what makes the whole arrangement safe.
- **Plugins do not hot-reload.** Start a new task after installing or changing one.
- **Subagents** live at `~/.zcode/agents/<name>.md` with `name` and `description` frontmatter, optional `model`, `tools`, `disallowedTools`, `maxTurns`. User-level only, currently beta, cannot nest. Foreground ones run in parallel.
- **Automations (cron) and idle-time tasks are local-workspace only** and require the machine awake. Idle-time tasks are free for subscribers, which makes them the right home for review passes. They do not work against a remote workspace, so keep a second local clone for them.
- **Browser Use** is desktop-only. To view an app running on a remote box, tunnel it: `ssh -L 3000:127.0.0.1:3000 <host>` then point the panel at localhost.
- Remote Control is a phone driving an open desktop session, one phone at a time. Bot channels are WeChat and Feishu, not Telegram.

## Running it

**First run: watch one task, then leave.** You are testing the machine, not the plan. Confirm the marker file appears, only the listed files change, verification passes, a commit lands, the checkbox flips. Those six things prove the loop end to end.

**Then a wave at a time**, then a whole spec, then chained specs, as trust accumulates.

**When you step out, review must stay in.** Put a read-only reviewer subagent in the loop after every wave, fixing confirmed findings as extra commits. Removing the human gate without this removes review entirely.

**Keep the release gate human.** Let the agent merge into local master to unblock the next spec, but forbid pushing master. Once a deploy pipeline exists, a master push is a production release, and no agent should own that.

Goal prompt templates are in `references/goal-prompts.md`. A working plugin implementation, including the three hook scripts and the wave checker, is in the reference file `references/guardrail-plugin.md`.

## Judging whether it worked

Not "did the goal go green". Check: commits match tasks one to one, changed files sit inside each task's declared list, test files show additions and zero deletions, the gates pass at HEAD, and the ledger matches the checkboxes. Then read the diff of anything touching money, auth or data.
