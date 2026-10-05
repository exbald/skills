# Spec templates

Every file lives in `specs/<feature>/` on the feature branch and is committed before launch. `scripts/spec_guard.py lint` checks the task files.

## requirements.md

```markdown
# <Feature>: requirements

## Summary
One or two sentences.

## Problem
Why this is needed, and for whom.

## Scope
In: ...
Out: ...

## Decisions
| Decision | Choice | Why | Decided by |
|---|---|---|---|

## Acceptance criteria
Numbered. Each one is observable in the running app or through a command. QA proves every one.
1. ...

## Gates
Commands that must pass on the merged branch after every wave:
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm e2e` (after the final wave and for QA)

## Evidence
The file:line references this spec relies on.
```

## team.md

```markdown
# <Feature>: team

Facts from `team_facts.py --hours <n>` at <date time>:
<paste the lines you relied on, EXHAUSTED ones included>

| Role | Agent | --model | --effort | Family | Why (evidence) | Fallback |
|---|---|---|---|---|---|---|
| PM / coordinator | | | | | | |
| Spec critic | | | | | | |
| Coder T3 | | | | | | |
| Coder T2 | | | | | | |
| Coder T1 | | | | | | |
| Reviewer | | | | | | |
| QA | | | | | | |

Family check: reviewer <family> differs from every coder family (<families>); QA <family> likewise.
GitHub review bot: <verdict bot via workflow | Codex connector | none>
```

## plan.md

```markdown
# <Feature>: plan

## Waves
| Wave | Task | Tier | Depends on | Owns |
|---|---|---|---|---|
| 1 | w1-schema | T3 | none | src/db/schema.ts, src/db/migrations/ |

## Why this split
One paragraph per wave: what it unlocks, and why its tasks cannot collide.

## Shared files and their owners
| File | Owner |
|---|---|
| src/db/schema.ts | w1-schema |
| pnpm-lock.yaml | nobody; this feature adds no dependencies |
```

## action-required.md

Human-only steps (secrets, DNS, payments, production migrations, bot-quota decisions) under three headings: Before the run, During the run, After the run. Each item is one line with its reason.

## run-state.md

```markdown
# <Feature>: run state

Run: <run id> · Branch: <branch> · PR: <url> · Coordinator: <agent / model>

| Task | Wave | Agent / model (effective) | Dispatch | Child branch | Guard diff | Verification rerun | Review | Merge commit | Status |
|---|---|---|---|---|---|---|---|---|---|

## Pushes and bot reviews
| Push | HEAD | Bot | Verdict on HEAD | Round | Notes |
|---|---|---|---|---|---|

## Questions answered
| Task | Question | Answer | Recorded in |
|---|---|---|---|
```

## tasks/<task-id>.md

Task ids are `w<wave>-<slug>`. Each section below is required unless marked optional. Name no model or vendor anywhere in the file.

```markdown
# w2-invitations-api: Invitation routes for create, list, resend and revoke

## Wave
2 (depends on w1-schema, w1-contracts)

## Tier
T3: auth checks and token handling

## Needs vision
no

## Goal
Two or three sentences: the observable result, and who uses it.

## Read first
(optional)
- `src/lib/auth.ts:12-48`: how routes call `requireRole`.
- `src/app/api/workspaces/[id]/members/route.ts`: the route pattern to copy.

## Files you may modify
none

## Files you may create
- `src/app/api/workspaces/[id]/invitations/route.ts`
- `src/app/api/workspaces/[id]/invitations/route.test.ts`

Any file not listed above: stop and ask.

## Exact contract
(optional; required when another task depends on this one)
The types, signatures, routes, status codes and error codes, verbatim. Do not rename anything.

## Steps
(optional)
1. ...

## Verification
Run each command from the worktree root. Each must give the stated result.
- `pnpm vitest run src/app/api/workspaces/[id]/invitations` passes with at least 8 tests.
- `pnpm typecheck` exits 0.
- `pnpm eslint src/app/api/workspaces/[id]/invitations` exits 0.

## Acceptance criteria
- [ ] A POST from a member session returns 403 and creates nothing.

## Do not
- Edit, skip, delete or weaken any test, assertion or snapshot this task did not create.
- Add, remove or upgrade dependencies.
- Touch `.env*` files, migrations, lockfiles, or any file not listed above.
- Push, merge, rebase, amend or force anything, or run `git add -A`, `git add .` or `git commit -a`.
- Leave TODOs, stubs, placeholder values, or mocks of the code under test.
- Start a dev server, the e2e suite, or other agents.

## Stop and ask the coordinator if
- you need a file that is not listed;
- the code or the contract contradicts this file;
- a Verification command fails twice for a reason you cannot fix inside your own files;
- a decision is not covered here.
Use the `ask` command from your Orca preamble and wait for the answer. Never guess.

## When done
1. Run `git add` on each of your files by path, then `git commit -m "w2-invitations-api: <title>"`.
2. Send `worker_done` as your preamble describes, with `--files-modified` and a summary listing each Verification command and its result. Use `--outcome failed` if anything above is unmet.
```
