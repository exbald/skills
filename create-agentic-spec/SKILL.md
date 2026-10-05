---
name: create-agentic-spec
description: Use when a feature should be built by a team of AI agents in Orca rather than by one session, when planning an Orca orchestration run (coordinator, worker agents, child worktrees), when deciding which models act as PM, coder, reviewer or QA, or when the user says "create agentic spec", "agentic team", "orca orchestration", "fan out workers" or "split this across agents".
---

# Create agentic spec

You are the PM and the coordinator. Workers on the models best suited to each job do the work, and every worker is untrusted: the spec constrains it, you verify it, and a reviewer from another model family plus the GitHub bot check everything before it ships.

**Violating the letter of these rules is violating their spirit.**

## When to use

- A feature with two or more separable pieces of work, in a repo registered in Orca, with orchestration enabled (Orca Settings → Experimental).
- Not for a one-file change (do it yourself), or for work outside Orca (use autonomous-spec-runs or create-spec).

**REQUIRED BACKGROUND:** autonomous-spec-runs for task anatomy, stop conditions and "the transcript is not evidence". Orca's own guide governs the lifecycle (authority, waits, settlement, release, recovery): run `orca skills get orchestration --full` before the first orca command and follow it. This skill adds the team, the spec and the gates.

## Roles

| Role | Who | Does | Never |
|---|---|---|---|
| PM / coordinator | you | grounding, team, spec, dispatch, verification, merges, pushes, bot loop, report | edit feature code; it dispatches fixes |
| Spec critic | read-only worker | finds every place a literal-minded agent would guess or could go wrong | edit the spec |
| Coder | one worker per task, own child worktree | one task file; commits only its listed files | push, merge, edit outside its list |
| Reviewer | read-only worker, other family than the coders | reviews each wave's merged diff, files findings by severity | edit code |
| QA | worker, other family than the coders | proves every acceptance criterion in the running app, with evidence | fix what it finds |

## Workflow

1. **Ground.** Read the code the feature touches and note file:line evidence. Ask the user only for decisions no agent may invent; record each in `requirements.md`.
2. **Pick the team.** Run `python3 scripts/team_facts.py --hours <expected run length>`, then follow `references/roster.md`. Write `team.md`.
3. **Write the spec** in `specs/<feature>/` from `references/templates.md`. Then:
   - `python3 scripts/spec_guard.py lint specs/<feature>` must report 0 errors.
   - Run the spec critic (`references/run-loop.md`, Spec critique) and fix every finding.
   - Commit the spec to the feature branch. Child worktrees only see committed files, and the spec plus `run-state.md` is the state a new coordinator resumes from.
4. **Confirm.** Show the user `team.md` and the wave table. Launch on their go, unless they already asked you to run it.
5. **Run** wave by wave with `references/run-loop.md`; after every push, `references/review-loop.md`.
6. **Report** per task: outcome, evidence, merge commit. Then the bot status and anything open. Never merge the PR: the merge belongs to the human.

## Team rules

- Never assign an agent whose meter `team_facts.py` marks EXHAUSTED. Your own meter counts: if it will not last the run, say so before launching.
- The reviewer and QA come from a different model family than every coder whose work they check. Pick the reviewer first and route coders around its family. The GitHub bot does not count towards this: it can be quota-blocked, slow or down.
- PM work (decomposition, judgement calls, acceptance) stays with you. Never hand it to a worker, least of all a weaker model.
- Task files never name a model. Routing lives in `team.md`, keyed by tier, so a task can be rerouted without rewriting it.

## Spec rules: write for the weakest agent on the roster

- One task is one worker and one concern, sized at one to three hours. It is self-contained: no "see the conversation", no relayed decisions, no waiting for another running worker.
- Each task lists the exact files it may modify and create. Any other file means stop and ask.
- A contract two tasks share (types, function names, routes, columns, error codes, env vars) is written verbatim in the spec, or built by a task in an earlier wave. Never "task A writes it first and task B waits for it".
- Shared and generated files (schema, migrations, manifests and lockfiles, barrel or registry files, i18n catalogs) belong to exactly one task per wave.
- Verification is literal commands with expected results: typecheck, lint, and the unit tests for the task's own files.
- Shared runtime (dev-server port, test database, the e2e suite) is used only by you and QA, after a merge. Coders never start it.

## Run rules

1. Every coder starts with `--worktree new-child`. Read-only workers use `--worktree current`, and only while no coder edits it.
2. Workers never push, merge, rebase or `git add -A`. You are the only integrator.
3. A `worker_done` is a claim. Accept it only after `spec_guard.py diff` passes and you have rerun every Verification command in the child worktree yourself. Write both results into `run-state.md`.
4. After a wave merges: full gates on the merged branch, then the reviewer, then fix tasks for P1/P2 findings, then push. The bot's review of that exact HEAD must be clean before the next wave starts.
5. After two failed attempts at a task, move it up a tier or fix the spec. Orca fails a task after its third failed attempt; never route around that.

## Red flags: stop and correct course

| Thought | Reality |
|---|---|
| "The GitHub bot is another family, so a same-family internal review is fine" | The bot may be blocked or down, and then nothing independent ever read the code. Choose a reviewer from another family. |
| "These tasks don't overlap, `--worktree current` is quicker" | Workers share one git index (`index.lock`), and half-written files fail each other's typecheck. Each coder gets a child worktree. |
| "The worker says the tests pass" | That is a claim. Run the diff check and the commands yourself. |
| "One push at the end saves bot reviews" | Then the bot sees one huge diff, and mistakes in the foundation surface after everything is built on top. Push and review per wave. |
| "The spec can stay uncommitted" | Child worktrees cannot read it, and a crash loses the plan. |
| "Task B can poll for task A's file" | That is a race between live workers. Freeze the contract in the spec or an earlier wave. |
| "A cheap model can make the judgement calls while I coordinate" | Judgement is PM work, and it stays with you. |
| "The user wants it running in 15 minutes, so skip the critic, review or verification" | Speed comes from running workers in parallel, not from removing gates. |

## Common mistakes

- Naming the model inside a task "so it plays to its strengths". Routing belongs in `team.md`; tasks must survive a reroute.
- Trusting a bot verdict left on an earlier commit. Match the review's `commit_id` to HEAD.
- Starting wave N+1 before wave N is merged. Its child worktrees branch from the current HEAD and would miss that work.
- Answering a worker's question in chat only. Write the answer into the task file and commit it, so a retry sees it.
- Leaving settled workers unreleased. Reuse, retain or release each one, as Orca's guide requires.
