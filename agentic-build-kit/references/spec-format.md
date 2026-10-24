# Spec format

A spec is a folder of self-contained tasks, written by the lead (the strongest model) so that cheaper builders can finish each task from its file alone. The format is what `tools/spec-check` enforces; the rules after it are what the format exists to serve. The installed copy of this lives in the target repo's `specs/README.md`, and `specs/_template/` is a spec to copy.

## Folder anatomy

```
specs/NN-name/
├── README.md           header, dependency graph (mermaid), waves table with a goal per wave, task list
├── requirements.md     goals, non-goals, acceptance criteria (cite feature/screen/flow IDs), decisions taken with rationale
├── action-required.md  HUMAN-ONLY steps: accounts, secrets, OAuth clients, DNS, payments, data migrations
└── tasks/
    └── task-MM-slug.md
```

- `NN-name` is two digits and a lower-case slug. The checker skips any other folder name, which is why `specs/_template/` never trips it.
- `task-MM-slug.md` is the only file allowed in `tasks/`.
- `specs/LEDGER.md` sits beside the spec folders: one row per completed task (see [records.md](records.md)).

## The spec README

The header holds three bold fields the checker looks for or the lead relies on:

- `**Milestone:**` which milestone it serves, and what it must follow.
- `**Status:**` written, lighter spec, refreshed on a date, and so on.
- `**Written against:**` the default-branch commit the spec was written against. A later refresh diffs from there, so the writer can see what moved underneath it. The checker requires this line.

Then:

- **A mermaid dependency graph** (` ```mermaid `), task to task. Required.
- **`## Waves`**, a table with the columns Wave, Goal and Tasks. Each wave has a one-line goal, so the lead can tell what a wave delivers without opening its tasks. Required.
- **`## Tasks`**, exactly one line per task file, in this form:

  `- [ ] [task-03](tasks/task-03-lint-and-tests.md): Lint and the test harness (any model)`

  - The box is ticked when the task is complete; the checker matches it against the task's Status both ways.
  - The link text is the task's id and must match the file it links.
  - **The model tag** says who can build it. `(any model)`: a mid-tier coding model can finish it from the file alone. `(strong model)`: it needs judgment the file can't fully pin down, such as security, concurrency, or a framework no model knows from training. A strong-model task still lists the tests it must pass, so a cheaper model can attempt it under review.
  - A wave with any strong-model task runs with the strong builder (see [roles-and-wave-runs.md](roles-and-wave-runs.md)).

## Task sections, in order

The checker requires exactly these eleven `## ` headings, in this order (a heading inside a code fence doesn't count):

| Section | What goes in it |
|---|---|
| `## Status` | `pending` or `complete`, on the first line. The stop hook reads it. |
| `## Wave` | A whole number from 1. |
| `## Description` | What the task delivers and why, in a paragraph or a short list. Cite requirement and acceptance-criterion IDs. |
| `## Dependencies` | `None.`, or the earlier-wave tasks of this spec it needs, as `task-NN`. The checker holds each `task-NN` here to an earlier wave. |
| `## Files to Modify` | `- \`path\`` lines only, or `None.` |
| `## Files to Create` | `- \`path\`` lines only, or `None.` |
| `## Technical Details` | Exact contracts: signatures, schemas, error codes, states and their copy, what the code around it does today (checked at a named commit), and the code itself where a builder would likely go wrong. Commentary about files goes here, never in the lists. |
| `## Implementation Steps` | Numbered steps in the order to do them. Tests first when the task says so. |
| `## Verification` | Literal commands in a code block, with their expected output: exact test counts, exit codes. The checker requires a code block. |
| `## Acceptance Criteria` | A `- ` list of observable outcomes. The checker requires list items. |
| `## Notes` | Dependencies added and why, tests retired and why, decisions the task took, anything the lead should know. |

### An annotated skeleton

````markdown
# Task 03: lint and the test harness

## Status

pending

## Wave

2

## Description

Adds the linter and the test runner, and a throwaway database per test, so every later task can land an
integration test (requirements AC2, AC3).

## Dependencies

task-01

## Files to Modify

- `package.json`
- `package-lock.json`
- `apps/agent/package.json`

## Files to Create

- `biome.json`
- `apps/agent/vitest.config.ts`
- `apps/agent/test/support/temp-db.ts`
- `apps/agent/test/support/temp-db.test.ts`

## Technical Details

What exists today (checked at abc1234): `openDb()` in `apps/agent/agent/lib/db/index.ts` opens one
file from `APP_DB_PATH` and caches it. `useTempDatabase()` gives each test its own file:

```ts
export function useTempDatabase(): { path: string };
```

Pinned versions: `@biomejs/biome` 2.5.15, `vitest` 5.0.5 (Notes says why each).

## Implementation Steps

1. Write `temp-db.test.ts` first: two tests that each see an empty database.
2. Add `useTempDatabase()` until both pass.
3. Add `biome.json` and the `lint` script.

## Verification

```sh
npm run lint            # exits 0
npm test -w apps/agent  # 2 passed (temp-db.test.ts)
node tools/spec-check/check.mjs  # no problems
```

## Acceptance Criteria

- `npm run lint` and `npm test` run from the root and exit 0.
- Two tests that write to the database never see each other's rows.

## Notes

- New dependencies: `@biomejs/biome` (lint and no `console`), `vitest` (the test runner). Exact versions.
- Retires no tests.
````

## Rules that matter more than the format

- **Self-contained.** A fresh agent with no access to the conversation that produced the task can finish it from the file alone. If it needs the conversation, it isn't a task yet. Builders run unattended and nobody answers their questions.
- **No shared files within a wave.** Two tasks in the same wave never share a file, so a wave can be built in any order and its tasks never fight. The checker enforces it (`waveOverlaps`); never rely on trust.
- **How a task names other tasks.**
  - In prose, another spec's task is written without the hyphen: "spec 02's task 13", or "its task 13" once the spec is named. So `task-NN` alone always means a task of the same spec.
  - Under `## Dependencies`, `task-NN` names a same-spec task in an earlier wave that this one needs. A same-spec task it doesn't wait for is written "task 16", or the checker holds it to an earlier wave.
  - Elsewhere, a same-spec task keeps the hyphen ("task-04's file stays as written").
- **File lists hold real paths only.** The guard and the checker read every backticked path-like string in those two sections as a file the task may touch. A comment, a command or a URL there reads as ownership and produces false overlaps. Write a route as its source folder (`src/app/chat/`), not as `/chat`. A path ending in `/` covers the folder; `*` and `?` make a glob; brackets are literal, because an Expo route's `[botId]` folder is a real name.
- **A test file is listed by its path or a glob.** A listed folder doesn't cover tests: tests are the contract, and a builder may change only the tests its task names.
- **A task that lists a `package.json` lists the lockfile too** (`lockfile` in `agentkit.config.json`), because the install changes both.
- **Size.** One to three hours of agent work, small enough to finish within a 200k-token context. Bigger won't fit; smaller and the ledger and review overhead dominate.
- **Human-only work goes in `action-required.md`,** never in a task. An unattended run treats a task as work to attempt; an account, a secret or a payment it can't do becomes a stall or a workaround.
- **Contradictions get surfaced.** When a brief contradicts the code, the spec writer says so in the task instead of papering over it. This is where the most valuable findings come from: a misdiagnosed audit item, a migration that never ran in production.
- **Tests a behavior change retires are named** (the source project's decision 0017, 2026-10-22). A task may change or remove a test only when the behavior it pins changes on purpose, and its Notes name each test and the change behind it. The spec gate then allows exactly those deletions, and the reviewer checks the list against the diff. Without this, a spec could never change tested behavior; without the naming, the exception is the loophole the gate exists to close.

## Proven specs and lighter specs

Two ways to write a task, from the source project's decision 0019 (2026-10-22):

- **Proven.** The writer builds and tests each task's code in a scratch copy first, then copies it into the task byte for byte. A cheap builder can hardly get it wrong, and proving it catches real spec bugs: library APIs that don't exist, versions that don't fit, tests that can't pass. The cost is building the app twice, and task files of 1,000 to 3,300 lines that no reviewer reads as code.
- **Lighter.** Once a spec's early waves have set its patterns, later tasks pin down each file's job and exports as signatures, every API call with its schemas and errors, cache updates, every state and its copy, and every test by name and count. Code appears only where a builder would likely go wrong. The writer checks every name it uses against the code earlier tasks built.

Use proven tasks while the patterns don't exist yet; switch to lighter once they do. A lighter task needs a stronger builder or closer review, and its mistakes surface at build time as `BLOCKED.md`. Scratch-clone traps when proving: see [pitfalls.md](pitfalls.md#local-environment).

## Written ahead, checked before starting

- The lead writes specs well before they're built, so builders never wait on the writer. The cost is drift.
- **`node tools/spec-check/check.mjs --ready specs/NN-name`** before a spec's first task: every file its pending tasks modify exists or an earlier wave creates it, and nothing they create exists yet. If it fails, the builder writes `BLOCKED.md` and the writer refreshes the spec against the current code. Don't run `--ready` on a spec that has started: its own created files then count as "already exists".
- **`--across specs/A specs/B`** before running two specs side by side. Specs that share a file can't run in parallel; in the source project every pair of the later specs did (decision 0031), so they build one at a time.

## What the checker checks

`node tools/spec-check/check.mjs [--ready] [--across] [specs/NN-name ...]` exits 0 clean, 1 with problems (one `<file>: <message>` line each), 2 on a usage error. `npm run verify` runs it on every spec.

- **Structure:** README, requirements and action-required present; at least one task; nothing but task files in `tasks/`; no duplicate task ids.
- **Each task:** the eleven sections in order; Status `pending` or `complete`; Wave a whole number from 1; each file list `None` or `- \`path\`` lines of real, in-repository paths; the lockfile beside any `package.json`; every `task-NN` under Dependencies in an earlier wave of this spec; a code block under Verification; list items under Acceptance Criteria.
- **The README:** a mermaid graph, the Written against line, Waves and Tasks sections, exactly one well-formed line per task file, ticks matching statuses.
- **Overlap:** no two tasks of one wave cover the same file (folders and globs count as overlapping when they could name one file).
- **Config:** a broken `agentkit.config.json` is reported as a problem.

It reads file lists with the guard's own parser (`tools/guardrails/lib/task.mjs`), so the two can't disagree about what a task may touch.

### Its blind spots

- It can't tell that "matches spec 03's tag" names a tag spec 03 no longer uses. Read cross-spec claims yourself.
- It can't see a verification command that fails on success, or a test count that's wrong. The lead's read and the Codex review catch those.
- `--across` compares pending tasks only, by file. Two specs can still collide on a name (an error code, a helper) without sharing a file.

## Briefing a spec-writing agent

When several agents write specs at once (one agent per spec works), give each, in this order:

1. The contract (`AGENTS.md`) and the build plan (`specs/README.md`).
2. The decision records the spec depends on.
3. The evidence: the audit sections or code it cites, with file and line.
4. **One existing spec folder as the exemplar to match exactly.** Without it you get as many formats as writers.

Then require:

- Re-check every cited line against the current head; an audit ages the moment it's written.
- Read every file it will cite, at the cited lines, so its snippets are current.
- Group tasks into waves by file overlap, not by theme.
- Literal verification commands in every task, plus a manual check where one matters.
- Human-only work in `action-required.md`.
- Say so when the brief contradicts the code.

Before a long unattended run, go back through each spec's `action-required.md` and mark what you've decided as accepted, with the reasoning. A decision recorded there is the difference between a run that finishes and one that leaves a blocked note at 1am. Design defaults are the common case: ship proposed values and state that an empty override cell means accepted, as `specs/README.md` does for open technical decisions.

When an audit item turns out wrong, write the erratum into the audit and the spec's requirements and change the task; don't silently drop it, or the next reader "fixes" what was never broken.

## Collisions to expect between parallel writers

Parallel authors independently invent different names for the same thing. Arbitrate early:

- helper and function names for something two specs both touch;
- error codes and HTTP statuses for one failure;
- test file paths when two specs test one module;
- dependency versions, where one spec pins and another copies a stale value while claiming to match;
- file ownership: two specs changing or deleting the same file, or one deleting what the other assumes exists;
- ordering: a verification that depends on a helper a later spec introduces.

Let the writers message each other first, which settles most of it; then run the checker across the pairs and read the cross-spec claims yourself.
