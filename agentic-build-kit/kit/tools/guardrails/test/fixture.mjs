// Test helpers: a throwaway git repo shaped like a project that uses the kit (a spec task, a ledger,
// frozen design screens its agentkit.config.json protects, a lockfile, a bare remote to push to) and
// runners that feed the hook scripts JSON on stdin, the way Claude Code and ZCode call them. Not a test
// file itself.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SCRIPTS = Object.freeze({
  guard: join(TOOL_DIR, "hooks", "guard.mjs"),
  stop: join(TOOL_DIR, "hooks", "stop-verify.mjs"),
  sessionStart: join(TOOL_DIR, "hooks", "session-start.mjs"),
  verify: join(TOOL_DIR, "verify.mjs"),
});
export const TASK = "specs/01-demo/tasks/task-01-demo.md";

// The fixture's agentkit.config.json: an owner, one protected folder and one command only the owner runs, so the
// tests cover what the config adds to the guard. Everything else is the kit's default.
export const CONFIG = Object.freeze({
  project: "fixture",
  owner: "Alex",
  protectedPaths: [{ path: "design/screens/" }],
  deniedCommands: [{ command: "vercel deploy" }],
});

// Variables that would point git or the hooks at another repository (CLAUDE_PROJECT_DIR is set
// when the tests run inside Claude Code).
const LOCATORS = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_PLUGIN_ROOT",
]);

export function taskText(status = "pending") {
  return [
    "# Task 01: demo task",
    "",
    "## Status",
    "",
    status,
    "",
    "## Wave",
    "",
    "1",
    "",
    "## Description",
    "",
    "Adds a module next to `src/app.ts`.",
    "",
    "## Dependencies",
    "",
    "None.",
    "",
    "## Files to Modify",
    "",
    "- `src/app.ts`",
    "- `README.md`",
    "",
    "## Files to Create",
    "",
    "- `src/new-module.ts`",
    "- `src/new-module.test.ts`",
    "- `docs/notes/` (any file inside)",
    "",
    "## Technical Details",
    "",
    "Leave `src/other.ts` and `package.json` alone.",
    "",
    "## Verification",
    "",
    "`npm run verify` exits 0.",
    "",
  ].join("\n");
}

const BASE_FILES = Object.freeze({
  ".gitignore": "node_modules\n.env*\nspecs/.current-task\nspecs/.verified\nspecs/.stop-blocks\n",
  "package-lock.json": "{}\n",
  "README.md": "# fixture\n",
  "src/app.ts": "export const app = 1;\n",
  "src/app.test.ts": "// the contract\n",
  "src/other.ts": "export const other = 2;\n",
  "design/screens/S01-welcome/screen.html": "<html></html>\n",
  "specs/LEDGER.md": "# Task ledger\n\n| Task | Summary | Date | Agent / model |\n|---|---|---|---|\n| 00-setup/task-00 | Fixture row | 2026-10-21 | test |\n",
  "specs/01-demo/README.md": "# Spec 01: demo\n\n- [ ] task-01-demo\n",
  [TASK]: taskText(),
});

const configJson = (config) => `${JSON.stringify(config, null, 2)}\n`;

function packageJson(verifyScript) {
  const scripts = verifyScript === null ? {} : { verify: verifyScript };
  return `${JSON.stringify({ name: "fixture", version: "0.0.0", private: true, type: "module", scripts }, null, 2)}\n`;
}

function fixtureEnv(base) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !LOCATORS.has(key)));
  return { ...inherited, GIT_CONFIG_GLOBAL: join(base, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
}

function run(command, args, cwd, env, input) {
  const result = spawnSync(command, args, { cwd, env, input, encoding: "utf8", timeout: 60000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runChecked(command, args, cwd, env) {
  const result = run(command, args, cwd, env);
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trimEnd();
}

function writeIn(dir, rel, content) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

/** A repo on branch feat/demo, pushed to a bare remote, with no task active. `config` replaces CONFIG; null leaves the file out. */
export function createFixture({ verifyScript = 'node -e "process.exit(0)"', config = CONFIG } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "guardrails-test-")));
  const dir = join(base, "repo");
  const remote = join(base, "remote.git");
  writeFileSync(join(base, "gitconfig"), "");
  const env = fixtureEnv(base);
  const git = (...args) => runChecked("git", args, dir, env);
  mkdirSync(dir);
  const settings = config === null ? {} : { "agentkit.config.json": configJson(config) };
  const files = { ...BASE_FILES, ...settings, "package.json": packageJson(verifyScript) };
  Object.entries(files).forEach(([rel, content]) => writeIn(dir, rel, content));
  runChecked("git", ["init", "-q", "--bare", remote], base, env);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.com");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  git("remote", "add", "origin", remote);
  git("push", "-q", "-u", "origin", "main");
  git("switch", "-q", "-c", "feat/demo");
  git("push", "-q", "-u", "origin", "feat/demo");
  return fixtureApi(base, dir, env);
}

function fixtureApi(base, dir, env) {
  const hook = (script, input, cwd = dir, extraEnv = {}) =>
    run(process.execPath, [script], cwd, { ...env, ...extraEnv }, JSON.stringify(input));
  const guard = (tool, toolInput, { cwd = dir } = {}) =>
    hook(SCRIPTS.guard, { cwd, hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput }, cwd);
  return {
    dir,
    env,
    path: (rel) => join(dir, rel),
    git: (...args) => runChecked("git", args, dir, env),
    write: (rel, content) => writeIn(dir, rel, content),
    read: (rel) => readFileSync(join(dir, rel), "utf8"),
    exists: (rel) => existsSync(join(dir, rel)),
    setTask: (rel = TASK) => writeIn(dir, "specs/.current-task", `${rel}\n`),
    setStatus: (status) => writeIn(dir, TASK, taskText(status)),
    stamp: (tree) => writeIn(dir, "specs/.verified", JSON.stringify({ tree, command: "test", at: new Date().toISOString() })),
    commitAll: (message = "work") => {
      runChecked("git", ["add", "-A"], dir, env);
      runChecked("git", ["commit", "-q", "-m", message], dir, env);
    },
    hook,
    rawHook: (script, text) => run(process.execPath, [script], dir, env, text),
    guard,
    bash: (command, options) => guard("Bash", { command }, options),
    stop: () => hook(SCRIPTS.stop, { cwd: dir, hook_event_name: "Stop", stop_hook_active: false }),
    verify: ({ cwd = dir } = {}) => run(process.execPath, [SCRIPTS.verify], cwd, env),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/** The hook stayed out of the way: exit 0 and nothing on stdout, so normal permissions apply. */
export function expectSilent(result) {
  assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  assert.equal(result.stdout, "", `expected no output, got: ${result.stdout}`);
}

/** A PreToolUse denial; returns the reason. */
export function expectDeny(result, pattern) {
  assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  assert.notEqual(result.stdout, "", "expected a denial, got no output");
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
  const { hookEventName, permissionDecision, permissionDecisionReason } = output.hookSpecificOutput;
  assert.equal(hookEventName, "PreToolUse");
  assert.equal(permissionDecision, "deny");
  if (pattern) assert.match(permissionDecisionReason, pattern);
  return permissionDecisionReason;
}

/** A Stop block; returns the reason. */
export function expectBlock(result, pattern) {
  assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  assert.notEqual(result.stdout, "", "expected a block, got no output");
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, "block");
  assert.equal(typeof output.reason, "string");
  if (pattern) assert.match(output.reason, pattern);
  return output.reason;
}
