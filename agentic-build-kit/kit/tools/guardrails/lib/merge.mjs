// Decides whether a pull request may merge (AGENTS.md, Pull requests): the reviewer bot's latest review must approve
// the PR's current head commit, every CI check on that commit must have passed, and GitHub must see the PR as open and
// mergeable. `reviewer` is agentkit.config.json's reviewer: { login, name, trigger }.
const short = (sha) => String(sha ?? "").slice(0, 7);

/** Whether `login` is the reviewer bot `reviewerLogin`, with or without GitHub's [bot] suffix. */
export function isReviewer(login, reviewerLogin) {
  if (typeof login !== "string" || typeof reviewerLogin !== "string") return false;
  return login.replace(/\[bot\]$/, "") === reviewerLogin.replace(/\[bot\]$/, "");
}

function stateBlocker(pr) {
  if (pr.state !== "OPEN") return `PR #${pr.number} is ${String(pr.state).toLowerCase()}, not open.`;
  if (pr.isDraft) return `PR #${pr.number} is a draft.`;
  if (!pr.headRefOid) return `GitHub didn't return PR #${pr.number}'s head commit. Try again in a minute.`;
  return null;
}

// Compared as times, not strings: timestamps can differ in precision (…:00Z, …:00.5Z).
const time = (review) => Date.parse(review.at);

function latestReviewBlocker(pr, reviews, reviewer) {
  const mine = reviews.filter((review) => isReviewer(review.login, reviewer.login));
  if (mine.length === 0) return `${reviewer.login} hasn't reviewed PR #${pr.number} yet. Comment ${reviewer.trigger} and wait for its review.`;
  if (mine.some((review) => Number.isNaN(time(review)))) {
    return `A ${reviewer.login} review of PR #${pr.number} has no submission time, so its latest review isn't known. Check the reviews on GitHub.`;
  }
  return reviewBlocker(pr, [...mine].sort((a, b) => time(a) - time(b)).at(-1), reviewer);
}

function reviewBlocker(pr, review, reviewer) {
  if (review.state !== "APPROVED") return `${reviewer.login}'s latest review is ${review.state}. Act on it, push, and comment ${reviewer.trigger}.`;
  if (review.commit !== pr.headRefOid) {
    return `${reviewer.login} approved ${short(review.commit)}, but the head is now ${short(pr.headRefOid)}. Comment ${reviewer.trigger} for a review of the new head.`;
  }
  return null;
}

// GitHub's checks on the PR's head (gh pr view --json statusCheckRollup). A check run has a name, its
// workflow's name, a status and a conclusion; a commit status has a context and a state. Anything else,
// CANCELLED, TIMED_OUT and STALE included, counts as failed.
const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const checkName = (check) => check.name ?? check.context ?? "unnamed check";
const isDone = (check) => (check.__typename === "StatusContext" ? check.state !== "PENDING" && check.state !== "EXPECTED" : check.status === "COMPLETED");
const outcome = (check) => (check.__typename === "StatusContext" ? check.state : check.conclusion);
const label = ({ workflow, job }) => `${workflow} / ${job}`;
const runOf = (checks, { workflow, job }) => checks.find((check) => check.name === job && check.workflowName === workflow);

/**
 * Blocks until every check on the head has passed. The required jobs (lib/ci.mjs) must be among them and
 * must have succeeded: a skipped or neutral required job proves nothing.
 */
function checksBlocker(pr, reviewer) {
  const checks = pr.statusCheckRollup ?? [];
  const required = pr.requiredChecks ?? [];
  const missing = required.filter((entry) => !runOf(checks, entry)).map(label);
  if (missing.length > 0) return `PR #${pr.number} has no ${missing.join(" or ")} check yet. Wait for CI to start on the head, then try again.`;
  const running = checks.filter((check) => !isDone(check)).map(checkName);
  if (running.length > 0) return `CI is still running on PR #${pr.number} (${running.join(", ")}). Try again in a few minutes.`;
  const failed = checks.filter((check) => !PASSED.has(outcome(check))).map(checkName);
  if (failed.length > 0) return `CI failed on PR #${pr.number} (${failed.join(", ")}). Fix it, push, and comment ${reviewer.trigger}.`;
  const unproven = required.filter((entry) => outcome(runOf(checks, entry)) !== "SUCCESS").map(label);
  if (unproven.length > 0) return `CI didn't run ${unproven.join(" and ")} to success on PR #${pr.number}; it was skipped. Push again so it runs.`;
  return null;
}

function mergeableBlocker(pr) {
  if (pr.mergeable === "MERGEABLE") return null;
  if (pr.mergeable === "CONFLICTING") return `PR #${pr.number} has conflicts with its base (${pr.mergeable}). Resolve them on the branch first.`;
  return `GitHub is still checking whether PR #${pr.number} merges cleanly (mergeable: ${String(pr.mergeable)}). Try again in a minute.`;
}

/** Why the pull request can't merge yet, or null when it can. */
export function mergeBlocker(pr, reviews, reviewer) {
  if (!reviewer?.login) return "agentkit.config.json names no reviewer bot (reviewer.login), so no approval can count.";
  return stateBlocker(pr) ?? latestReviewBlocker(pr, reviews, reviewer) ?? checksBlocker(pr, reviewer) ?? mergeableBlocker(pr);
}
