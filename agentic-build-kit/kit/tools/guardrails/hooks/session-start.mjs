#!/usr/bin/env node
// SessionStart hook. Gives the agent the facts it needs before doing anything: the branch (with a
// loud warning on a release branch), recent commits, the working tree, the ledger tail, blocked
// specs and the active task, and a warning first if agentkit.config.json is broken. Runs on startup,
// resume, clear and compact; stays under 4,000 characters.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configAt, releaseBranches } from "../lib/config.mjs";
import { currentBranch, git, repoRoot } from "../lib/git.mjs";
import { addSessionContext, isEvent, readHookInput, runHook } from "../lib/io.mjs";
import { LEDGER_FILE, MARKER_FILE } from "../lib/state.mjs";
import { activeTask } from "../lib/task.mjs";

const LIMIT = 4000;

function summary(config) {
  const protectedPaths = config.protectedPaths.map((entry) => entry.path);
  const writes = [".env* files", ...(protectedPaths.length > 0 ? [`writes to ${protectedPaths.join(", ")}`] : []), "lockfiles and .git/"];
  return (
    `Guardrails (tools/guardrails) are on. The PreToolUse guard denies ${writes.join(", ")}, ` +
    `deploys, force pushes, pushes to ${config.defaultBranch}, history rewrites, killing processes by name or port and the rest of the AGENTS.md Never list; ` +
    "while a spec task is active it also denies writes outside the task's file lists. The Stop hook keeps a session with an active task " +
    "going until the task is complete, committed, verified with node tools/guardrails/verify.mjs and pushed, or blocked with BLOCKED.md."
  );
}

await runHook("session-start", async () => {
  const input = await readHookInput();
  if (!isEvent(input, "SessionStart")) return;
  const root = repoRoot(input.cwd || process.cwd());
  if (root) addSessionContext(buildContext(root));
});

function buildContext(root) {
  const config = configAt(root);
  // A broken config leaves the guard on its defaults (lib/config.mjs), so it's said first, where it can't be missed.
  const problem = config.problem ? `WARNING: the guard is running on its defaults because ${config.problem}. Fix agentkit.config.json.` : null;
  const parts = [problem, summary(config), branchPart(root, config), logPart(root), statusPart(root), ledgerPart(root), blockedPart(root)].filter(Boolean);
  const used = parts.join("\n\n").length + 2;
  const text = [...parts, taskPart(root, LIMIT - used)].filter(Boolean).join("\n\n");
  return text.length <= LIMIT ? text : `${text.slice(0, LIMIT - 13)}\n[truncated]`;
}

function branchPart(root, config) {
  const branch = currentBranch(root);
  if (!branch) return "Branch: none (HEAD is detached).";
  if (!releaseBranches(config).has(branch)) return `Branch: ${branch}`;
  return `Branch: ${branch}. WARNING: ${branch} is the release branch. Pushing to it is human-gated (AGENTS.md), so work on a feature branch (git switch -c feat/<name>).`;
}

function logPart(root) {
  const log = git(root, ["log", "--oneline", "-5"]);
  return log ? `Recent commits:\n${clip(log, 600)}` : null;
}

function statusPart(root) {
  const status = git(root, ["status", "--short"]);
  if (status === null) return null;
  if (status === "") return "Working tree: clean.";
  const lines = status.split("\n");
  const more = lines.length > 20 ? `\n… and ${lines.length - 20} more` : "";
  return `Working tree (git status --short):\n${clip(lines.slice(0, 20).join("\n"), 800)}${more}`;
}

function ledgerPart(root) {
  const path = join(root, LEDGER_FILE);
  if (!existsSync(path)) return null;
  const tail = readFileSync(path, "utf8").trimEnd().split("\n").slice(-8).join("\n");
  return `Last lines of ${LEDGER_FILE}:\n${clip(tail, 900)}`;
}

function blockedPart(root) {
  const specs = join(root, "specs");
  if (!existsSync(specs)) return null;
  const blocked = readdirSync(specs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(specs, entry.name, "BLOCKED.md")))
    .map((entry) => `specs/${entry.name}/BLOCKED.md`);
  return blocked.length > 0 ? `Blocked specs: ${blocked.join(", ")}` : null;
}

function taskPart(root, budget) {
  const task = activeTask(root);
  if (!task) return `No spec task is active (${MARKER_FILE} is empty or missing).`;
  const head = task.text.split("\n").slice(0, 40).join("\n");
  const title = `Active task (${MARKER_FILE}): ${task.path}\nFirst 40 lines:\n`;
  return `${title}${clip(head, Math.max(budget - title.length, 200))}`;
}

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, Math.max(max - 2, 0))} …`;
}
