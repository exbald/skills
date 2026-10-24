# From autonomous-spec-runs to this kit

`~/.claude/skills/autonomous-spec-runs/` was written from an earlier overhaul (nine specs, 64 tasks) run unattended with ZCode's Goal mode against a remote Linux box. This kit came out of a later product build, in October 2026, by a lead model and cheaper builders, wave by wave. Most of the old skill still holds and is folded in here; some of it was replaced; a few parts exist only there.

## What still holds, and where it lives now

| The old skill's idea | Here |
|---|---|
| Four layers: a decision record, specs in git, one contract (`AGENTS.md`), guardrail hooks | [work-loop-and-gates.md](work-loop-and-gates.md); the kit installs all four |
| State lives in git, never in the harness, so a run resumes with another model or tool | the same (the source project's decision 0009) |
| Why the guard isn't optional: the `.env` story, a model reasoning past a prose rule | [work-loop-and-gates.md](work-loop-and-gates.md#why-hooks-and-not-only-prose), [pitfalls.md](pitfalls.md) |
| Spec anatomy, the eleven task sections, self-contained tasks, no shared files in a wave, literal verification, 1–3 hour tasks | [spec-format.md](spec-format.md), enforced by `tools/spec-check` |
| The work loop and its stop conditions; a blocked note is a success | `AGENTS.md`, [work-loop-and-gates.md](work-loop-and-gates.md) |
| Briefing spec-writing agents, an exemplar to match, collisions between parallel writers, errata | [spec-format.md](spec-format.md#briefing-a-spec-writing-agent) |
| Pitfalls: commit without push, no placeholder-hash amend, rules with no alternative, the checker reads lists literally, the transcript is not evidence, pure-function tests, no early e2e | [pitfalls.md](pitfalls.md) |
| The goal prompts' wording lessons: "in order" twice, "touch only its listed files" even with a hook, a literal completion condition, "a blocked note is an acceptable end state", state who owns the release, skip `action-required.md` explicitly | the wave brief (`tools/build/lib/brief.mjs`) says the same things |
| First run: watch one task, then a wave, then a spec | [pitfalls.md](pitfalls.md#process-and-approvals) |
| Judging a run: commits match tasks, files inside lists, tests only gain, gates pass at HEAD, ledger matches ticks, read money/auth/data diffs | the lead's audit, [work-loop-and-gates.md](work-loop-and-gates.md#the-leads-audit-before-a-merge) |
| Testing hooks by piping JSON into them | `tools/guardrails/README.md`, and the hooks' test suites |

## What changed

| Then (ZCode overhaul) | Now (this kit) | Why |
|---|---|---|
| One long Goal-mode session per spec or run, judged by the harness's completion check | `tools/build/run-wave.mjs`: one builder process per wave, in its own clone, with a watchdog, nudges, a spend cap and exit codes for the lead | Sessions went silent and never recovered; a stalled run needs something outside it to notice (the source project's decision 0024) |
| One model does everything | Roles: a strong lead writes and audits; a cheap builder takes waves whose code is given, a strong builder the rest | Keep the spend where judgment matters; GLM built cleanly at no metered cost, Sonnet won the pilots |
| A read-only reviewer subagent after every wave | The reviewer bot on every pull request, an adversarial review (Codex) by another family on every spec, and the lead's audit | A diff reviewer misses whole classes of spec problems; a spec's mistakes multiply |
| `progress_log.md` | `specs/LEDGER.md`, with an agent and model column; `docs/log.md` for sessions | Learn which models do which work well |
| A branch per spec, fast-forward merged into local master; pushing master forbidden as the release gate | A branch and a pull request per wave, merged by `merge-approved.mjs` once the bot approved the head and CI passed; pushing the default branch still forbidden | Review needs a PR; the script checks before it merges, so agents can merge (0015) |
| Releases human-gated | The lead deploys `origin/<default>` through `deploy-approved.mjs`, which builds from an export, checks health and rolls back (0016), within the owner's pre-approval (0029) | Merged work waited on a human; the script, not the agent's judgment, decides what's safe |
| A plugin folder with commands, agents, skills and hooks | Hooks only (`tools/guardrails/hooks`), wired by `.claude/settings.json` for Claude Code, a plugin for OpenCode, and manifests kept for ZCode | Claude Code runs project-level hooks; OpenCode needed its own plugin; the commands and agents weren't load-bearing |
| A deny list: `npm`/`yarn` denied, `db:reset`/`db:push`/`drizzle-kit drop`, docker verbs, `curl` at deploy or payment APIs | A shell parser and a broader built-in list (merges in every spelling, Fly's allow-list, kill by port, live keys, printing the environment); `npm install <pkg>` allowed when the task lists its `package.json`; project-specific denials in `deniedCommands` | Agents need installs; what's dangerous differs by project, so it's config |
| The stop hook: complete means committed | Complete, committed, verified on exactly the committed tree (`specs/.verified`), and pushed | "Complete" claimed over uncommitted, unverified or unpushed work was the common failure |
| A wave checker: sections, file lists, same-wave overlap | `tools/spec-check`: also README consistency, dependencies, the lockfile, `--ready` drift and `--across` specs | Specs written ahead drift, and parallel specs collide |
| Project specifics edited into the scripts | `agentkit.config.json` and `init.mjs` | One kit, many repositories |

The old skill's ZCode advice that unanswered questions auto-continue after five minutes also changed in spirit: unattended builders here get no questions at all (OpenCode's `question` tool is blocked, and the brief says nobody will answer), and decide from the files or write `BLOCKED.md`.

## What's only in the old skill

Use `autonomous-spec-runs` when you need one of these; this kit doesn't cover them:

- **ZCode's harness facts:** `AGENTS.md` read natively, `/goal` and its pause/resume/replace, execution modes (`Shift+Tab`), project-level hooks not executed (plugins only), plugin manifests and installation, remote-workspace plugin paths, no hot reload, user-level subagents, automations and idle-time tasks being local-only, Browser Use desktop-only.
- **Goal prompt templates** for one wave, one spec, and a continuous multi-spec run in Goal mode.
- **The remote dev box:** why (case sensitivity matching CI and production, heavy toolchains off the desktop), and its setup: an unprivileged user (not in the docker group on a shared box), a per-host deploy key, no production secrets (a dummy `.env.local`), separate dev and test databases, a host-managed test database, verifying install, typecheck, tests and boot before pointing an agent at it, and an SSH alias for the unprivileged user. Still sound advice; this kit ran on the lead's Mac and doesn't set a box up.

Whether to retire the old skill is the owner's call: it's the better guide for ZCode Goal-mode runs and remote boxes, and this kit supersedes it for everything else.
