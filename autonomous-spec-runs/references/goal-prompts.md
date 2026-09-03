# Goal prompt templates

Substitute `<spec>`, `<wave>`, `<branch>`. Paste as a single `/goal` message. These are deliberately explicit: the goal is the only instruction that survives into a fresh context, so it repeats the loop rather than assuming it.

## One wave

```
Read AGENTS.md, then specs/README.md, then specs/<spec>/README.md.
Complete every task in Wave <wave> of specs/<spec> that is not yet marked complete, in order, one commit per task on branch <branch>, following the work loop in AGENTS.md exactly.
For each task: touch only its listed files, run its Verification section, set its Status to complete, tick it in the README, append a row to progress_log.md, and push the branch.
The goal is met when every Wave <wave> task is complete and `pnpm typecheck && pnpm lint && pnpm test` passes on the branch with a clean working tree.
If any stop condition in AGENTS.md applies, write specs/<spec>/BLOCKED.md and stop; do not work around it. A blocked task with a clear note is an acceptable end state.
```

## One whole spec, waves in order

Same as above with the second line replaced:

```
Complete every unfinished task in specs/<spec>, waves in ascending order and tasks in order within each wave, one commit per task on branch <branch>.
After each wave completes, before starting the next: run @reviewer against this branch and spec, then fix any confirmed finding as an additional commit.
```

## Continuous run across several specs

The version that runs for days. Note the three things it must be told explicitly: how to advance between specs, that review is now its job, and that pushing master is not.

```
Work through the specs continuously, in this order: <spec-1>, <spec-2>, <spec-3>. Stop after <spec-3>.
Read AGENTS.md first and follow its work loop exactly for every task.
Per spec: if the branch overhaul/<spec> does not exist, create it from master; run its waves in ascending order and its tasks in order within a wave; touch only each task's listed files; run each task's Verification section; one commit per task containing code, Status complete, the README tick and the progress_log.md row; push the branch after every task.
After each wave completes, before starting the next: run @reviewer against that branch and spec, then fix any confirmed finding as an additional commit on the same branch. Do not skip this; it is the only review in the loop.
After a spec's final wave and its review: git switch master, git merge --ff-only overhaul/<spec>, then git switch to the next spec's new branch created from master. Never push master; the founder owns that. Push feature branches only.
Skip everything in each spec's action-required.md; those are human-only and are not blockers for the code tasks.
The run is met when the last spec's final wave is complete and reviewed and `pnpm typecheck && pnpm lint && pnpm test` passes.
If any stop condition in AGENTS.md applies, write specs/<spec>/BLOCKED.md and stop the whole run; do not work around it and do not move to the next spec.
```

## Notes on wording that mattered

- **"in order"** twice, for waves and for tasks within a wave. Without both it interleaves.
- **"touch only its listed files"** even though a hook enforces it. The model behaves better when the rule is stated, and the hook is the backstop rather than the teacher.
- **Name the completion command literally.** "The goal is met when X passes" gives the harness's completion checker something to run. Vague goals like "make the app better" never terminate.
- **"A blocked note is an acceptable end state."** Without this the model treats blocking as failure and tries to route around stop conditions.
- **"Never push master; the founder owns that."** State the ownership, not just the prohibition. It stops the model looking for an equivalent path.
- **Skip `action-required.md` explicitly.** Otherwise it reads the human-only runbook as work it should attempt, or as a blocker for the code tasks.
