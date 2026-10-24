// A wave's checkout, beside the repository. It's a clone of its own, never a git worktree, so the
// wave shares nothing with the repository's checkout: no index, no branches, no hooks. (The first live wave, on
// 2026-10-23, ran in the main checkout. That was OpenCode following an inherited $PWD, which builderEnv now sets,
// not the worktree itself, but a clone keeps the two apart either way.) However an earlier run left things,
// preparing it never discards a commit: local work always wins, and origin's branch is only fast-forwarded onto.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

function git(args, cwd, { check = true } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (check && (result.error || result.status !== 0)) throw new Error(`git ${args.join(" ")} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result;
}

const exists = (ref, cwd) => git(["rev-parse", "--verify", "--quiet", ref], cwd, { check: false }).status === 0;

/** How the checkout's branch stands against origin's: { ahead, behind } in commits. */
function divergence(checkout, branch) {
  const [ahead, behind] = git(["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`], checkout).stdout.trim().split(/\s+/).map(Number);
  return { ahead, behind };
}

/** A new clone of origin, borrowing the repository's objects so it's quick, then standing on its own. */
function cloneFor(root, checkout, branch) {
  mkdirSync(dirname(checkout), { recursive: true });
  const origin = git(["remote", "get-url", "origin"], root).stdout.trim();
  git(["clone", "-q", "--reference", root, "--dissociate", origin, checkout], root);
  // A local branch of this name in the repository holds work an earlier, worktree-based run never pushed. It's
  // copied into the clone and left in the repository too, so deleting the clone can't lose it.
  if (exists(`refs/heads/${branch}`, root)) git(["fetch", "-q", root, `refs/heads/${branch}:refs/heads/${branch}`], checkout);
}

/** Puts the checkout on the wave's branch: the local one, else origin's, else a new one from origin's default branch. */
function switchToBranch(checkout, branch, defaultBranch) {
  if (git(["branch", "--show-current"], checkout).stdout.trim() === branch) return;
  if (exists(`refs/heads/${branch}`, checkout)) git(["switch", "-q", branch], checkout);
  else if (exists(`refs/remotes/origin/${branch}`, checkout)) git(["switch", "-q", "--no-track", "-c", branch, `origin/${branch}`], checkout);
  else git(["switch", "-q", "--no-track", "-c", branch, `origin/${defaultBranch}`], checkout);
}

/**
 * Refuses whatever an earlier run left at the checkout's path unless it's a clone of this repository's origin.
 * A git worktree shares the repository's branches and hooks. A clone's .git is a directory of its own, a
 * worktree's is a file pointing at the repository, and anything else (an emptied folder, a stray file) is no
 * checkout at all. A clone of another remote would build and push somewhere else.
 */
function checkLeftover(root, checkout) {
  let kind = "missing";
  try {
    kind = statSync(join(checkout, ".git")).isDirectory() ? "clone" : "worktree";
  } catch {
    // Stays "missing".
  }
  if (kind === "worktree") {
    throw new Error(`${checkout} is a git worktree, which shares the repository's branches and hooks, and waves build in clones. Remove it (git worktree remove ${checkout}) and run again.`);
  }
  if (kind === "missing") throw new Error(`${checkout} exists but isn't a git checkout. Remove it and run again.`);
  const origin = git(["remote", "get-url", "origin"], root).stdout.trim();
  const theirs = git(["remote", "get-url", "origin"], checkout, { check: false }).stdout.trim();
  if (theirs !== origin) throw new Error(`${checkout} is a clone of ${theirs || "no origin"}, not of ${origin}. Remove it and run again.`);
}

/**
 * Makes or brings up to date the wave's checkout, and says what it did, for the runner's log. Then, when
 * origin has the branch: fast-forward onto it if the checkout has no work of its own; otherwise leave it as it
 * is, ahead or diverged, for the builder to push or merge. A new branch starts from origin's `defaultBranch`.
 */
export function prepareCheckout({ root, branch, worktree: checkout, defaultBranch = "main" }) {
  const made = !existsSync(checkout);
  if (made) cloneFor(root, checkout, branch);
  else {
    checkLeftover(root, checkout);
    git(["fetch", "-q", "origin"], checkout);
  }
  const local = exists(`refs/heads/${branch}`, checkout);
  const pushed = exists(`refs/remotes/origin/${branch}`, checkout);
  switchToBranch(checkout, branch, defaultBranch);
  const start = made ? (local ? "cloned, with its local branch" : pushed ? "cloned, on its pushed branch" : `cloned, new from origin/${defaultBranch}`) : "found";
  if (!pushed) return `checkout ${checkout} ${start}`;
  git(["branch", "--set-upstream-to", `origin/${branch}`], checkout);
  const { ahead, behind } = divergence(checkout, branch);
  if (behind > 0 && ahead === 0) {
    git(["merge", "-q", "--ff-only", `origin/${branch}`], checkout);
    return `checkout ${checkout} ${start}, fast-forwarded to origin/${branch}`;
  }
  if (ahead > 0) return `checkout ${checkout} ${start}, ${ahead} commit(s) ahead of origin/${branch}${behind > 0 ? ` and ${behind} behind` : ""}: kept as it is`;
  return `checkout ${checkout} ${start}, up to date with origin/${branch}`;
}
