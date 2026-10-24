import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import plugin from "../../../.opencode/plugins/guardrails.js";
import { classifyCall, guardReason, guardrailsSetup, patchPaths } from "../lib/opencode.mjs";
import { createFixture } from "./fixture.mjs";

// The OpenCode plugin hands OpenCode's tool calls to the same guard Claude Code runs.
describe("OpenCode plugin: translating tool calls", () => {
  it("is an OpenCode 2 plugin definition, which registers one execute.before hook and returns a teardown", async () => {
    assert.equal(plugin.id, "agentkit-guardrails");
    assert.equal(plugin.setup, guardrailsSetup);
    const hooks = [];
    const teardown = await plugin.setup({ location: { directory: "/r" }, tool: { hook: async (name, fn) => hooks.push({ name, fn }) } });
    assert.deepEqual(hooks.map((hook) => hook.name), ["execute.before"]);
    assert.equal(typeof teardown, "function");
  });

  it("maps OpenCode's tools onto the guard's, with OpenCode's argument names", () => {
    const input = (tool, args) => classifyCall(tool, args, "/r").check.tool_input;
    assert.deepEqual(input("shell", { command: "git status" }), { command: "git status" });
    assert.equal(classifyCall("bash", { command: "ls" }, "/r").check.tool_name, "Bash");
    assert.deepEqual(input("read", { filePath: "/r/.env" }), { file_path: "/r/.env" });
    assert.deepEqual(input("read", { path: ".env.example" }), { file_path: ".env.example" });
    assert.equal(classifyCall("write", { filePath: "/r/a.ts", content: "x" }, "/r").check.tool_name, "Write");
    assert.equal(input("edit", { filePath: "/r/a.ts" }).file_path, "/r/a.ts");
    assert.deepEqual(input("grep", { pattern: "KEY", include: ".env*" }), { pattern: "KEY", path: undefined, glob: ".env*" });
    assert.deepEqual(input("grep", { pattern: "KEY", filePath: "/r/.env.local" }), { pattern: "KEY", path: "/r/.env.local", glob: undefined });
  });

  it("checks every file an apply_patch call touches, in either patch form", () => {
    const patch = ["*** Begin Patch", "*** Update File: src/app.ts", "*** Add File: .env.local", "*** Delete File: old.ts", "*** Move to: src/new.ts", "*** End Patch"].join("\n");
    assert.deepEqual(patchPaths(patch), ["src/app.ts", ".env.local", "old.ts", "src/new.ts"]);
    assert.deepEqual(patchPaths("--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n--- /dev/null\n+++ b/README.md"), ["src/app.ts", "README.md"]);
    assert.equal(classifyCall("apply_patch", { patchText: patch }, "/r").check.tool_name, "MultiEdit");
  });

  it("lets through only the tools that change nothing", () => {
    assert.deepEqual(classifyCall("glob", { pattern: "**/*.ts" }, "/r"), { allow: true });
    assert.deepEqual(classifyCall("webfetch", { url: "https://example.com" }, "/r"), { allow: true });
  });

  it("blocks subagents and questions: a subagent's calls aren't shown to reach the guard, and nobody answers", () => {
    assert.match(classifyCall("task", { prompt: "write it" }, "/r").block, /doesn't know the tool "task"/);
    assert.match(classifyCall("question", { questions: [] }, "/r").block, /doesn't know the tool "question"/);
  });

  it("checks a path a multiedit's edits name, beside the file it edits", () => {
    const toolInput = classifyCall("multiedit", { filePath: "/r/a.ts", edits: [{ oldString: "a", newString: "b" }, { filePath: "/r/.env.local" }] }, "/r").check.tool_input;
    assert.deepEqual(toolInput, { file_path: "/r/a.ts", edits: [{ file_path: "/r/.env.local" }] });
  });

  it("fails closed: an unknown tool, OpenCode's execute, an MCP tool, or a call it can't read is blocked", () => {
    for (const tool of ["execute", "shared-memory_mem_add", "frobnicate"]) assert.match(classifyCall(tool, {}, "/r").block, /doesn't know the tool/);
    assert.match(classifyCall(undefined, {}, "/r").block, /didn't say which tool/);
    assert.match(classifyCall("write", { content: "x" }, "/r").block, /names no file/);
    assert.match(classifyCall("read", {}, "/r").block, /names no file/);
    assert.match(classifyCall("shell", {}, "/r").block, /no command/);
    assert.match(classifyCall("apply_patch", { patchText: "nothing here" }, "/r").block, /names no file/);
  });

  it("refuses to load where OpenCode has no tool.hook, rather than run unguarded", async () => {
    await assert.rejects(guardrailsSetup({ location: { directory: "/r" } }), /no tool\.hook/);
    await assert.rejects(guardrailsSetup(undefined), /no tool\.hook/);
    await assert.rejects(guardrailsSetup({ tool: { hook: async () => {} } }), /which checkout it runs in/);
  });

  it("blocks a call when the guard's answer can't be read, or the guard can't run", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-guard-"));
    try {
      const chatty = join(dir, "chatty.mjs");
      writeFileSync(chatty, "process.stdout.write('warning: not json');");
      const input = { hook_event_name: "PreToolUse", cwd: dir, tool_name: "Bash", tool_input: { command: "ls" } };
      assert.throws(() => guardReason(input, { guard: chatty }), /couldn't read the guard's answer/);
      assert.throws(() => guardReason(input, { guard: join(dir, "missing.mjs") }), /couldn't check this call/);
      // What the real guard does when it throws: a note on stderr, nothing on stdout, exit 0.
      const failing = join(dir, "failing.mjs");
      writeFileSync(failing, "console.error('guardrails guard: boom (no decision made)'); process.exitCode = 0;");
      assert.throws(() => guardReason(input, { guard: failing }), /failed while checking this call/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an event of another shape, naming its keys", async () => {
    let hook;
    await guardrailsSetup({ location: { directory: "/r" }, tool: { hook: async (_name, fn) => (hook = fn) } });
    await assert.rejects(hook({ name: "write", args: {} }), /no tool id \(it had name, args\)/);
  });
});

describe("OpenCode plugin: the guard's decisions", () => {
  let fx;
  let hook;
  before(async () => {
    fx = createFixture();
    await plugin.setup({ location: { directory: fx.dir }, tool: { hook: async (_name, fn) => (hook = fn) } });
  });
  after(() => fx.cleanup());
  // OpenCode 2 passes the hook one event: the tool's id, its input, the agent and the session.
  const call = (tool, input) => hook({ tool, input, agent: "build", sessionID: "ses_test" });

  it("refuses .env files, whichever tool reaches for them", async () => {
    await assert.rejects(call("read", { filePath: fx.path(".env.local") }), /guardrails: .*\.env/);
    await assert.rejects(call("shell", { command: "cat .env.local" }), /guardrails/);
    await assert.rejects(call("apply_patch", { patchText: "*** Begin Patch\n*** Add File: .env.local\n+A=1\n*** End Patch" }), /guardrails/);
  });

  it("refuses a write into the frozen designs, with OpenCode 2's relative path argument", async () => {
    await assert.rejects(call("write", { path: "design/screens/scratch-note.txt", content: "hello" }), /guardrails: design\/screens\//);
  });

  it("refuses the Never list's commands", async () => {
    await assert.rejects(call("shell", { command: "git push --force" }), /guardrails/);
    await assert.rejects(call("shell", { command: "flyctl deploy" }), /guardrails/);
    await assert.rejects(call("shell", { command: "gh pr merge 7" }), /guardrails/);
  });

  it("holds writes to the active task's file lists", async () => {
    fx.setTask();
    try {
      await assert.rejects(call("write", { filePath: fx.path("src/other.ts"), content: "x" }), /guardrails/);
      await assert.doesNotReject(call("write", { filePath: fx.path("src/new-module.ts"), content: "x" }));
    } finally {
      fx.write("specs/.current-task", "");
    }
  });

  it("lets ordinary work through", async () => {
    await assert.doesNotReject(call("read", { filePath: fx.path("src/app.ts") }));
    await assert.doesNotReject(call("shell", { command: "git status" }));
    await assert.doesNotReject(call("glob", { pattern: "**/*.ts" }));
  });
});
