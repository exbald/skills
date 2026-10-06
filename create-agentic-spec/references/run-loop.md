# Run loop

Use the same orca executable you used for `orca skills get orchestration --full`, and follow that guide for waits, liveness, recovery and release. Pass `--json` to every orca command and record each id in `run-state.md` as you get it. `<skill>` below means this skill's directory.

## Known Orca sharp edges (read before wave 1)

Open issues as of Orca 1.4.220, checked 2026-10-05. When Orca updates, recheck them with `gh issue view <number> -R stablyai/orca`.

| Issue | What happens | What to do |
|---|---|---|
| [#21316](https://github.com/stablyai/orca/issues/21316): `new-child` ignores the parent | The child branches from the repo's default branch, not your feature branch, so a wave-2 worker starts without wave 1's code | Never start a coder with `--worktree new-child`. Create its worktree yourself and check the base before the agent starts (2a) |
| [#25131](https://github.com/stablyai/orca/issues/25131): a restart abandons Dispatches | After an Orca restart every live Dispatch reads `abandoned`, the coordinator loses its Run binding, and worker terminals come back as plain shells. The files survive | Rebind with `orca orchestration run-use --id <run id from run-state.md> --json`. Inspect each child worktree with git, then restart unfinished tasks with `--retry-of` on `--worktree path:<child path>`. A lost Dispatch is never a success |
| [#25257](https://github.com/stablyai/orca/issues/25257): DeepSeek harness readiness timeout | A dsh-tui worker times out at agent readiness, so its task is never delivered | Do not start DeepSeek as an Orca worker; run one-shot work through `dsh --profile headless` (`roster.md`). For any other readiness timeout, read the receipt's `failedStage` and follow Orca's recovery guide; never relaunch blindly |

**Also seen on 2026-10-06, no issue filed:**
- **`orca worktree rm` returns early.** It answers `removed: true` before the directory is gone, and it also deletes the merged branch. Poll `git worktree list` before you report the worktree removed.
- **Heartbeats arrive as interruptions** ("You have 1 orchestration message"). Acknowledge them by type: `check --types heartbeat --json`, then `check --ack <delivery id>`. A heartbeat is never a completion.
- **Waiters must be harness background tasks.** Run every `check --wait` that way. A waiter started with `&` inside a foreground command dies with that shell, and it may already have read a message you then never see.
- **A QA worker on `--worktree current` shares your git index.** Commit nothing while it runs.
- **Release after acceptance.** Release a settled worker right after you accept it, unless you reuse its terminal for an immediate follow-up. Retaining one needs the user's request.

## 0. Preflight

1. `orca status --json` shows the runtime ready.
2. You are in the feature worktree, on the feature branch, with a clean tree and the spec committed.
3. **Child worktrees contain only committed files.** The repo's Orca setup script must install dependencies and copy the gitignored files workers need, such as a dev-only `.env.local` or `.mcp.json`.
   - If the app has a local database or ports, the setup and archive scripts should also give each worktree its own database and port, as a companion env-isolation setup does. Without that, keep every database-backed command with you and QA.
   - Prove it once: create a throwaway child as in 2a, run the gates in it, then remove it.
4. **Bot on** (`team.md`): `git push -u origin <branch>`, then `gh pr create --base <base> --title "<feature>" --body "<summary; spec in specs/<feature>/>"`, then run `references/review-loop.md` on that push, so the bot reviews the spec too.
   **Bot off:** `git push -u origin <branch>` only. The user opens the PR at the end.
5. `orca orchestration run-create --objective "<feature>: <one line>" --json`, and record the Run id.
6. **Probe each agent you route to, from inside this repo.** For each agent, start a one-turn, read-only dispatch ("print your model id, then send worker_done"), and read `launch.effective` and its first output.
   - Repo config can override an agent's own. On one run, a committed `opencode.json` pinned opencode to a provider whose key was not set locally, and the critic died with `Unauthorized`.
   - The meters can be wrong too: an agent shown as "sign-in expired" worked.

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
- **Write each fix task for the coder you have.**
  - With a strong coder on the roster, give the goal, the failing scenario and the test to add.
  - With only weaker coders, write the exact patch and prove it first in an idle child: the patch passes, and breaking the fix makes the new test fail. Then accept the worker's commit by comparing it byte for byte with the proven patch.
- **P3:** list them in the PR body, or in the final report when the bot is off.
- **No convergence after two review rounds:** stop and ask the user.

The reviewer runs whether or not the GitHub bot is on. With the bot off, it is the only independent check.

### 2f. Push

Update `run-state.md` and commit it, then `git push`.
- **Bot on:** run `references/review-loop.md` until the bot's review of HEAD is clean.
- **Bot off:** the push only keeps the work safe.

Only then start the next wave.

### 2g. Master moved

Check before each wave's dispatch, before every push, and before a merge:

```text
git fetch origin <base>
git rev-list --count HEAD..origin/<base>          # behind count
git merge-tree --write-tree HEAD origin/<base>    # exits non-zero on a conflict
gh pr view --json mergeable,mergeStateStatus      # CONFLICTING runs no workflows at all
```

When master moved, merge it yourself before anything else. Run `git merge --no-ff --no-commit origin/<base>`, resolve, put the bookkeeping in the same commit, and rerun every gate:
- **Generated files** (migrations, snapshots, journals, lockfiles): take master's side and regenerate yours on top in a fix task. Never rename a migration: its snapshot would miss master's change, and the next generate re-adds it.
  - The regeneration task runs the generator.
  - It proves the new SQL is byte-identical to the old, the journal entry sorts after master's, the snapshot chains to master's, and a second generate reports no drift.
  - It moves any test that pins the last migration.
- **Test databases:** after a migration changes, recreate every one the run owns. Integration setups usually migrate in place and never drop, so the new file's `CREATE` fails on the old copy.
- **Feature code master changed** (a conflict in a file a task edited): take master's version, then dispatch a re-apply task with the exact edits on the new structure.
- **Append-only ledgers** (progress log, specs index, history): keep both sides' entries, in merge order. Another spec's placeholder rows for yours go when your real rows land.

Push only with the behind count at 0. Fetch again right before `git push`, and check again after it.

## 3. QA (after the last wave)

**Before you start QA:**
- Give QA its own database and port, migrated from the branch.
- Start the app once with QA's exact command, load the first page, and make one real call through each third-party key. Then stop it by its process group and remove what that smoke run wrote. A broken env would cost QA a whole round.
- Write the QA brief in `plan.md` from the template in `templates.md`, and commit it.

```text
orca orchestration worker-start --spec "<QA spec>" --task-title "qa" --worktree current --agent <qa> [--model <id> --effort <level>] --json
```

QA spec:

> Prove each acceptance criterion in `specs/<feature>/requirements.md` against the app running from this worktree. Follow `specs/<feature>/plan.md` → QA brief for the start command, test data, cases and house rules, and use `<browser tool, for example browser-harness>` for browser steps. For each criterion, write down the steps you took, the expected and actual results, and the evidence: command output, or a screenshot saved under `specs/<feature>/qa/`. Mark each criterion PASS or FAIL. Write `specs/<feature>/qa/report.md`, commit only files under `specs/<feature>/qa/`, stop the app, and send worker_done. Fix nothing you find.

The brief must cover what tripped QA on one run:
- **The browser is the user's own.**
  - Use one tab, never activate it, and never clear cookies or storage wholesale. Sign out between sign-ups instead.
  - The browser may be zoomed, so check `innerWidth` before measuring.
  - A hidden tab may need focus emulation, and the page needs a hydration wait.
  - Password-manager extensions draw over forms and swallow clicks. Hit-test with `elementFromPoint` before a click, and hide an overlay only with a style in that tab.
- **Time windows.** A case that depends on a rate limit or a minute window starts at a fresh wall-clock minute. Exhaust the browser's own bucket from inside the page, because curl and the browser can count in different buckets.

**While QA runs:**
- On `--worktree current` it shares your git index, so commit nothing.
- Its `worker_done` is a claim. Before you accept it, re-read the database rows it cites, open its screenshots, and check that the port is free.

A FAIL leads to a fix task, accepted as in 2c, merged and gated. Then start a fresh, short QA re-check task that names exactly the cases to re-measure, and push. With the bot on, the push also goes through the bot loop.

## 4. Close

- `orca orchestration worker-list --run <run id> --terminal-state reclaimable --json` returns nothing.
- Remove a child worktree with `orca worktree rm` only when `git branch --merged` shows its branch merged into the pushed feature branch. If in doubt, leave it and list it in the report. The removal finishes after the command returns, so poll `git worktree list`.
- Remove every container the run started, and record it in `run-state.md`.
- Report as `SKILL.md` step 6 describes. With the bot off, end by telling the user the branch is ready for them to open the PR.

## 5. Follow-ups after the close

Small changes the user asks for after the run (for example "carry on" with a listed follow-up) are not a new run: do them yourself.
- Write the test first and watch it fail.
- Make the change and run the gates.
- Have a code-review agent read the diff. On one run it caught a real accessibility bug in a three-line change.
- Push, then run the bot loop.

Pushing to the open PR resets its approval, so tell the user before they merge. Before you drop a follow-up you listed, say why. One looked like a fix but would have broken parity with the library the route mirrors.

## 6. Ship (only when the user hands you the merge)

Merge only on an explicit instruction such as "merge it". Otherwise the merge stays with the human.
1. **Secrets the deploy needs.** Copy each from its local file to the host's environment through stdin, never in argv or output. Verify by comparing hashes of both sides. Set it runtime-only unless the build reads it.
2. **Sign-offs.** Record the user's sign-offs in a final docs commit. Push, and wait for APPROVE on that head with every check green.
   - A flaky red check that is not yours gets `gh run rerun <id> --failed`, which keeps the approval.
   - Never merge on red.
3. **Merge.** Fetch master right before merging; the behind count must be 0. Then `gh pr merge <n> --merge --match-head-commit <approved sha>`.
4. **Watch the deploy** workflow to the end. Then check health, the migration ledger on the target database (read-only), and one live call that proves the feature and its secret work. Report what that call wrote.
