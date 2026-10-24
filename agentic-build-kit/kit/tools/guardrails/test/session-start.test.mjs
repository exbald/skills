import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { SCRIPTS, TASK, createFixture, taskText } from "./fixture.mjs";

describe("session-start", () => {
  let fx;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  const sessionContext = () => {
    const result = fx.hook(SCRIPTS.sessionStart, { cwd: fx.dir, hook_event_name: "SessionStart", source: "startup" });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName, "SessionStart");
    return output.additionalContext;
  };

  it("reports the branch, recent commits, working tree, ledger tail and that no task is active", () => {
    fx.write("src/app.ts", "export const app = 5;\n");
    const context = sessionContext();
    assert.match(context, /feat\/demo/);
    assert.match(context, /initial/);
    assert.match(context, /M src\/app\.ts/);
    assert.match(context, /Fixture row/);
    assert.match(context, /No spec task is active/);
    assert.doesNotMatch(context, /WARNING/);
  });

  it("shows the active task's head and any BLOCKED.md", () => {
    fx.setTask();
    fx.write("specs/01-demo/BLOCKED.md", "# Blocked\n");
    const context = sessionContext();
    assert.match(context, /specs\/01-demo\/tasks\/task-01-demo\.md/);
    assert.match(context, /# Task 01: demo task/);
    assert.match(context, /## Files to Modify/);
    assert.match(context, /specs\/01-demo\/BLOCKED\.md/);
  });

  it("warns loudly on main", () => {
    fx.git("switch", "-q", "main");
    assert.match(sessionContext(), /WARNING.*main/);
  });

  it("names the paths the config protects in its summary", () => {
    assert.match(sessionContext(), /denies \.env\* files, writes to design\/screens\/, lockfiles and \.git\//);
  });

  it("says first, and loudly, when the config is broken", () => {
    fx.write("agentkit.config.json", "{ not json");
    const context = sessionContext();
    assert.match(context, /^WARNING: the guard is running on its defaults because agentkit\.config\.json isn't readable JSON/);
    assert.doesNotMatch(context, /writes to design\/screens/);
  });

  it("warns on the configured default branch too", () => {
    fx.write("agentkit.config.json", `${JSON.stringify({ defaultBranch: "trunk" })}\n`);
    fx.git("switch", "-q", "-c", "trunk");
    assert.match(sessionContext(), /Branch: trunk\. WARNING: trunk is the release branch/);
  });

  it("stays under 4,000 characters", () => {
    fx.write("specs/LEDGER.md", `| row | ${"x".repeat(600)} |\n`.repeat(12));
    fx.write(TASK, `${taskText()}\n${`${"long line ".repeat(30)}\n`.repeat(60)}`);
    fx.setTask();
    assert.ok(sessionContext().length <= 4000);
  });
});
