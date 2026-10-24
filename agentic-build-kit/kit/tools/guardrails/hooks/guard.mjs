#!/usr/bin/env node
// PreToolUse hook. Denies tool calls that AGENTS.md forbids (.env* files, the paths and commands
// agentkit.config.json reserves for the owner, lockfiles, .git/, deploys, force pushes, history rewrites
// and the rest of the "Never" list) and, while specs/.current-task names a task, writes outside that
// task's file lists. It prints nothing when it has no objection, so the normal permission prompts still
// apply: it never answers "allow".
import { homedir } from "node:os";
import { resolve } from "node:path";
import { boundaryReason, dependencyReason, protectedWriteReason } from "../lib/boundary.mjs";
import { analyzeShell } from "../lib/commands.mjs";
import { configAt } from "../lib/config.mjs";
import { currentBranch, repoRoot } from "../lib/git.mjs";
import { denyTool, isEvent, readHookInput, runHook } from "../lib/io.mjs";
import { canonicalPath, existingDirectory } from "../lib/paths.mjs";
import { forbiddenReason } from "../lib/rules.mjs";
import { ENV_REASON, envCommandReason, isEnvFile, liveKeyReason } from "../lib/secrets.mjs";
import { DYNAMIC } from "../lib/shell.mjs";
import { activeTask } from "../lib/task.mjs";
import { writeTargets } from "../lib/writes.mjs";

const FILE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

await runHook("guard", async () => {
  const input = await readHookInput();
  if (!isEvent(input, "PreToolUse")) return;
  const reason = checkToolCall(input, createContext(input.cwd));
  if (reason) denyTool(reason);
});

function checkToolCall({ tool_name: tool, tool_input: params }, context) {
  const toolInput = params && typeof params === "object" ? params : {};
  if (tool === "Bash") return checkShell(String(toolInput.command ?? ""), context);
  if (tool === "Read") return isEnvFile(toolInput.file_path ?? "") ? ENV_REASON : null;
  if (tool === "Grep") return grepTargetsEnv(toolInput) ? ENV_REASON : null;
  if (FILE_WRITE_TOOLS.has(tool)) return checkFileWrites(filePaths(toolInput), context);
  return null;
}

// Grep prints matching lines, so a search pointed at a .env* file by path or glob would print secrets.
function grepTargetsEnv(toolInput) {
  return [toolInput.path, toolInput.glob].some((value) => typeof value === "string" && isEnvFile(value));
}

function filePaths(toolInput) {
  const edits = Array.isArray(toolInput.edits) ? toolInput.edits.map((edit) => edit?.file_path) : [];
  return [toolInput.file_path, toolInput.notebook_path, ...edits].filter((path) => typeof path === "string" && path !== "");
}

function checkFileWrites(paths, context) {
  for (const path of paths) {
    if (isEnvFile(path)) return ENV_REASON;
    const abs = canonicalPath(resolve(context.cwd, path));
    const reason = protectedWrite(abs, context) ?? boundaryReason(context, abs);
    if (reason) return reason;
  }
  return null;
}

function checkShell(source, context) {
  const liveKey = liveKeyReason(source);
  if (liveKey) return liveKey;
  const commands = analyzeShell(source, { cwd: context.cwd, home: context.home });
  return (
    forbiddenReason(commands, context) ??
    envCommandReason(commands) ??
    shellWritesReason(commands, context) ??
    dependencyReason(commands, context)
  );
}

function shellWritesReason(commands, context) {
  for (const command of commands) {
    for (const word of writeTargets(command)) {
      const reason = shellWriteReason(word, command.dir, context);
      if (reason) return reason;
    }
  }
  return null;
}

function shellWriteReason(word, dir, context) {
  if (isEnvFile(word)) return ENV_REASON;
  if (word.includes(DYNAMIC)) return protectedWriteReason(word, null, context.config().protectedPaths);
  const abs = canonicalPath(resolve(dir, word));
  return protectedWrite(abs, context) ?? boundaryReason(context, abs);
}

/** A path the configuration of the repository it lands in protects (agentkit.config.json, protectedPaths). */
function protectedWrite(abs, context) {
  const root = context.rootOf(abs);
  return protectedWriteReason(abs, root, (root ? context.configAt(root) : context.config()).protectedPaths);
}

/**
 * What the checks need, looked up lazily: most tool calls never need git. A write is judged by the
 * repository it lands in, which may differ from the session's directory, and by that repository's
 * agentkit.config.json. A broken config falls back to the defaults (lib/config.mjs, configAt), so the
 * rules that need no config still hold.
 */
function createContext(rawCwd) {
  const cwd = canonicalPath(typeof rawCwd === "string" && rawCwd !== "" ? rawCwd : process.cwd());
  const memo = new Map();
  const once = (key, compute) => {
    if (!memo.has(key)) memo.set(key, compute());
    return memo.get(key);
  };
  const root = () => once("root", () => repoRoot(cwd) ?? cwd);
  const taskAt = (repo) => once(`task ${repo}`, () => activeTask(repo));
  const configOf = (repo) => once(`config ${repo}`, () => configAt(repo));
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  return {
    cwd,
    home: canonicalPath(process.env.HOME || homedir()),
    root,
    projectRoot: () => once("project", () => (projectDir ? repoRoot(projectDir) : null)),
    rootOf: (abs) => {
      const dir = existingDirectory(abs);
      return once(`root ${dir}`, () => repoRoot(dir));
    },
    taskAt,
    task: () => taskAt(root()),
    configAt: configOf,
    config: () => configOf(root()),
    branchAt: (dir) => currentBranch(dir),
  };
}
