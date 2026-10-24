// Git helpers. Every call runs git in the given directory with the repository-locating variables
// (GIT_DIR, GIT_INDEX_FILE and friends) removed, so a hook started from inside a git hook still
// looks at the repository it was pointed at.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalPath } from "./paths.mjs";
import { STATE_FILES } from "./state.mjs";

const LOCATORS = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
]);
// The guardrails' own state files never count as changes, gitignored or not.
const WITHOUT_STATE = [".", ...STATE_FILES.map((file) => `:(exclude)${file}`)];

// Hooks have about 10 seconds in total; verify.mjs is not a hook and may take longer.
function runGit(cwd, args, { env = {}, timeout = 5000 } = {}) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !LOCATORS.has(key)));
  return spawnSync("git", args, {
    cwd,
    env: { ...inherited, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
}

/** stdout without its trailing newline, or null when git is missing or the command fails. */
export function git(cwd, args, options) {
  const result = runGit(cwd, args, options);
  return result.status === 0 ? result.stdout.trimEnd() : null;
}

export function repoRoot(cwd) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  return root ? canonicalPath(root) : null;
}

/** The checked-out branch, or null when HEAD is detached or git fails. */
export function currentBranch(cwd) {
  return git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
}

export function headTree(root) {
  return git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{tree}"]);
}

/**
 * The pathspec for `git add`: everything but the state files git would pick up. A gitignored one is left out
 * anyway, and naming it in an exclude makes some git versions (Apple Git 2.54) refuse the whole add.
 */
export function addableWithoutState(root) {
  const ignored = new Set((git(root, ["check-ignore", "--", ...STATE_FILES]) ?? "").split("\n"));
  return [".", ...STATE_FILES.filter((file) => !ignored.has(file)).map((file) => `:(exclude)${file}`)];
}

/**
 * `git status --porcelain` lines (state files excluded), or null when git fails. `git status` accepts an exclude
 * that names a gitignored file, which `git add` refuses on Apple Git 2.54, so it keeps the static list.
 */
export function changedPaths(root) {
  const output = git(root, ["status", "--porcelain", "--", ...WITHOUT_STATE]);
  return output === null ? null : output.split("\n").filter(Boolean);
}

/** The upstream branch and how many local commits it lacks. */
export function upstreamStatus(root) {
  const upstream = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (!upstream) return { upstream: null, ahead: 0 };
  const ahead = Number.parseInt(git(root, ["rev-list", "--count", "@{upstream}..HEAD"]) ?? "0", 10);
  return { upstream, ahead: Number.isInteger(ahead) ? ahead : 0 };
}

export function isIgnored(root, rel) {
  return runGit(root, ["check-ignore", "-q", "--", rel]).status === 0;
}

/**
 * The tree hash of everything git would commit from the working tree (ignored files and the state
 * files left out), built in a scratch copy of the index so the real index is never touched.
 */
export function workingTreeHash(root) {
  const scratch = mkdtempSync(join(tmpdir(), "guardrails-index-"));
  try {
    const index = join(scratch, "index");
    const realIndex = git(root, ["rev-parse", "--git-path", "index"]);
    if (realIndex && existsSync(resolve(root, realIndex))) {
      const source = resolve(root, realIndex);
      copyFileSync(source, index);
      // The copy keeps the real index's time. Git rechecks the content of an entry written in the same second
      // as its index, and a copy stamped later would let a same-size edit made in that second go unseen.
      const { atime, mtime } = statSync(source);
      utimesSync(index, atime, mtime);
    }
    const options = { env: { GIT_INDEX_FILE: index }, timeout: 120000 };
    if (git(root, ["add", "-A", "--", ...addableWithoutState(root)], options) === null) throw new Error("git add failed in the scratch index");
    const tree = git(root, ["write-tree"], options);
    if (!tree) throw new Error("git write-tree failed");
    return tree;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
