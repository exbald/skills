// A wave's build: which tasks it holds, where its checkout lives, and where it stands once its builder stops. The
// runner gathers the facts; these functions only decide, so the tests can cover every case without git, GitHub or a
// model. The reviewer bot ({ name, trigger }) and the default branch come from agentkit.config.json, through the runner.
import { basename, dirname, join } from "node:path";
import { isTestFile } from "../../guardrails/lib/paths.mjs";
import { isListed } from "../../guardrails/lib/task.mjs";
import { readSpec } from "../../spec-check/lib/spec.mjs";

/** How many times the runner sends a stopped builder back to work before it hands the wave to the lead. */
export const MAX_NUDGES = 3;
/** Reviews past this many without an approval go to the lead (AGENTS.md, Pull requests). */
export const MAX_REVIEW_ROUNDS = 5;
/** How long a review may stay pending before the builder is told to ask again. */
export const REVIEW_WAIT_MS = 30 * 60_000;

/** The wave's tasks, in order, as `root`'s copy of the spec has them, with their file lists. */
export function waveTasks(root, specDir, wave) {
  return readSpec(root, specDir)
    .tasks.filter((task) => task.wave === wave)
    .map(({ id, file, status, modify, create }) => ({ id, file, status, entries: [...modify, ...create] }));
}

/**
 * The files a branch changed that no task of the wave lists, read the way the guard reads the lists. The
 * guard holds a builder to one task's lists only while that task is marked active, so the runner checks the
 * whole branch once more before the wave counts as done.
 */
export function outsideLists(specDir, tasks, changed) {
  const entries = tasks.flatMap((task) => task.entries);
  const always = new Set([...tasks.map((task) => task.file), `${specDir}/README.md`, `${specDir}/BLOCKED.md`, "specs/LEDGER.md"]);
  return changed.filter((rel) => !always.has(rel) && !isListed(rel, entries, !isTestFile(rel)));
}

/** A spec folder's number: "02" for specs/02-app-api. */
export function specNumber(specDir) {
  const number = /(?:^|\/)(\d{2})-[a-z0-9-]+\/?$/.exec(specDir)?.[1];
  if (!number) throw new Error(`${specDir} isn't a spec folder (specs/NN-name).`);
  return number;
}

/** The wave's branch: build/spec-02-wave-01. */
export function waveBranch(specDir, wave) {
  const number = specNumber(specDir);
  if (!Number.isInteger(wave) || wave < 1) throw new Error(`Wave ${wave} isn't a wave number.`);
  return `build/spec-${number}-wave-${String(wave).padStart(2, "0")}`;
}

/** The paths in `git status --porcelain=v1 -z` output: changed, staged, untracked and both ends of a rename. */
export function porcelainPaths(output) {
  const fields = String(output).split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index].slice(0, 2);
    paths.push(fields[index].slice(3));
    // A rename or copy is followed by its source path, in a field of its own.
    if (/[RC]/.test(status)) paths.push(fields[++index]);
  }
  return [...new Set(paths.filter(Boolean))];
}

/**
 * The build's own checkout, in a folder beside the repository. Never inside it: a checkout under the repository
 * puts a second copy of every config file in the tools' way (a second biome.json made Biome's lint fail there).
 */
export function worktreePath(root, branch) {
  return join(dirname(root), `${basename(root)}-builds`, branch.replaceAll("/", "-"));
}

const nudge = (reason) => ({ kind: "nudge", reason });

// A reviewer named "the review bot" takes a capital at the start of a sentence; a name such as Muse is unchanged.
const capital = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

function reviewOutcome(pr, review, { name, trigger }) {
  const Name = capital(name);
  if (review?.unreadable) return { kind: "escalate", reason: `A review of ${name}'s on PR #${pr.number} has no submission time, so its latest review isn't known. Check the reviews on GitHub.` };
  if (!review || review.pending) {
    return review?.waitedMs > REVIEW_WAIT_MS
      ? nudge(`${Name} hasn't reviewed PR #${pr.number} in 30 minutes. Comment ${trigger} once, then wait for its review.`)
      : { kind: "await", reason: `Waiting for ${name}'s review of PR #${pr.number}.` };
  }
  if (review.state !== "APPROVED" && review.rounds >= MAX_REVIEW_ROUNDS) {
    return { kind: "escalate", reason: `${Name} has reviewed PR #${pr.number} ${review.rounds} times without approving it.` };
  }
  if (review.state === "DISMISSED") return nudge(`${Name}'s latest review of PR #${pr.number} was dismissed. Comment ${trigger} once for a fresh one, then wait for it.`);
  if (!review.onHead) return nudge(`${Name} hasn't reviewed your latest push to PR #${pr.number}. Comment ${trigger} once, then wait for its review.`);
  if (review.state !== "APPROVED") {
    return nudge(
      `${Name}'s latest review of PR #${pr.number} is ${review.state}. Check each point, fix the real ones, answer every point in one comment, push, then comment ${trigger} once.`,
    );
  }
  if (!review.answered) {
    return nudge(`${Name} approved PR #${pr.number}. Answer each note in its review in one PR comment. Push nothing unless a note is a real bug.`);
  }
  return null;
}

/**
 * Where the wave stands once its builder has stopped. `facts`:
 * - `tasks`: [{ id, status }], `blocked`: a BLOCKED.md in the spec, `dirty` and `unpushed`: the checkout's state,
 *   `outside`: files the branch changed that no task of the wave lists;
 * - `pr`: null or { number, conflicting }; `review`: null, or the reviewer bot's latest review as { state, onHead,
 *   pending, answered, rounds, waitedMs }; `ci`: "pass", "fail", "pending" or "none" on the PR's head.
 * `reviewer` ({ name, trigger }) and `defaultBranch` word the messages.
 *
 * Returns { kind, reason }: done, blocked, await (the reviewer bot or CI is working), nudge (the builder has more to
 * do) or escalate (the lead decides).
 */
export function waveOutcome(facts, { reviewer, defaultBranch }) {
  if (facts.blocked) return { kind: "blocked", reason: "The builder wrote BLOCKED.md." };
  const open = facts.tasks.filter((task) => task.status !== "complete").map((task) => task.id);
  if (open.length > 0) {
    return nudge(`${open.join(", ")} ${open.length === 1 ? "isn't" : "aren't"} complete. Continue the work loop in AGENTS.md with ${open[0]}.`);
  }
  if (facts.outside?.length > 0) {
    return nudge(
      `Your branch changes ${facts.outside.join(", ")}, which no task in this wave lists. Undo them: discard what isn't committed (git restore, or delete a new file), revert what is in a new commit, and push. If a task needs them, write BLOCKED.md instead.`,
    );
  }
  if (facts.dirty || facts.unpushed) {
    return nudge("Some work isn't committed and pushed. Run node tools/guardrails/verify.mjs, make the task's one commit, and push.");
  }
  if (!facts.pr) return nudge("Every task is done, but the wave has no pull request yet. Open it as your brief says.");
  if (facts.pr.conflicting) {
    return nudge(`PR #${facts.pr.number} conflicts with ${defaultBranch}, so CI can't run. Merge origin/${defaultBranch} into your branch, resolve the conflicts, verify, push, and comment ${reviewer.trigger} once.`);
  }
  const reviewed = reviewOutcome(facts.pr, facts.review, reviewer);
  if (reviewed) return reviewed;
  if (facts.ci === "fail") {
    return nudge(`CI failed, or skipped a required job, on PR #${facts.pr.number}'s head. Fix a failure; for a skipped job, push again so it runs. Then comment ${reviewer.trigger}.`);
  }
  if (facts.ci !== "pass") return { kind: "await", reason: `Waiting for CI on PR #${facts.pr.number}.` };
  return { kind: "done", reason: `PR #${facts.pr.number} is approved on its head, answered, and green. The lead audits and merges it.` };
}

/**
 * Whether the builder is waiting on someone else: its PR waits on the reviewer bot (for up to REVIEW_WAIT_MS) or on
 * CI. A builder polling for either is quiet with nothing running, which must not read as a hung builder.
 */
export function isWaiting({ pr, review, ci }) {
  if (!pr) return false;
  if (review?.pending && review.waitedMs < REVIEW_WAIT_MS) return true;
  return ci === "pending" || (ci === "none" && !pr.conflicting);
}

/** After an outcome, what the runner does next, given how many nudges this wave has had. */
export function nextStep(outcome, nudges) {
  if (outcome.kind === "nudge" && nudges >= MAX_NUDGES) {
    return { kind: "escalate", reason: `The builder stopped ${nudges + 1} times with work left. Last time: ${outcome.reason}` };
  }
  return outcome;
}
