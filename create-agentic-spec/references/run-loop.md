# Run loop

Use the same orca executable you used for `orca skills get orchestration --full`, and follow that guide for waits, liveness, recovery and release. Pass `--json` to every orca command and record each id in `run-state.md` as you get it. `<skill>` below means this skill's directory.

## 0. Preflight

1. `orca status --json` shows the runtime ready.
2. You are in the feature worktree, on the feature branch, with a clean tree and the spec committed.
3. Push and open the PR so the bot reviews the spec as well:
   `git push -u origin <branch>`, then `gh pr create --base <base> --title "<feature>" --body "<summary; spec in specs/<feature>/>"`.
   Run `references/review-loop.md` on that push.
4. `orca orchestration run-create --objective "<feature>: <one line>" --json`, and record the Run id.

## 1. Spec critique (before wave 1)

```text
orca orchestration worker-start --spec "<critic spec>" --task-title "spec-critique" --worktree current --agent <critic> [--model <id> --effort <level>] --json
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
```

Critic spec:

> You are checking a feature spec before other agents implement it. Edit no file except `specs/<feature>/reviews/spec-critique.md`. Read everything in `specs/<feature>/` and the code it cites. For each task file, list: (1) anything you would have to guess; (2) any instruction you could satisfy literally while defeating its purpose; (3) any file you would need that is not in its lists; (4) any Verification command that is missing, cannot run, or would pass on wrong code; (5) any contract two tasks share that is not written out exactly. Cite the task id and the line for every item. Commit only that file (`git add` it by path), then send worker_done.

Fix every item in the spec, rerun `spec_guard.py lint` until it reports 0 errors, commit (`spec: address critique`), and release the critic.

## 2. Each wave

### 2a. Create the wave's tasks and start them all before waiting

Create a wave's tasks just before starting it, so each one carries the latest committed task file.

```text
orca orchestration task-create --task-title "<task-id>" --deps '<json array of earlier task ids>' --spec "$(cat specs/<feature>/tasks/<task-id>.md)" --json
orca orchestration worker-start --task <task id> --worktree new-child --name <feature>-<task-id> --agent <agent> [--model <id> --effort <level>] --setup run --json
```

From each receipt, record the dispatch id, the child worktree's path and branch, and `launch.effective`. If the effective model differs from `team.md`, decide now whether that is acceptable. If a receipt lacks the path or branch, find the child under `childWorktreeIds` in `orca worktree list --json`.

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

All checks pass: `orca orchestration worker-release --dispatch <dispatch id> --json`, then acknowledge.

A check fails: give the same agent a fix in the same child worktree, before acknowledging:

```text
orca orchestration task-create --task-title "<task-id>-fix1" --spec "<the task file, plus a '## Fix required' section with the exact failing output>" --json
orca orchestration worker-start --task <fix task id> --terminal <worker terminal handle> --worktree path:<child path> --json
```

A second failure: start the next tier's agent on the same child worktree (`--worktree path:<child path> --agent <stronger agent>`), or rewrite the task if the spec is the problem. Orca fails a task after three failed attempts. Stop there and report.

### 2d. Merge

Once every task in the wave is accepted, merge in the coordinator worktree, in plan order:

```text
git merge --no-ff <child branch> -m "merge <task-id>"
```

Then run every Gate from `requirements.md` on the merged branch. A failure here means two tasks collided or a contract was wrong. Write a fix task and start it with `--worktree new-child` from the merged HEAD.

### 2e. Review

```text
orca orchestration worker-start --spec "<reviewer spec>" --task-title "review-wave-<n>" --worktree current --agent <reviewer> [--model <id> --effort <level>] --json
```

Reviewer spec:

> Review the changes in `git diff <wave base sha>..HEAD` against `specs/<feature>/requirements.md` and the task files of wave <n>. Read every changed file in full, not only the diff. Report only real problems, each with file:line, why it is wrong, and a concrete failing scenario. Severity: P1 for a bug, security hole, data loss or spec violation; P2 for a likely bug, or an acceptance criterion with no test; P3 for style. Write the findings to `specs/<feature>/reviews/wave-<n>.md`, commit only that file, and send worker_done. Edit no other file.

If `team.md` splits the review by family, start one reviewer per group, each limited to its group's files with `git diff <wave base sha>..HEAD -- <those files>`.

- **P1 and P2:** write fix tasks owned by the task whose files they touch, at that task's tier or higher. Start them with `--worktree new-child`, accept them as in 2c, merge, and rerun the gates. Then reuse the reviewer's terminal for one re-check of those findings.
- **P3:** list them in the PR body.
- **No convergence after two review rounds:** stop and ask the user.

### 2f. Push

Update `run-state.md` and commit it, then `git push`. Run `references/review-loop.md` until the bot's review of HEAD is clean. Only then start the next wave.

## 3. QA (after the last wave)

```text
orca orchestration worker-start --spec "<QA spec>" --task-title "qa" --worktree current --agent <qa> [--model <id> --effort <level>] --json
```

QA spec:

> Prove each acceptance criterion in `specs/<feature>/requirements.md` against the app running from this worktree. Start it with `<start command>` on port `<port>`, and use `<browser tool, for example browser-harness>` for browser steps. For each criterion, write down the steps you took, the expected and actual results, and the evidence: command output, or a screenshot saved under `specs/<feature>/qa/`. Mark each criterion PASS or FAIL. Write `specs/<feature>/qa/report.md`, commit only files under `specs/<feature>/qa/`, stop the app, and send worker_done. Fix nothing you find.

A FAIL leads to a fix task, accepted as in 2c, merged, gated, re-checked by QA, pushed, and run through the bot loop.

## 4. Close

- `orca orchestration worker-list --run <run id> --terminal-state reclaimable --json` returns nothing.
- Remove a child worktree with `orca worktree rm` only when `git branch --merged` shows its branch merged into the pushed feature branch. If in doubt, leave it and list it in the report.
- Report as `SKILL.md` step 6 describes.
