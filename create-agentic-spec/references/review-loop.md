# GitHub bot review loop

Run this after every push. It is done when the bot's review of the exact HEAD you pushed is clean, and every finding it raised has been fixed or answered. `gh api` fills in `{owner}` and `{repo}` from the current repository.

## Identify the bot (once per run; record it in team.md)

- **Verdict bot.** A workflow in `.github/workflows/` that runs on every push to the PR and posts a comment starting `## Verdict:` (APPROVE, REQUEST_CHANGES or COMMENT). Some repos also file the verdict as a formal review from `github-actions[bot]`. Find it with `grep -l "Verdict:" .github/workflows/*.yml`.
- **Codex connector.** Reviews come from `chatgpt-codex-connector[bot]`, findings arrive as inline comments with P0/P1/P2 badges, and a `@codex review` comment requests a re-review. Check recent PRs:
  `gh api "repos/{owner}/{repo}/pulls?state=all&per_page=5" --jq '.[].number' | while read n; do gh api "repos/{owner}/{repo}/pulls/$n/reviews" --jq '.[].user.login'; done | sort | uniq -c`
- **Neither.** Tell the user the run has no external review. The internal reviewer is then the last check.

## Wait for the review of HEAD

```text
HEAD=$(git rev-parse HEAD)
N=$(gh pr view --json number -q .number)
```

**Verdict bot:**

```text
gh run list --commit "$HEAD" --json name,status,conclusion
gh api "repos/{owner}/{repo}/pulls/$N/reviews" --jq "[.[] | select(.user.login==\"github-actions[bot]\" and .commit_id==\"$HEAD\")] | last | {state, body}"
gh api --paginate "repos/{owner}/{repo}/issues/$N/comments" --jq "[.[] | select(.user.login==\"github-actions[bot]\" and (.body | startswith(\"## Verdict:\")))] | last | {created_at, body}"
```

Wait until the review workflow for `$HEAD` has completed. Then take its verdict: the formal review whose `commit_id` is `$HEAD`, or, in a repo that files no formal review, the newest `## Verdict:` comment created after that run started.

**Codex connector:** request a review with `gh pr comment "$N" --body "@codex review"`, unless it already reviewed this push on its own. Then poll:

```text
gh api "repos/{owner}/{repo}/pulls/$N/reviews" --jq "[.[] | select(.user.login==\"chatgpt-codex-connector[bot]\" and .commit_id==\"$HEAD\")] | last | {id, state, body}"
gh api --paginate "repos/{owner}/{repo}/pulls/$N/comments" --jq ".[] | select(.user.login==\"chatgpt-codex-connector[bot]\" and .commit_id==\"$HEAD\") | {id, path, line, body}"
```

Poll about once a minute.
- **No review after 20 minutes:** request one more time (Codex), or read the workflow run's log (verdict bot).
- **After 40 minutes, or on a usage-limit message:** stop and ask the user. For Codex, the choice is to wait for the reset or to spend a reset credit.
- **Without a review of HEAD, the push is not clean.**

## Clean means

- **Verdict bot:** the verdict on HEAD is APPROVE.
- **Codex:** its review of HEAD adds no new P-badge comment (it says it found no major issues, or reacts with 👍), and every earlier Codex comment carries your 👍.

## A fix round

1. **Fix the findings.** Turn the actionable findings into fix tasks for the coder role, grouped so no two fix tasks share a file. Accept each as in `run-loop.md` 2c, merge, rerun the gates, and push once for the whole round.
2. **Codex: close each addressed comment.** After the push:
   - Reply in the thread: `gh api -X POST "repos/{owner}/{repo}/pulls/$N/comments/<id>/replies" -f body="✅ Addressed in <sha> — <what changed>"`
   - React 👍 on the original Codex comment, not on your reply: `gh api -X POST "repos/{owner}/{repo}/pulls/comments/<id>/reactions" -f content='+1'`
   - Resolve the thread:
     ```text
     gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{databaseId}}}}}}}' -f o=<owner> -f r=<repo> -F n=$N
     gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<thread id>
     ```
   - Then comment `@codex review` and wait again.
3. **Verdict bot: let it re-review.** The push triggers a fresh review. Post one PR comment listing each fix and its commit, then wait for the verdict on the new HEAD.
4. **A finding you believe is wrong:** reply with the evidence (file:line, a test), leave it without 👍 and unresolved, and list it for the user. Never drop a finding silently.
5. **Four rounds without a clean review of HEAD:** stop and report the open findings to the user.

## Never

- Count a review of an older commit.
- Push empty commits, or re-request again and again, to shake a review loose.
- Merge the PR or mark it ready to merge yourself.
