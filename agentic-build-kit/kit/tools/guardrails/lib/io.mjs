// Hook plumbing shared by the three hooks: read the JSON event from stdin and answer in the Claude
// Code hook format (ZCode reads the same). Hooks print nothing when they have no objection, and on
// any unexpected error they fail open: a note on stderr, exit 0, no decision.

export async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  const input = raw === "" ? {} : JSON.parse(raw);
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("hook input is not a JSON object");
  }
  return input;
}

/** True when the input is for `event`, or names no event (a hand-run check). */
export function isEvent(input, event) {
  return input.hook_event_name === undefined || input.hook_event_name === event;
}

export function denyTool(reason) {
  writeJson({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
}

export function blockStop(reason) {
  writeJson({ decision: "block", reason });
}

export function addSessionContext(text) {
  writeJson({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } });
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

/** Runs a hook body. Never exits non-zero, so a broken hook can't block anyone's work. */
export async function runHook(name, body) {
  try {
    await body();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`guardrails ${name}: ${message} (no decision made)`);
  }
  process.exitCode = 0;
}
