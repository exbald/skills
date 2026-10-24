# Review loops

Two reviews gate the work, by two different model families from the writer and the builders:

- **The reviewer bot** (`agentkit.config.json`'s `reviewer`) reviews every pull request: specs, waves, decision records, fixes. Its approval of the head is what `merge-approved.mjs` checks.
- **An adversarial review** (Codex, in the worked example) runs on every spec before it merges: read-only, asked to break the spec rather than approve it.

They catch different things. A bot reviewing a diff sees what's in front of it; nine rounds of it on the source project's spec 02 missed most of what one adversarial read later found: crash windows, races, and code that couldn't be built in its task's wave (decision 0018, 2026-10-22). A spec's mistakes multiply, because every builder copies them.

## The reviewer bot loop

The loop, as `AGENTS.md` has it:

1. **Act on every comment.** Fix it in a new commit, or reply in its thread with why it doesn't apply.
2. **Notes in an approving review count.** An approval often lists notes in its body. Answer each one, in one comment, even when there's nothing to change. In the pilots (2026-10-22), GLM stopped after the approval without answering its notes; the runner now treats an unanswered approval as work left.
3. **Check a finding before acting on it.** Reproduce it or read the code it names. If it's wrong, reply with the evidence instead of changing working code. Writing the source project's spec 12 took ten rounds, and two of its "must fix" findings were wrong.
4. **A COMMENT verdict isn't an approval.** Answer it, then ask again.
5. **Push the fixes, then comment the trigger** (`reviewer.trigger`, `/review` by default; `/muse` in the worked example). The bot reviews the latest commit within minutes.
6. **Keep asking until it approves.** No per-push or round limit (the owner, 2026-10-23: "we request until the pr approved!"), within the narrow-rounds rule below.

### One trigger per push

Two triggers on one push produced two reviews of the same commit that disagreed (#37, 2026-10-22). Ask once per push, after the push has landed.

### Reply after the push, never with it

Post a reply or the trigger only in a separate step after confirming the fix commit exists and is pushed (`git log -1`, `git status -sb`):

- On 2026-10-24 (#112) an edit script failed an assertion and nothing was committed, but `…; gh pr comment …` in the same chain still posted "fixed in the latest commit" with the trigger, which bought a review of an unchanged head and a correction comment.
- In a parallel batch, the reply runs at the same time as the commit and has to invent the sha: on #138 it named a sha that didn't exist.
- The same goes for issue numbers: name an issue only after `gh issue create` has printed it. A reply on #137 named "#138" from a guess; a builder's pull request had taken 138.

The order: edit, check, commit and push, chained with `&&`; then, in a new command, the reply naming the pushed sha.

### Later rounds stay narrow

From the fourth review on, change code only for correctness, security and data bugs. Reply to everything else and put it in a follow-up issue (in a wave run, the builder lists it as deferred and the lead files it). Each change is new code for the next review, so a loop that keeps taking suggestions never ends: #37's last five rounds changed little a builder would have hit (decision 0024). In a wave run, a pull request with five reviews and no approval goes to the lead (exit 3), who carries it on.

### After an approval, push only what can't wait

A push after an approval gets a full fresh review, and that review can come back CHANGES_REQUESTED: on 2026-10-24, fixing two approval notes on #142 (review 16) led to review 17 requesting changes. So after an approval:

- answer the notes in a comment;
- push only what can't wait, such as a decision record's text, which is frozen once merged;
- merge, and fold the other notes into the next wave's lead commit or a follow-up issue.

### Every push costs CI minutes

Every push re-runs CI (in the source project, `verify` about 6.5 minutes plus the image job), and superseded runs burn minutes until they're cancelled. On 2026-10-23, about 20 review-round pushes to one PR in two hours were followed, from about 16:55 UTC, by GitHub refusing every Actions job ("recent account payments have failed or your spending limit needs to be increased"). Nothing could merge, since `merge-approved.mjs` needs CI to pass, and only the owner could fix the billing. So:

- batch a round's fixes into one push;
- when a review is of an older head, check whether the current head already covers it before touching anything;
- from the fourth review on, push only for correctness, security or data bugs;
- the workflow's `concurrency` group with `cancel-in-progress: true` cancels superseded runs; keep it.

## Merging: what merge-approved.mjs checks

`node tools/guardrails/merge-approved.mjs <number>` merges only when:

- the latest review from `reviewer.login` (with or without GitHub's `[bot]` suffix) approves the PR's current head commit. Reviews are ordered by time, not by string, since timestamps differ in precision; a review with no time blocks, because the latest can't be known;
- every check on the head passed or was skipped, and the required jobs (`ci.requiredJobs`, once the default branch has `ci.workflowFile`) are among them and **succeeded**: a skipped required job proves nothing;
- GitHub sees the PR open, not a draft, and mergeable.

It makes a merge commit and passes the approved commit (`--match-head-commit`), so a push between the check and the merge fails the merge instead of landing unreviewed code. The guard denies every other way to merge (`gh pr merge`, REST and GraphQL merges, aliases).

**It doesn't check comment threads.** The worked example's bot files review-level comments and approves only once it's satisfied, and `AGENTS.md` asks agents to answer every comment before asking again, so the approval stands for "every comment has an answer". That depends on how the bot behaves. A bot that approves with open threads, or leaves inline comments it doesn't track, needs a real check (see [adapting.md](adapting.md#another-reviewer-bot)).

When the PR is approved, answered and green, the agent merges it without waiting for the owner (the source project's decision 0015, 2026-10-21: "you are an autonomous agent"). A builder in a wave run stops at the approval; the lead audits and merges ([work-loop-and-gates.md](work-loop-and-gates.md#the-leads-audit-before-a-merge)).

## The adversarial spec review

History, so the rule's weight is clear:

- **0018 (2026-10-22, morning):** the owner asked for a Codex adversarial review after every spec, because Muse's rounds missed whole classes of problems.
- **0024 (2026-10-23):** after the builder pilots, the owner dropped it ("too much"): coding agents build, the bot reviews.
- **0029 (2026-10-23, evening):** brought back for every spec, not for builds: "Once all the specs are written launch codex adversarial review for each specs and fix what was highlited and needs fixing."

How to run it:

- After the spec is written, on its branch, run the reviewer **read-only** (in the worked example, the `codex` CLI). Ask it to break the spec, not to approve it: crash windows, races, a task that can't be built in its wave, a verification that fails on success, a contract that doesn't match the code.
- Use **a different model family** from the writer: a review by the writer's own model shares its blind spots.
- Fix the findings that are real, in the spec's PR (or a follow-up right after the merge), and record them in the commits and `docs/log.md`. When the fixes are substantial, review again, until a round is clean or only has findings answered on the record.
- **Never read the reviewer's credentials** (`~/.codex/auth.json`). The guard doesn't cover them; the rule does.
- Then the bot loop runs as usual. The adversarial review adds to the bot; it doesn't replace it.

Builds don't get one: the wave's tasks were already reviewed as a spec, and the bot reviews the code.

## When Codex is the PR reviewer bot

Where Codex (the `chatgpt-codex-connector` GitHub app) reviews PRs itself, the convention from `~/.claude/rules/codex-review.md`:

- **For every Codex comment addressed:** push the fix, then reply in the thread starting with `✅ Addressed in <sha> — …`; add a 👍 reaction to the **original Codex comment** (not the reply): `gh api -X POST repos/<owner>/<repo>/pulls/comments/<id>/reactions -f content='+1'`; resolve the thread.
- A Codex comment without a 👍 is not yet addressed. That's the at-a-glance state; never skip the reaction.
- **Re-review loop before merge:** comment `@codex review` (unless already requested), wait for its follow-up (typically 2–5 minutes), and treat it as good to go only when it comes back clean, with no new P-badge comments. New findings: address them and repeat. Never call a PR merge-ready while a Codex round is pending or a comment lacks its 👍.

With Codex as the configured bot, `reviewer.login` is its login and `reviewer.trigger` is `@codex review`. The rule describes its clean result as "a thumbs-up / no-new-findings response", not an APPROVED review; if that's how it answers, `merge-approved.mjs`'s approval check doesn't fit it as is: see [adapting.md](adapting.md#another-reviewer-bot).
