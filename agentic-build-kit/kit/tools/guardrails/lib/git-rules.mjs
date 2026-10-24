// Git rules from AGENTS.md: no force pushes, no pushes to main, master or the configured default
// branch, no history rewriting, no skipped hooks. Each returns a plain reason that says what to do
// instead, or null.
import { resolve } from "node:path";
import { gitInvocation, hasShortFlag, splitOptions } from "./args.mjs";
import { releaseBranches } from "./config.mjs";

const PUSH_VALUES = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
const COMMIT_VALUES = new Set([
  ...["-m", "-F", "-C", "-c", "-t", "--message", "--file", "--reuse-message", "--reedit-message", "--template"],
  ...["--author", "--date", "--fixup", "--squash", "--trailer", "--cleanup", "--pathspec-from-file"],
]);

export const FORCE_PUSH =
  "Force-pushing rewrites pushed history, which AGENTS.md forbids. Push normally; if the push is rejected, stop and write BLOCKED.md.";
const pushRelease = (branches) =>
  `Never push to ${[...branches].join(" or ")} directly (AGENTS.md, Never). Push your feature branch and open a pull request; it merges through merge-approved.mjs once the reviewer approves.`;
export const HISTORY_REWRITE =
  "Rewriting git history (rebase, commit --amend, filter-branch, filter-repo, BFG) is not allowed (AGENTS.md, Never). Add a new commit instead.";
const RESET_HARD =
  "git reset --hard throws work away. Commit or stash it, restore single files with git restore <path>, or stop and write BLOCKED.md.";
export const SKIP_HOOKS =
  "Skipping git hooks (--no-verify, commit -n, core.hooksPath) is not allowed. Fix what the hook reports, or stop and write BLOCKED.md.";
const CLEAN_IGNORED =
  "git clean -x deletes ignored files, including the human-managed .env.local and the local database. Delete the specific files you created instead.";

const SUBCOMMANDS = new Map([
  ["push", pushReason],
  ["reset", ({ rest }) => (rest.includes("--hard") ? RESET_HARD : null)],
  ["rebase", () => HISTORY_REWRITE],
  ["filter-branch", () => HISTORY_REWRITE],
  ["filter-repo", () => HISTORY_REWRITE],
  ["commit", commitReason],
  ["clean", ({ rest }) => (hasShortFlag(splitOptions(rest).options, "xX") ? CLEAN_IGNORED : null)],
]);

export function gitReason(command, context) {
  const call = gitInvocation(command.args);
  if (call.configs.some((config) => /^core\.hookspath=/i.test(config))) return SKIP_HOOKS;
  const check = SUBCOMMANDS.get(call.sub);
  return check ? check(call, command, context) : null;
}

function pushReason({ rest, dir }, command, context) {
  const { options, operands } = splitOptions(rest, PUSH_VALUES);
  const force = options.some((option) => option === "--force" || option.startsWith("--force-with-lease") || /^-[A-Za-z]*f[A-Za-z]*$/.test(option));
  if (force || operands.some((operand) => operand.startsWith("+"))) return FORCE_PUSH;
  const branches = releaseBranches(context.config());
  if (options.some((option) => ["--all", "--branches", "--mirror"].includes(option))) return pushRelease(branches);
  if (operands.slice(1).some((refspec) => namesReleaseBranch(refspec, branches))) return pushRelease(branches);
  const branch = context.branchAt(resolve(command.dir, dir ?? "."));
  if (!branches.has(branch)) return null;
  return `The current branch is ${branch}, and pushing from it is human-gated. Create a feature branch (git switch -c feat/<name>), commit there and push that.`;
}

function namesReleaseBranch(refspec, branches) {
  return refspec.split(":").some((side) => branches.has(side.replace(/^refs\/heads\//, "")));
}

function commitReason({ rest }) {
  const { options } = splitOptions(rest, COMMIT_VALUES);
  if (options.includes("--amend")) return HISTORY_REWRITE;
  return options.some(isShortNoVerify) ? SKIP_HOOKS : null;
}

/** commit -n is --no-verify; in -nm "msg" the n counts, in -mn the n is the message. */
function isShortNoVerify(option) {
  if (!/^-[A-Za-z]/.test(option)) return false;
  for (const letter of option.slice(1)) {
    if (letter === "n") return true;
    if ("mFCctSu".includes(letter)) return false;
  }
  return false;
}
