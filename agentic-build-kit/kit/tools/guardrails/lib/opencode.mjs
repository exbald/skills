// The guardrails for OpenCode. OpenCode doesn't run Claude Code's hooks, so its plugin (.opencode/plugins/guardrails.js)
// hands each tool call to the same guard, tools/guardrails/hooks/guard.mjs, in the hook input that guard reads, and
// refuses the call when the guard denies it. One guard, so a builder on OpenCode meets the same rules as one on Claude
// Code: .env* files, the task's file lists, deploys, force pushes and the rest.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GUARD = fileURLToPath(new URL("../hooks/guard.mjs", import.meta.url));

// Variables that would point the guard's git calls at another checkout, such as the session that launched
// OpenCode (tools/guardrails/test/fixture.mjs strips the same ones).
const LOCATORS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "CLAUDE_PROJECT_DIR", "CLAUDE_PLUGIN_ROOT"];

const text = (value) => (typeof value === "string" && value !== "" ? value : undefined);
const filePath = (args) => text(args.filePath) ?? text(args.file_path) ?? text(args.path);

/** Every path an apply_patch call touches, in the "*** Begin Patch" form or a unified diff. */
export function patchPaths(patch) {
  const paths = [];
  for (const line of String(patch ?? "").split(/\r?\n/)) {
    const named = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line) ?? /^\*\*\* Move to: (.+)$/.exec(line);
    const diffed = /^(?:\+\+\+|---) (?:[ab]\/)?(.+)$/.exec(line);
    const path = (named ?? diffed)?.[1]?.trim();
    if (path && path !== "/dev/null") paths.push(path);
  }
  return [...new Set(paths)];
}

// Tools the guard has nothing to check in: they read, search or plan, and change no file. Any tool not
// listed here or in classifyCall is blocked, MCP tools and OpenCode's own `execute` included, so a tool
// OpenCode adds later can't slip past the guard. Add one here only once it's known to change nothing.
// Two are left out on purpose: `task`, since nobody has yet shown that a subagent's own tool calls reach this
// hook, and `question`, since an unattended builder has nobody to answer and would only stall.
export const SAFE_TOOLS = Object.freeze(["glob", "list", "ls", "webfetch", "websearch", "codesearch", "todowrite", "todoread", "skill", "lsp"]);

const blocked = (reason) => ({ block: `The guardrails blocked this call: ${reason}` });
const pathCall = (toolName, args, check) => {
  const path = filePath(args);
  return path ? check(toolName, { file_path: path }) : blocked(`its ${toolName.toLowerCase()} call names no file the guard can check.`);
};

/**
 * What to do with one OpenCode tool call: { check } holds the guard's input, in Claude Code's PreToolUse shape;
 * { allow } is a tool the guard has nothing to check in; { block } is a call it can't read, or a tool it doesn't
 * know. It fails closed: an unattended builder never runs a call nobody checked.
 */
export function classifyCall(tool, args, cwd) {
  if (typeof tool !== "string" || tool === "") return blocked("OpenCode didn't say which tool this is.");
  const input = args && typeof args === "object" ? args : {};
  const check = (toolName, toolInput) => ({ check: { hook_event_name: "PreToolUse", cwd, tool_name: toolName, tool_input: toolInput } });
  switch (tool) {
    case "bash":
    case "shell":
      return text(input.command) ? check("Bash", { command: input.command }) : blocked("its shell call has no command the guard can read.");
    case "read":
      return pathCall("Read", input, check);
    case "grep":
      return check("Grep", { pattern: String(input.pattern ?? ""), path: text(input.path) ?? text(input.filePath), glob: text(input.include) ?? text(input.glob) });
    case "write":
      return pathCall("Write", input, check);
    case "edit":
      return pathCall("Edit", input, check);
    case "multiedit": {
      // OpenCode's multiedit edits one file, so its edits carry no path. One that does is checked too.
      const edits = (Array.isArray(input.edits) ? input.edits : []).map((edit) => filePath(edit ?? {})).filter(Boolean);
      return pathCall("MultiEdit", input, (name, toolInput) => check(name, { ...toolInput, edits: edits.map((path) => ({ file_path: path })) }));
    }
    case "apply_patch":
    case "patch": {
      const paths = patchPaths(input.patchText ?? input.patch ?? input.input);
      return paths.length > 0 ? check("MultiEdit", { edits: paths.map((path) => ({ file_path: path })) }) : blocked("its patch names no file the guard can check.");
    }
    default:
      return SAFE_TOOLS.includes(tool) ? { allow: true } : blocked(`it doesn't know the tool "${tool}". If that tool changes nothing, add it to SAFE_TOOLS in tools/guardrails/lib/opencode.mjs.`);
  }
}

/** Runs the guard on one call. Returns its denial reason, or null when it has no objection. */
export function guardReason(hookInput, { guard = GUARD, env = process.env } = {}) {
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !LOCATORS.includes(key)));
  const result = spawnSync("node", [guard], { input: JSON.stringify(hookInput), cwd: hookInput.cwd, env: childEnv, encoding: "utf8", timeout: 10_000 });
  // An unattended builder must not run unguarded, so a guard that couldn't run blocks the call.
  if (result.error || result.status !== 0) {
    throw new Error(`The guardrails couldn't check this call (${result.error?.message ?? `exit ${result.status}`}), so it's blocked.`);
  }
  // The guard lets a call through when it hits an error of its own, and says so on stderr (lib/io.mjs, runHook).
  // On Claude Code a person is watching; here nobody is, so that counts as a guard that couldn't check.
  if (result.stdout.trim() === "" && /\(no decision made\)/.test(result.stderr)) {
    throw new Error("The guardrails failed while checking this call, so it's blocked.");
  }
  if (result.stdout.trim() === "") return null;
  let decision;
  try {
    decision = JSON.parse(result.stdout).hookSpecificOutput;
  } catch {
    throw new Error("The guardrails couldn't read the guard's answer, so this call is blocked.");
  }
  return decision?.permissionDecision === "deny" ? String(decision.permissionDecisionReason) : null;
}

/** Hands one OpenCode tool call to the guard, and throws its denial, which fails the call in OpenCode. */
export async function guardCall(tool, args, directory, options) {
  const call = classifyCall(tool, args, directory);
  if (call.block) throw new Error(call.block);
  if (call.allow) return;
  const reason = guardReason(call.check, options);
  if (reason) throw new Error(`Blocked by the guardrails: ${reason}`);
}

/**
 * OpenCode 2's plugin setup: every tool call goes to the guard before it runs. OpenCode 2 calls `setup` with
 * its plugin context, whose `tool.hook("execute.before", …)` sees each call's tool id and input; a rejected
 * hook fails the call. Returns the teardown OpenCode expects.
 */
export async function guardrailsSetup(ctx) {
  // Without tool.hook the guard can't see a single call. Throwing makes OpenCode log "failed to load plugin",
  // which tools/build/run-wave.mjs watches for: it stops a builder whose guard didn't load.
  if (typeof ctx?.tool?.hook !== "function") {
    throw new Error("OpenCode's plugin API has no tool.hook, so the guardrails can't run. Don't build here unguarded.");
  }
  // Guessing would check calls against the wrong checkout, so no directory means no guard, and no session.
  const directory = ctx.location?.directory ?? ctx.location?.worktree;
  if (typeof directory !== "string" || directory === "") {
    throw new Error("OpenCode didn't tell the plugin which checkout it runs in, so the guardrails can't run. Don't build here unguarded.");
  }
  // Async, so a refusal is always a rejected promise. An event of another shape is refused, naming its keys,
  // so a change in OpenCode's API shows up in the builder's log instead of opening the gate.
  await ctx.tool.hook("execute.before", async (event) => {
    if (typeof event?.tool !== "string") {
      throw new Error(`The guardrails blocked this call: OpenCode's event had no tool id (it had ${Object.keys(event ?? {}).join(", ") || "nothing"}).`);
    }
    await guardCall(event.tool, event.input, directory);
  });
  return () => {};
}
