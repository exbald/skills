import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, it } from "node:test";
import { SCRIPTS, createFixture, expectBlock, expectSilent } from "./fixture.mjs";

describe("stop-verify", () => {
  let fx;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  const completeAndCommit = () => {
    fx.setTask();
    fx.setStatus("complete");
    fx.write("src/app.ts", "export const app = 3;\n");
    fx.commitAll("feat(spec-01): demo change (task-01)");
  };
  const stampHead = () => fx.stamp(fx.git("rev-parse", "HEAD^{tree}"));

  it("allows stopping when no task is active", () => {
    expectSilent(fx.stop());
  });

  it("blocks while the task is not complete, pointing at the work loop and BLOCKED.md", () => {
    fx.setTask();
    const reason = expectBlock(fx.stop(), /task-01-demo\.md/);
    assert.match(reason, /complete/);
    assert.match(reason, /BLOCKED\.md/);
  });

  it("checks the project directory when the session has moved outside the repository", () => {
    fx.setTask();
    const input = { cwd: tmpdir(), hook_event_name: "Stop", stop_hook_active: false };
    expectBlock(fx.hook(SCRIPTS.stop, input, tmpdir(), { CLAUDE_PROJECT_DIR: fx.dir }), /task-01-demo\.md/);
    expectSilent(fx.hook(SCRIPTS.stop, input, tmpdir()));
  });

  it("allows stopping when the spec has a BLOCKED.md", () => {
    fx.setTask();
    fx.write("specs/01-demo/BLOCKED.md", "# Blocked\n");
    expectSilent(fx.stop());
  });

  it("blocks a complete task with uncommitted changes", () => {
    completeAndCommit();
    stampHead();
    fx.git("push", "-q");
    fx.write("src/app.ts", "export const app = 4;\n");
    expectBlock(fx.stop(), /commit/i);
  });

  it("blocks a complete task when the stamp is missing", () => {
    completeAndCommit();
    fx.git("push", "-q");
    expectBlock(fx.stop(), /node tools\/guardrails\/verify\.mjs/);
  });

  it("blocks a complete task when the stamp is for another tree", () => {
    completeAndCommit();
    fx.stamp("0".repeat(40));
    fx.git("push", "-q");
    expectBlock(fx.stop(), /node tools\/guardrails\/verify\.mjs/);
  });

  it("blocks a complete, verified task that isn't pushed", () => {
    completeAndCommit();
    stampHead();
    expectBlock(fx.stop(), /push/i);
  });

  it("blocks when the branch has no upstream", () => {
    fx.git("switch", "-q", "-c", "feat/local");
    completeAndCommit();
    stampHead();
    expectBlock(fx.stop(), /git push -u origin feat\/local/);
  });

  it("allows stopping when the task is complete, committed, verified and pushed", () => {
    completeAndCommit();
    stampHead();
    fx.git("push", "-q");
    expectSilent(fx.stop());
  });

  it("does not count its own state files as uncommitted, even when they aren't ignored", () => {
    fx.write(".gitignore", "node_modules\n.env*\n");
    completeAndCommit();
    stampHead();
    fx.git("push", "-q");
    fx.write("specs/.stop-blocks", "0\n");
    expectSilent(fx.stop());
  });

  it("gives up after 10 blocks in a row with a warning, then counts again", () => {
    fx.setTask();
    for (let attempt = 1; attempt <= 10; attempt += 1) expectBlock(fx.stop());
    const released = fx.stop();
    expectSilent(released);
    assert.match(released.stderr, /10/);
    expectBlock(fx.stop());
  });

  it("resets the counter whenever it allows", () => {
    fx.setTask();
    for (let attempt = 1; attempt <= 9; attempt += 1) expectBlock(fx.stop());
    fx.write("specs/.current-task", "");
    expectSilent(fx.stop());
    fx.setTask();
    for (let attempt = 1; attempt <= 10; attempt += 1) expectBlock(fx.stop());
  });

  it("fails open on invalid input", () => {
    fx.setTask();
    const result = fx.rawHook(SCRIPTS.stop, "not json");
    expectSilent(result);
    assert.match(result.stderr, /guardrails/);
  });
});
