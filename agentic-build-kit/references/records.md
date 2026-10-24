# Records

Every fact an agent needs to resume lives in the repository: decisions, progress, blockers, the ledger. A new session, another model or another harness picks up from the files, not from anyone's memory of a chat. `init.mjs` installs the skeletons; this is how to keep them.

## The files

| File | What it holds | Who updates it, and when |
|---|---|---|
| `docs/README.md` | The map of the records and their rules | When a records folder is added |
| `docs/STATUS.md` | Current milestone, what's in flight, Blockers (with the date they started and who can clear them), Waiting on the owner, next steps, what's live | The lead, whenever something starts, finishes, gets blocked or unblocked |
| `docs/log.md` | Dated progress log, newest first, one entry per working session | The lead, at the end of every session; when a wave merges |
| `docs/decisions/NNNN-slug.md` | One record per significant decision: context, decision, alternatives rejected, consequences | Whoever makes or reverses the decision |
| `specs/LEDGER.md` | One row per completed task: task id, summary, date, agent and model | The builder, in the task's own commit |
| `specs/NN-name/BLOCKED.md` | Why a spec stopped: what, the exact failure, what was tried, what would unblock it | The agent that stopped |

`init.mjs` also writes `docs/decisions/0001-adopt-the-agentic-build-kit.md`, recording the adoption itself: what the kit enforces, who merges and deploys, and what stays with the owner. Read and adjust it; it's the first thing a reviewer asks about.

## Rules

- **Decisions are append-only.** To change one, write a new record that supersedes it, and mark the old one `Superseded by NNNN` in its Status line. Never edit what a record decided; the history is the point. The source project's review history (0018 → dropped in 0024 → back for specs in 0029) is readable only because nothing was rewritten.
- **Copy `docs/decisions/0000-template.md`** and use the next free number. Its fields: Status (Proposed, Accepted, Superseded by NNNN), Date, Deciders (and under whose authority, when an agent decides under a pre-approval), Context, Decision, Alternatives considered (each with why it was rejected), Consequences (what it makes easier, what it makes harder, what would make us revisit it).
- **Proposed stays Proposed** until the person it names decides. An agent may build what a proposed decision enables, as evidence, but the record says so and doesn't change an approved document on the strength of it.
- **Quote the owner** when a record rests on their words, verbatim, typos included, with the date and where it was said. A pre-approval's limits are only as clear as its quote.
- **Absolute dates** (2026-10-21), never "yesterday" or "next week". Records are read weeks later, by agents with no idea when "today" was.
- **Never put secrets in records.** Name the environment variable or the secret store's key instead. Account and project ids that aren't secrets may go in STATUS; keys never do.
- **Blockers go in STATUS** with the date they started and who or what can clear them. A rollback or a failed deploy is a blocker until its cause is fixed, and the deploy isn't run again until then.

## The ledger

```
# Task ledger

One row per completed spec task, appended in the same commit as the task. Find a task's commit with
`git log --grep="(task-MM)"` scoped to its spec.

| Task | Summary | Date | Agent / model |
|---|---|---|---|
| spec-02 task-04 | Auth core: ID tokens, access and refresh tokens, invites | 2026-10-23 | OpenCode / GLM-5.3 |
```

- The row goes in the task's one commit, so a task and its record never drift apart.
- The date, not the hash: recording the hash needs an amend, an amend of a pushed commit needs a force push, and force pushes are forbidden. `git log --grep` finds the hash.
- The agent and model column is how you learn which models do which work well; the build plan's role table is written from it.
- A summary may be long when the task did something the lead should know (what the code didn't have that the task assumed, what was left for the lead). The ledger is the wave's record; the builder doesn't touch the log or STATUS.

## Who touches what in a wave run

- **The builder** writes only its tasks' listed files plus the loop's bookkeeping: each task's Status, its box in the spec README, its ledger row, `BLOCKED.md` and `specs/.current-task`. It doesn't edit `docs/log.md` or `docs/STATUS.md` unless a task lists them, and then only as the task specifies. It doesn't file issues; it lists deferred review notes in its last message.
- **The lead,** when the wave merges: a log entry (the PR, the builder and its cost, what was deferred and where, the deploy's result), STATUS (what's in flight, what's live, blockers), and the follow-up issues for deferred notes. Fold small notes into the next wave's lead commit instead of a new push to an approved PR ([review-loops.md](review-loops.md#after-an-approval-push-only-what-cant-wait)).

## Outside the spec loop

Work that isn't a spec task (a hotfix, a record, a tooling change) still ends with STATUS, a log entry, and a decision record when it made or reversed a significant decision. Clear `specs/.current-task` first: while a task is active, even an interactive session can't end until that task is complete or blocked.

## Skeletons

The installed `docs/STATUS.md` and `docs/log.md` are skeletons dated the day of adoption. Fill them in as work starts, and don't let template text linger as if it were status: an agent reads STATUS as the truth.
