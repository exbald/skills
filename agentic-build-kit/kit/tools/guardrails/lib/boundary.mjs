// Where writes may go. Some paths no agent writes, ever: .git/, lockfiles (npm changes them, not
// hands) and the paths agentkit.config.json protects, such as frozen approved designs. While a task is
// active, the rest of the repository is limited to the task's file lists; gitignored paths and paths
// outside the repository never reach a commit, so the lists don't apply to them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { splitOptions, valuesOf } from "./args.mjs";
import { isIgnored } from "./git.mjs";
import { isTestFile, toRepoPath } from "./paths.mjs";
import { isListed } from "./task.mjs";

const LOCKFILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const GIT_DIR = "Files inside .git/ are git's own. Use git commands instead of writing there.";
const INSTALLS = new Set(["install", "i", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal", "isntall", "add"]);
const UNINSTALLS = new Set(["uninstall", "unlink", "remove", "rm", "r", "un"]);
const NPM_VALUES = new Set(["-w", "--workspace", "--prefix", "--registry", "--tag", "--omit", "--include"]);

/**
 * Why no agent may write this path, or null. `path` is absolute, or a shell word that couldn't be resolved.
 * `protectedPaths` is agentkit.config.json's list of { path, reason }: a folder ends with "/".
 */
export function protectedWriteReason(path, root, protectedPaths = []) {
  const absolute = path.startsWith("/");
  const rel = absolute && root ? toRepoPath(root, path) : null;
  const segments = (rel ?? path).toLowerCase().split("/");
  const name = segments.at(-1) ?? "";
  if (segments.includes(".git")) return GIT_DIR;
  if (LOCKFILES.has(name)) return `${name} is changed only by the package manager (npm install, npm ci), never by hand.`;
  if (rel === null && absolute) return null;
  // A word the shell would build at run time is matched anywhere in it, since its start can't be known.
  const entry = protectedPaths.find((candidate) => protectedPattern(candidate.path, rel === null).test(rel ?? path));
  return entry ? (entry.reason ?? protectedReason(entry.path)) : null;
}

function protectedPattern(path, anywhere) {
  const bare = path.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${anywhere ? "(^|/)" : "^"}${bare}(/|$)`, "i");
}

function protectedReason(path) {
  return `${path} is protected (agentkit.config.json, protectedPaths), and coding agents never change it. If it needs a change, stop and write BLOCKED.md.`;
}

/** Why the task active in the repository that holds `abs` doesn't allow writing it, or null. */
export function boundaryReason(context, abs) {
  const root = context.rootOf(abs);
  const task = root ? context.taskAt(root) : null;
  if (!task) return null;
  const rel = toRepoPath(root, abs);
  if (rel === null || task.always.has(rel)) return null;
  const test = isTestFile(rel);
  if (isListed(rel, task.entries, !test) || isIgnored(root, rel)) return null;
  if (test) {
    return `${rel} is a test file that the current task (${task.path}) doesn't list. Tests are the contract: never weaken, skip or delete them. If a test is wrong or has to change, stop and write ${task.specDir}/BLOCKED.md.`;
  }
  return (
    `${rel} is not in the current task's file lists (${task.path}, Files to Modify and Files to Create). ` +
    `Change it only if the task allows it, by adding it to those lists; otherwise stop and write ${task.specDir}/BLOCKED.md ` +
    "saying which file you need and why (AGENTS.md, Stop conditions)."
  );
}

/** npm install <package> and npm uninstall <package> change a package.json the task must list. */
export function dependencyReason(commands, context) {
  const task = context.task();
  if (!task) return null;
  for (const command of commands) {
    if (command.program !== "npm") continue;
    const parsed = splitOptions(command.args, NPM_VALUES);
    const [sub, ...packages] = parsed.operands;
    const changesDependencies = (INSTALLS.has(sub) || UNINSTALLS.has(sub)) && packages.length > 0;
    if (!changesDependencies || parsed.options.some((option) => option === "-g" || option === "--global")) continue;
    const manifest = manifestPaths(parsed, command.dir, context.root()).find((rel) => !isListed(rel, task.entries));
    if (manifest) {
      return `Adding or removing a dependency changes ${manifest}, which the current task (${task.path}) doesn't list. If the task needs a new dependency, stop and write ${task.specDir}/BLOCKED.md.`;
    }
  }
  return null;
}

function manifestPaths(parsed, dir, root) {
  const workspaces = valuesOf(parsed, "-w", "--workspace");
  if (workspaces.length > 0) {
    // npm takes a workspace's package name or its folder. A name it can't find stays as given, so it's denied.
    const byName = workspaceFolders(root);
    return workspaces.map((workspace) => `${byName.get(workspace) ?? workspace.replace(/^\.\//, "").replace(/\/+$/, "")}/package.json`);
  }
  for (let current = dir; toRepoPath(root, current) !== null; current = dirname(current)) {
    if (existsSync(join(current, "package.json"))) return [toRepoPath(root, join(current, "package.json"))];
    if (current === root) break;
  }
  return ["package.json"];
}

function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** The root package.json's workspaces, by package name: @acme/agent → apps/agent. Handles dir and dir/*. */
function workspaceFolders(root) {
  const declared = readManifest(join(root, "package.json"))?.workspaces;
  const patterns = Array.isArray(declared) ? declared : Array.isArray(declared?.packages) ? declared.packages : [];
  const folders = patterns.flatMap((pattern) => {
    const clean = String(pattern).replace(/^\.\//, "").replace(/\/+$/, "");
    if (!clean.endsWith("/*")) return [clean];
    const parent = clean.slice(0, -2);
    try {
      return readdirSync(join(root, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${parent}/${entry.name}`);
    } catch {
      return [];
    }
  });
  const named = folders.map((folder) => [readManifest(join(root, folder, "package.json"))?.name, folder]);
  return new Map(named.filter(([name]) => typeof name === "string"));
}
