// What GitHub says about a wave's pull request, reduced to the facts waveOutcome needs. Pure, so the tests
// can feed it GitHub's answers directly; the runner fetches them with gh. The repository and the reviewer bot
// ({ login, name, trigger }) are agentkit.config.json's, passed in by the runner.
import { isReviewer } from "../../guardrails/lib/merge.mjs";

// Other bots' comments (CI, coverage) are nobody's answer to a review.
const isBot = (login) => /\[bot\]$/.test(String(login ?? ""));

const time = (value) => Date.parse(value ?? "");
// A comment asks for a review when one of its lines is just the reviewer's trigger (/review, say). What else it says
// is an answer.
const escape = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const triggerLine = (trigger) => new RegExp(`^\\s*${escape(trigger)}\\s*$`, "gm");
const asksForReview = (body, trigger) => new RegExp(triggerLine(trigger).source, "m").test(String(body ?? ""));
const answerText = (body, trigger) => String(body ?? "").replace(triggerLine(trigger), "").trim();

/**
 * The reviewer bot's latest review of a PR: { state, onHead, pending, answered, rounds, waitedMs }.
 * `reviews`: [{ login, state, commit, at }]; `comments`: the PR's conversation and its review threads' replies,
 * [{ login, body, at }]; `reviewer`: { login, trigger }. A dismissed latest review counts as the bot's latest, as
 * merge-approved.mjs reads it.
 * - pending: no review yet, or a trigger (/review, say) came after the latest one;
 * - answered: someone other than the bot wrote more than the trigger after the latest review;
 * - waitedMs: how long the pending review has been waited for.
 */
export function reviewFacts({ head, createdAt, reviews, comments, now, reviewer }) {
  const bot = (login) => isReviewer(login, reviewer.login);
  // merge-approved.mjs refuses a PR when a review of the bot's has no time, so the runner can't call it done either.
  const unreadable = reviews.some((review) => bot(review.login) && Number.isNaN(time(review.at)));
  const mine = reviews.filter((review) => bot(review.login) && !Number.isNaN(time(review.at))).sort((a, b) => time(a.at) - time(b.at));
  const latest = mine.at(-1) ?? null;
  const people = comments.filter((comment) => !bot(comment.login) && !isBot(comment.login) && !Number.isNaN(time(comment.at)));
  const asks = people.filter((comment) => asksForReview(comment.body, reviewer.trigger)).map((comment) => time(comment.at));
  const lastAsk = asks.length > 0 ? Math.max(...asks) : null;
  const latestAt = latest ? time(latest.at) : null;
  const pending = latest === null || (lastAsk !== null && lastAsk > latestAt);
  const waitingSince = Math.max(lastAsk ?? 0, time(createdAt) || 0);
  return {
    state: latest?.state ?? null,
    onHead: latest !== null && latest.commit === head,
    pending,
    answered: latest !== null && people.some((comment) => time(comment.at) > latestAt && answerText(comment.body, reviewer.trigger) !== ""),
    rounds: mine.length,
    unreadable,
    waitedMs: pending ? Math.max(0, now - waitingSince) : 0,
  };
}

/**
 * CI on the head, from gh's statusCheckRollup: pass, fail, pending, or none when nothing has started. Read as
 * merge-approved.mjs reads it (lib/merge.mjs): the required jobs must be there and succeed, since a skipped one
 * proves nothing, so a wave the runner calls done is one the lead can merge. `required` is what
 * requiredChecks() in lib/ci.mjs returns, as merge-approved.mjs uses it: [] before the default branch has CI.
 */
export function ciState(checks, required) {
  if (!Array.isArray(checks) || checks.length === 0) return "none";
  const isStatus = (check) => check.__typename === "StatusContext";
  const done = (check) => (isStatus(check) ? !["PENDING", "EXPECTED"].includes(check.state) : check.status === "COMPLETED");
  const outcome = (check) => (isStatus(check) ? check.state : check.conclusion);
  if (checks.some((check) => done(check) && !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(outcome(check)))) return "fail";
  if (!checks.every(done)) return "pending";
  const runs = required.map(({ workflow, job }) => checks.find((check) => check.name === job && check.workflowName === workflow));
  if (runs.some((run) => run === undefined)) return "pending";
  return runs.every((run) => outcome(run) === "SUCCESS") ? "pass" : "fail";
}

// gh's --jq filters: GitHub's API answers reduced to what reviewFacts reads.
export const REVIEWS_JQ = "[.[] | {login: .user.login, state, commit: .commit_id, at: .submitted_at}]";
export const COMMENTS_JQ = "[.[] | {login: .user.login, body, at: .created_at}]";

/**
 * gh's printed JSON, or null when it printed nothing. A `--jq` filter with no result prints a bare newline, as
 * `.[0]` does for a branch with no pull request, so blank output is trimmed first rather than parsed.
 */
export function parseGhJson(stdout) {
  const text = String(stdout ?? "").trim();
  return text === "" ? null : JSON.parse(text);
}

/** The fields read from `gh pr list --json`, checked against the installed gh in test/flags.test.mjs. */
export const PR_FIELDS = Object.freeze(["number", "headRefOid", "createdAt", "statusCheckRollup", "mergeable"]);

/**
 * The wave's pull request as waveOutcome needs it: { pr, review, ci }. `gh(args)` runs gh and returns its
 * parsed JSON, so the tests can answer for GitHub. The reviews, the conversation and the review threads'
 * replies feed reviewFacts; `required` is merge-approved.mjs's list of required jobs, for ciState. `repo` is
 * owner/name and `reviewer` the bot, both from agentkit.config.json.
 */
export function pullRequestFacts({ branch, required, gh, repo, reviewer, now = Date.now() }) {
  const pr = gh(["pr", "list", "--repo", repo, "--head", branch, "--state", "open", "--json", PR_FIELDS.join(","), "--jq", ".[0]"]);
  if (!pr) return { pr: null, review: null, ci: "none" };
  const reviews = gh(["api", `repos/${repo}/pulls/${pr.number}/reviews?per_page=100`, "--jq", REVIEWS_JQ]) ?? [];
  // The conversation and the replies in review threads: AGENTS.md lets a builder answer in either.
  const conversation = gh(["api", `repos/${repo}/issues/${pr.number}/comments?per_page=100`, "--jq", COMMENTS_JQ]) ?? [];
  const threads = gh(["api", `repos/${repo}/pulls/${pr.number}/comments?per_page=100`, "--jq", COMMENTS_JQ]) ?? [];
  const review = reviewFacts({ head: pr.headRefOid, createdAt: pr.createdAt, reviews, comments: [...conversation, ...threads], now, reviewer });
  return { pr: { number: pr.number, conflicting: pr.mergeable === "CONFLICTING" }, review, ci: ciState(pr.statusCheckRollup, required) };
}
