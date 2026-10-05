# Run loop

Use the same orca executable you used for `orca skills get orchestration --full`, and follow that guide for waits, liveness, recovery and release. Pass `--json` to every orca command and record each id in `run-state.md` as you get it. `<skill>` below means this skill's directory.

## Known Orca sharp edges (read before wave 1)

Open issues as of Orca 1.4.220, checked 2026-10-05. When Orca updates, recheck them with `gh issue view <number> -R stablyai/orca`.

| Issue | What happens | What to do |
|---|---|---|
| [#21316](https://github.com/stablyai/orca/issues/21316): `new-child` ignores the parent | The child branches from the repo's default branch, not your feature branch, so a wave-2 worker starts without wave 1's code | Never start a coder with `--worktree new-child`. Create its worktree yourself and check the base before the agent starts (2a) |
| [#25131](https://github.com/stablyai/orca/issues/25131): a restart abandons Dispatches | After an Orca restart every live Dispatch reads `abandoned`, the coordinator loses its Run binding, and worker terminals come back as plain shells. The files survive | Rebind with `orca orchestration run-use --id <run id from run-state.md> --json`. Inspect each child worktree with git, then restart unfinished tasks with `--retry-of` on `--worktree path:<child path>`. A lost Dispatch is never a success |
| [#25257](https://github.com/stablyai/orca/issues/25257): DeepSeek harness readiness timeout | A dsh-tui worker times out at agent readiness, so its task is never delivered | Do not start DeepSeek as an Orca worker; run one-shot work through `dsh --profile headless` (`roster.md`). For any other readiness timeout, read the receipt's `failedStage` and follow Orca's recovery guide; never relaunch blindly |

## 0. Preflight

1. `orca status --json` shows the runtime ready.
2. You are in the feature worktree, on the feature branch, with a clean tree and the spec committed.
3. **Child worktrees contain only committed files.** The repo's Orca setup script must install dependencies and copy the gitignored files workers need, such as a dev-only `.env.local` or `.mcp.json`.
   - If the app has a local database or ports, the setup and archive scripts should also give each worktree its own database and port, as a companion env-isolation setup does. Without that, keep every database-backed command with you and QA.
   - Prove it once: create a throwaway child as in 2a, run the gates in it, then remove it.
4. **Bot on** (`team.md`): `git push -u origin <branch>`, then `gh pr create --base <base> --title "<feature>" --body "<summary; spec in specs/<feature>/>"`, then run `references/review-loop.md` on that push, so the bot reviews the spec too.
   **Bot off:** `git push -u origin <branch>` only. The user opens the PR at the end.
5. `orca orchestration run-create --objective "<feature>: <one line>" --json`, and record the Run id.

## 1. Spec critique (before wave 1)

```text
orca orchestration worker-start --spec "<critic spec>" --task-title "spec-critique" --worktree current --agent <critic> [--model <id> --effort <level>] --json
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
```

Critic spec:

> You are checking a feature spec before other agents implement it. Edit no file except `specs/<feature>/reviews/spec-critique.md`. Read everything in `specs/<feature>/` and the code it cites. For each task file, list: (1) anything you would have to guess; (2) any instruction you could satisfy literally while defeating its purpose; (3) any file you would need that is not in its lists; (4) any Verification command that is missing, cannot run, or would pass on wrong code; (5) any contract two tasks share that is not written out exactly. Cite the task id and the line for every item. Commit only that file (`git add` it by path), then send worker_done.

Fix every item in the spec, rerun `spec_guard.py lint` until it reports 0 errors, commit (`spec: address critique`), and release the critic.

## 2. Each wave

### 2a. Create the wave's tasks, their worktrees, and start every worker before waiting

Create a wave's tasks just before starting it, so each one carries the latest committed task file. Record the wave base first; the reviewer uses it too.

```text
WAVE_BASE=$(git rev-parse HEAD)
orca orchestration task-create --task-title "<task-id>" --deps '<json array of earlier task ids>' --spec "$(cat specs/<feature>/tasks/<task-id>.md)" --json
orca worktree create --name <feature>-<task-id> --base-branch <feature branch> --parent-worktree current --setup run --json
git -C <child path> merge-base --is-ancestor "$WAVE_BASE" HEAD
orca orchestration worker-start --task <task id> --worktree path:<child path> --agent <agent> [--model <id> --effort <level>] --json
```

The ancestry check must exit 0: the child must contain everything merged so far (#21316). If it fails, the child is brand new and nothing runs in it yet. Reset it with `git -C <child path> reset --hard "$WAVE_BASE"`, rerun the dependency install there, and check again before starting the worker.

Record the child's path and branch from the worktree receipt, and the dispatch id and `launch.effective` from the worker receipt. If the effective model differs from `team.md`, decide now whether that is acceptable.

### 2b. Wait and answer

```text
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
```

- **question:** answer from `requirements.md` and the task file. If the answer is in neither, ask the user. Write the answer into the task file, commit it on the feature branch, then `orca orchestration reply --id <message id> --body "<answer>" --json`.
- **escalation:** decide, then reply or fix the spec.
- **worker_done:** run 2c before acknowledging the delivery.

### 2c. Accept a worker_done only after every check

| Check | How | Record in run-state.md |
|---|---|---|
| Outcome and dispatch | `--outcome succeeded`, and the dispatch id is the one you expect | Status |
| Diff inside the allowlist, no test lines deleted | `python3 <skill>/scripts/spec_guard.py diff specs/<feature>/tasks/<task-id>.md --base <feature branch> --head <child branch> --repo <child path>` | Guard diff |
| Verification holds | Rerun every Verification command yourself, in the child path | Verification rerun |
| Nothing hidden | Read the diff: hard-coded values, disabled checks, swallowed errors, `skip`/`only` in tests | (notes) |

All checks pass: `orca orchestration worker-release --dispatch <dispatch id> --json`, then acknowledge. If the user wants to steer this worker first, see "When the user steers" below.

A check fails: give the same agent a fix in the same child worktree, before acknowledging:

```text
orca orchestration task-create --task-title "<task-id>-fix1" --spec "<the task file, plus a '## Fix required' section with the exact failing output>" --json
orca orchestration worker-start --task <fix task id> --terminal <worker terminal handle> --worktree path:<child path> --json
```

A second failure: start the next tier's agent on the same child worktree (`--worktree path:<child path> --agent <stronger agent>`), or rewrite the task if the spec is the problem. Orca fails a task after three failed attempts. Stop there and report.

### When the user steers (optional)

The user may want to review a worker's diff in Orca with diff comments, or point at UI with Design Mode in that worktree's browser. Design Mode is the user's tool: it sends the element they click, with its HTML, CSS and a screenshot, to the agent in that worktree. Workers don't need it.

1. Before acknowledging that worker's worker_done, keep its terminal: `orca orchestration worker-retain --dispatch <dispatch id> --json`. Their comments and clicks then reach that agent as new instructions.
2. When the user is done, rerun every check in 2c on the child worktree, then release the terminal.

### 2d. Merge

Once every task in the wave is accepted, merge in the coordinator worktree, in plan order:

```text
git merge --no-ff <child branch> -m "merge <task-id>"
```

Then run every Gate from `requirements.md` on the merged branch. A failure here means two tasks collided or a contract was wrong. Write a fix task and start it as in 2a, with the merged HEAD as its base.

### 2e. Review

```text
orca orchestration worker-start --spec "<reviewer spec>" --task-title "review-wave-<n>" --worktree current --agent <reviewer> [--model <id> --effort <level>] --json
```

Reviewer spec:

> Review the changes in `git diff <wave base sha>..HEAD` against `specs/<feature>/requirements.md` and the task files of wave <n>. Read every changed file in full, not only the diff. Report only real problems, each with file:line, why it is wrong, and a concrete failing scenario. Severity: P1 for a bug, security hole, data loss or spec violation; P2 for a likely bug, or an acceptance criterion with no test; P3 for style. Write the findings to `specs/<feature>/reviews/wave-<n>.md`, commit only that file, and send worker_done. Edit no other file.

If `team.md` splits the review by family, start one reviewer per group, each limited to its group's files with `git diff <wave base sha>..HEAD -- <those files>`.

- **P1 and P2:** write fix tasks owned by the task whose files they touch, at that task's tier or higher. Start them as in 2a from the current HEAD, accept them as in 2c, merge, and rerun the gates. Then reuse the reviewer's terminal for one re-check of those findings.
- **P3:** list them in the PR body, or in the final report when the bot is off.
- **No convergence after two review rounds:** stop and ask the user.

The reviewer runs whether or not the GitHub bot is on. With the bot off, it is the only independent check.

### 2f. Push

Update `run-state.md` and commit it, then `git push`.
- **Bot on:** run `references/review-loop.md` until the bot's review of HEAD is clean.
- **Bot off:** the push only keeps the work safe.

Only then start the next wave.

## 3. QA (after the last wave)

```text
orca orchestration worker-start --spec "<QA spec>" --task-title "qa" --worktree current --agent <qa> [--model <id> --effort <level>] --json
```

QA spec:

> Prove each acceptance criterion in `specs/<feature>/requirements.md` against the app running from this worktree. Start it with `<start command>` on port `<port>`, and use `<browser tool, for example browser-harness>` for browser steps. For each criterion, write down the steps you took, the expected and actual results, and the evidence: command output, or a screenshot saved under `specs/<feature>/qa/`. Mark each criterion PASS or FAIL. Write `specs/<feature>/qa/report.md`, commit only files under `specs/<feature>/qa/`, stop the app, and send worker_done. Fix nothing you find.

A FAIL leads to a fix task, accepted as in 2c, merged, gated, re-checked by QA, and pushed. With the bot on, the push also goes through the bot loop.

## 4. Close

- `orca orchestration worker-list --run <run id> --terminal-state reclaimable --json` returns nothing.
- Remove a child worktree with `orca worktree rm` only when `git branch --merged` shows its branch merged into the pushed feature branch. If in doubt, leave it and list it in the report.
- Report as `SKILL.md` step 6 describes. With the bot off, end by telling the user the branch is ready for them to open the PR.
