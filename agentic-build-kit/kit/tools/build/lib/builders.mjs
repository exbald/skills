// The builders and how to read their output (agentkit.config.json's builders). Each builder names a harness and a
// model. A harness "opencode" builder runs in OpenCode on a private server (--standalone), so its commands run under the
// runner's own process and the repository's guard plugin loads. A harness "claude" builder runs in Claude Code under
// the repository's hooks, with a spend cap. Both print one JSON event per line, which the runner reads for the
// session id and the cost. The worked example: GLM 5.3 at max effort in OpenCode for the waves whose code a spec
// gives, Sonnet 5.5 at high effort in Claude Code for the waves where the builder writes the code.
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** A Claude Code wave stops once it has spent this much, in dollars, unless its builder or --budget says otherwise. */
export const DEFAULT_BUDGET_USD = 10;

/** How the runner names a builder in its log: its label, or its name and model. */
export function builderLabel(name, builder) {
  return builder.label ?? `${name} (${builder.model})`;
}

// Variables that would tie the builder to the session that launched the runner, or to another checkout. OpenCode's
// own (OPENCODE_CONFIG and the like) pass through: --standalone keeps the run off the shared service anyway, and
// the guard is the repository's plugin, which no variable turns off.
const INHERITED = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_PLUGIN_ROOT",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
];

/** Whether a checkout's Claude Code settings run the guard before each tool call, as a Claude Code builder's guard needs. */
export function hooksWired(worktree) {
  try {
    return readFileSync(join(worktree, ".claude", "settings.json"), "utf8").includes("tools/guardrails/hooks/guard.mjs");
  } catch {
    return false;
  }
}

/**
 * The environment a builder, or `npm ci` before it, runs with: the runner's, without what points at the launching
 * session, and with PWD set to `realCheckout`, the checkout's resolved path, which callers also pass as cwd.
 * OpenCode 2.0.20 takes its working directory from $PWD, not the process's own cwd (checked on 2026-10-23: the
 * same process in the same folder worked in whichever directory PWD named), and an inherited PWD sent the first
 * live wave's session into the main checkout.
 */
export function builderEnv(env, realCheckout) {
  if (typeof realCheckout !== "string" || !isAbsolute(realCheckout)) throw new Error(`builderEnv needs the checkout's absolute path, not ${realCheckout}.`);
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => !INHERITED.includes(key))), PWD: realCheckout };
}

/**
 * The command that starts a builder, or resumes its session with a new message. `builder` is its entry in
 * agentkit.config.json: { harness, model, effort? }. Model ids come from there, pinned, never a moving alias such as
 * "sonnet": a wave is built, audited and costed as the model the config names. `budgetUsd` is what a Claude Code
 * builder may still spend; OpenCode has no metered cost.
 */
export function builderCommand(builder, { message, session = null, title = "", budgetUsd = DEFAULT_BUDGET_USD }) {
  if (builder?.harness === "opencode") {
    const resume = session ? ["--session", session] : [];
    // --print-logs puts the server's log on stderr, where the runner sees whether the guard plugin loaded.
    const flags = ["--standalone", "--print-logs", "-m", builder.model, "--auto", "--format", "json"];
    return { command: "opencode", args: ["run", ...flags, ...(title ? ["--title", title] : []), ...resume, message] };
  }
  if (builder?.harness === "claude") {
    const resume = session ? ["--resume", session] : [];
    const budget = ["--max-budget-usd", Math.max(0, budgetUsd).toFixed(2)];
    const effort = builder.effort ? ["--effort", builder.effort] : [];
    // Headless runs can't answer permission prompts, so they'd hang on the first one. Skipping prompts doesn't
    // skip the guard: Claude Code still runs the repository's PreToolUse hook, and its denials still hold.
    const flags = ["--model", builder.model, ...effort, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
    return { command: "claude", args: ["-p", ...flags, ...budget, ...resume, message] };
  }
  throw new Error(`Unknown harness "${builder?.harness}". A builder's harness is opencode or claude.`);
}

/** One line of a builder's output as an event, or null when it isn't JSON. */
export function parseEvent(line) {
  try {
    const event = JSON.parse(line);
    return event && typeof event === "object" && !Array.isArray(event) ? event : null;
  } catch {
    return null;
  }
}

/** The session an event belongs to, when it says: OpenCode's sessionID, Claude Code's session_id. */
export function sessionOf(event) {
  const id = event.sessionID ?? event.part?.sessionID ?? event.session_id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** Whether an event reports what its run cost: Claude Code's result event. OpenCode reports none. */
export function reportsCost(event) {
  return event.type === "result" && typeof event.total_cost_usd === "number";
}

/** The dollars an event reports as spent. */
export function costOf(event) {
  return reportsCost(event) ? event.total_cost_usd : 0;
}

/**
 * Whether a result's total takes in the session's earlier runs, or null when the result doesn't say. Claude Code
 * 2.1.309 reports `total_cost_usd` and `modelUsage` for everything so far, and `usage` for the stretch since the
 * last result (checked 2026-10-23, every result of two live waves), so on a run's first result the two
 * agree unless it resumed a session. Without both, a result is no signal, and a run that never gives one counts its
 * total as its own.
 */
export function includesEarlierRuns(event) {
  if (!reportsCost(event) || typeof event.modelUsage !== "object" || event.modelUsage === null) return null;
  const run = Number(event.usage?.output_tokens);
  if (!Number.isFinite(run)) return null;
  const session = Object.values(event.modelUsage).reduce((sum, model) => sum + (Number(model?.outputTokens) || 0), 0);
  return session > run;
}
