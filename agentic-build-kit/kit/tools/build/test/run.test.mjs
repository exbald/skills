import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { configText } from "./acme.mjs";

// One whole wave through the real runner, with stand-ins for OpenCode, Claude Code and gh first on the PATH: the
// builder stops early, is nudged, resumes its session, finishes and pushes; GitHub then shows an answered approval
// and green CI. The repository's agentkit.config.json names the two builders of the worked example (test/acme.mjs).
const SCRIPT = fileURLToPath(new URL("../run-wave.mjs", import.meta.url));
const TASK = "specs/09-demo/tasks/task-01-demo.md";

// What either builder does once resumed: build/spec-09-wave-06 finishes the task whose Wave is 6, commits, pushes.
const FINISH_WAVE = `function finishWave() {
  const wave = Number(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim().split("-wave-")[1]);
  const dir = "specs/09-demo/tasks";
  const task = dir + "/" + fs.readdirSync(dir).find((name) => fs.readFileSync(dir + "/" + name, "utf8").includes("## Wave\\n\\n" + wave + "\\n"));
  fs.writeFileSync(task, fs.readFileSync(task, "utf8").replace("## Status\\n\\npending", "## Status\\n\\ncomplete"));
  fs.appendFileSync("apps/a.ts", "export const a = 2;\\n");
  execFileSync("git", ["add", "-A"]);
  execFileSync("git", ["commit", "-q", "-m", "feat(spec-09): demo (task-01)"]);
  execFileSync("git", ["push", "-q", "-u", "origin", "HEAD"]);
}`;

const FAKE_OPENCODE = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
${FINISH_WAVE}
const args = process.argv.slice(2);
const resumed = args.includes("--session");
fs.appendFileSync(process.env.STUB_CALLS, JSON.stringify(args) + "\\n");
// STUB_GUARD: "missing" logs nothing about the guard, "failed" logs its failure; either way the builder then
// keeps working, as a real one would, until the runner stops it.
// "elsewhere" loads it from another checkout, as OpenCode did when it inherited the lead's PWD; "sleep" works until
// stopped.
const pluginIn = (dir) => 'level=INFO msg="loading plugin" id=' + dir + '/.opencode/plugins/guardrails.js entrypoint=file://x\\n';
if (process.env.STUB_GUARD === "failed") process.stderr.write('level=WARN message="failed to load plugin" target=/x/.opencode/plugins/guardrails.js\\n');
else if (process.env.STUB_GUARD === "elsewhere") process.stderr.write(pluginIn("/Users/someone/main-checkout"));
else if (process.env.STUB_GUARD === "alias") process.stderr.write(pluginIn(process.env.STUB_ALIAS));
else if (process.env.STUB_GUARD === "unreadable") process.stderr.write('level=INFO msg="loading plugin" id=.opencode/plugins/guardrails.js\\n');
// Like OpenCode, it works where $PWD says, not where the process stands: a runner that passed on its own PWD
// would show here as the wrong checkout.
else if (process.env.STUB_GUARD !== "missing") process.stderr.write(pluginIn(process.env.PWD));
const say = (event) => process.stdout.write(JSON.stringify({ sessionID: "ses_stub", ...event }) + "\\n");
say({ type: "step_start" });
const stalls = process.env.STUB_GUARD && process.env.STUB_GUARD !== "alias";
if (stalls) setTimeout(() => {}, 60000);
if (process.env.STUB_PIDFILE) fs.writeFileSync(process.env.STUB_PIDFILE, String(process.pid));
// STUB_FINISH_FIRST finishes on the first run, leaving the runner to wait on the reviewer bot.
if (!stalls && (resumed || process.env.STUB_FINISH_FIRST)) finishWave();
say({ type: "text", part: { type: "text", text: resumed ? "done" : "stopping early" } });
`;

// Claude Code's stream-json, as \`claude -p\` printed it live on 2026-10-23: init, the turn, then one result with
// what this run cost. --resume keeps the session id. STUB_SESSION_TOTALS makes a resumed run report the session's.
// STUB_COST_USD is what each run costs, or "first,later" for the first run and every resumed one.
const FAKE_CLAUDE = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
${FINISH_WAVE}
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_CALLS + ".claude", JSON.stringify(args) + "\\n");
const at = args.indexOf("--resume");
const resumed = at >= 0;
const say = (event) => process.stdout.write(JSON.stringify({ session_id: resumed ? args[at + 1] : "sonnet-stub", ...event }) + "\\n");
say({ type: "system", subtype: "init", cwd: process.cwd() });
// STUB_NEVER_FINISH: every run stops early, so the wave runs into its cap.
if (resumed && !process.env.STUB_NEVER_FINISH) finishWave();
const text = resumed ? "done" : "stopping early";
const [first, later = first] = String(process.env.STUB_COST_USD).split(",").map(Number);
say({ type: "assistant", message: { content: [{ type: "text", text }] } });
// STUB_SESSION_TOTALS: as Claude Code 2.1.309 does (2026-10-23), a resumed run reports the whole session, its
// total_cost_usd and modelUsage taking in the first run, while every result's usage counts only the stretch since
// the one before. The first run's first result says 41 tokens, and every later result 3.
const session = process.env.STUB_SESSION_TOTALS && resumed;
let runTokens = 0;
const result = (total) => {
  const stretch = runTokens === 0 && !resumed ? 41 : 3;
  runTokens += stretch;
  const tokens = { usage: { output_tokens: stretch }, modelUsage: { "claude-sonnet-5-5": { outputTokens: (session ? 41 : 0) + runTokens } } };
  // STUB_SESSION_SHRINKS: a resume's tokens say "session" but its total leaves the first run out, as a changed
  // output format might.
  const earlier = session && !process.env.STUB_SESSION_SHRINKS ? first : 0;
  say({ type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: earlier + total, result: text, ...(process.env.STUB_SESSION_TOTALS ? tokens : {}) });
};
// STUB_RUNNING_TOTALS: every run prints a result for each of these before its last one, as \`claude -p\` does each
// time background work wakes it. Each reports the run's total so far, not what that turn cost.
if (process.env.STUB_RUNNING_TOTALS) {
  for (const total of process.env.STUB_RUNNING_TOTALS.split(",").map(Number)) result(total);
}
// STUB_NO_RESULT: a run that ends without its result event, as one stopped mid-turn would.
if (!process.env.STUB_NO_RESULT) result(resumed ? later : first);
`;

// npm ci, as the runner calls it in a checkout with a lockfile: done at once, or with STUB_NPM_PIDFILE set, a long
// install that records its pid and waits to be stopped. It notes its arguments, where it was started, what PWD said,
// any CLAUDE_PROJECT_DIR it was left, which would point at the launching session's checkout, and the npmrc it was
// told to use (build.installEnv).
const FAKE_NPM = `#!/usr/bin/env node
const fs = require("node:fs");
// STUB_NPM_FAIL: an install that prints far more than 4 KB, with markers at both ends, and fails.
if (process.env.STUB_NPM_FAIL) {
  process.stderr.write("npm-output-starts\\n" + "npm warn filler line\\n".repeat(400) + "npm error the install failed\\n");
  process.exit(1);
}
const record = { args: process.argv.slice(2), cwd: process.cwd(), pwd: process.env.PWD, project: process.env.CLAUDE_PROJECT_DIR ?? null, userconfig: process.env.npm_config_userconfig ?? null };
fs.appendFileSync(process.env.STUB_CALLS + ".npm", JSON.stringify(record) + "\\n");
if (process.env.STUB_NPM_PIDFILE) {
  fs.writeFileSync(process.env.STUB_NPM_PIDFILE, String(process.pid));
  setTimeout(() => {}, 60000);
}
`;

const FAKE_GH = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
const print = (value) => process.stdout.write(JSON.stringify(value));
// The PR is the one for the branch the runner asks about (--head), numbered by its wave; its head is what was pushed.
const fs = require("node:fs");
const state = process.env.STUB_REMOTE + ".branch";
if (args[0] === "pr") fs.writeFileSync(state, args[args.indexOf("--head") + 1]);
const branch = fs.existsSync(state) ? fs.readFileSync(state, "utf8") : "";
let head = null;
try {
  head = execFileSync("git", ["--git-dir", process.env.STUB_REMOTE, "rev-parse", "refs/heads/" + branch], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {}
const iso = (ago) => new Date(Date.now() - ago).toISOString();
if (args[0] === "pr") {
  if (head) print({ number: 7, headRefOid: head, createdAt: iso(600000), mergeable: "MERGEABLE", statusCheckRollup: [{ __typename: "CheckRun", workflowName: "verify", name: "verify", status: "COMPLETED", conclusion: "SUCCESS" }] });
} else if (args[1].includes("/reviews")) print(process.env.STUB_REVIEWS === "none" ? [] : [{ login: "acme-review-bot[bot]", state: "APPROVED", commit: head, at: iso(120000) }]);
else if (args[1].includes("/issues/")) print([{ login: "ada", body: "Answered every note.", at: iso(60000) }]);
else print([]);
`;

describe("a whole wave through the runner", () => {
  let base;
  let env;
  let root;
  before(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "run-wave-e2e-")));
    const remote = join(base, "remote.git");
    root = join(base, "repo");
    const bin = join(base, "bin");
    mkdirSync(bin);
    writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Stub\n\temail = stub@example.com\n");
    env = { ...process.env, GIT_CONFIG_GLOBAL: join(base, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", STUB_REMOTE: remote, STUB_CALLS: join(base, "calls.jsonl"), PATH: `${bin}:${process.env.PATH}` };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "CLAUDE_PROJECT_DIR"]) delete env[key];
    // `npm run verify` exports npm's own settings as npm_config_* to everything it starts, these tests included. The
    // install's environment is checked for what the runner adds, so none of npm's may come in from outside.
    for (const key of Object.keys(env).filter((name) => name.toLowerCase().startsWith("npm_config_"))) delete env[key];
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, stdio: "ignore" });
    for (const [name, source] of [["opencode", FAKE_OPENCODE], ["claude", FAKE_CLAUDE], ["gh", FAKE_GH], ["npm", FAKE_NPM]]) {
      writeFileSync(join(bin, name), source);
      chmodSync(join(bin, name), 0o755);
    }
    git(base, "init", "-q", "--bare", remote);
    mkdirSync(join(root, "specs/09-demo/tasks"), { recursive: true });
    mkdirSync(join(root, "apps"));
    writeFileSync(join(root, TASK), ["# Task 01: demo", "", "## Status", "", "pending", "", "## Wave", "", "1", "", "## Files to Modify", "", "- `apps/a.ts`", ""].join("\n"));
    for (const wave of [2, 3, 4, 5, 6, 7, 8, 9]) {
      writeFileSync(join(root, `specs/09-demo/tasks/task-0${wave}-guard.md`), ["# Task: guard", "", "## Status", "", "pending", "", "## Wave", "", String(wave), "", "## Files to Modify", "", "- `apps/a.ts`", ""].join("\n"));
    }
    for (const wave of [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
      writeFileSync(join(root, `specs/09-demo/tasks/task-${wave}-sonnet.md`), ["# Task: sonnet", "", "## Status", "", "pending", "", "## Wave", "", String(wave), "", "## Files to Modify", "", "- `apps/a.ts`", ""].join("\n"));
    }
    writeFileSync(join(root, "agentkit.config.json"), configText());
    // A Claude Code builder starts only where Claude Code's settings run the guard (hooksWired).
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, ".claude/settings.json"), `${JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "node tools/guardrails/hooks/guard.mjs" }] }] } })}\n`);
    writeFileSync(join(root, "specs/09-demo/README.md"), "# Spec 09\n");
    writeFileSync(join(root, "apps/a.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "initial");
    git(root, "remote", "add", "origin", remote);
    git(root, "push", "-q", "-u", "origin", "main");
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  it("nudges a builder that stopped early, resumes its session, and exits done once the PR is ready", () => {
    // Started from a Claude Code session, as the lead starts it: nothing of that session reaches the wave.
    const launcher = { ...env, CLAUDE_PROJECT_DIR: "/Users/someone/main-checkout" };
    const result = spawnSync(process.execPath, [SCRIPT, "--root", root, "--spec", "specs/09-demo", "--wave", "1", "--builder", "glm"], { env: launcher, encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /GLM 5\.3 \(max\) starts/);
    assert.match(result.stdout, /nudge 1: task-01 isn't complete/);
    assert.match(result.stdout, /resumes session ses_stub/);
    assert.match(result.stdout, /done: PR #7 is approved on its head, answered, and green/);
    const calls = readFileSync(env.STUB_CALLS, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes("--standalone") && calls[0].includes("--print-logs"));
    assert.deepEqual(calls[1].slice(calls[1].indexOf("--session"), calls[1].indexOf("--session") + 2), ["--session", "ses_stub"]);
    const checkout = join(`${root}-builds`, "build-spec-09-wave-01");
    const [install] = readFileSync(`${env.STUB_CALLS}.npm`, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(install, { args: ["ci", "--no-audit", "--no-fund"], cwd: checkout, pwd: checkout, project: null, userconfig: null }, "npm ci runs in the wave's checkout, PWD says so too, and nothing points back");
    assert.match(readFileSync(join(checkout, TASK), "utf8"), /## Status\n\ncomplete/);
    assert.match(readFileSync(`${checkout}.log`, "utf8"), /done: PR #7/);
    assert.throws(() => readFileSync(`${checkout}.pid`), /ENOENT/, "the runner releases its claim on exit");
  });

  const sonnet = (wave, budget, costUsd, extraEnv = {}) =>
    spawnSync(process.execPath, [SCRIPT, "--root", root, "--spec", "specs/09-demo", "--wave", String(wave), "--builder", "sonnet", "--budget", String(budget)], {
      env: { ...env, STUB_COST_USD: String(costUsd), ...extraEnv },
      encoding: "utf8",
      timeout: 120_000,
    });
  // Every claude call so far; none before the first Sonnet run, so each test stands on its own.
  const sonnetCalls = () => {
    const file = `${env.STUB_CALLS}.claude`;
    return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  };
  const flag = (call, name) => call[call.indexOf(name) + 1];

  it("runs a Claude Code builder the same way, resumed with --resume, each run capped at what the wave has left", () => {
    const result = sonnet(10, 10, 0.5);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Sonnet 5\.5 \(high\) starts/);
    assert.match(result.stdout, /the builder stopped \(exit 0, \$0\.50 spent\)/);
    assert.match(result.stdout, /resumes session sonnet-stub/);
    assert.match(result.stdout, /the builder stopped \(exit 0, \$1\.00 spent\)/, "both runs counted");
    assert.match(result.stdout, /done: PR #7/);
    const calls = sonnetCalls();
    assert.equal(calls.length, 2);
    assert.equal(flag(calls[0], "--model"), "claude-sonnet-5-5");
    assert.ok(calls[0].includes("--dangerously-skip-permissions") && !calls[0].includes("--resume"));
    assert.equal(flag(calls[0], "--max-budget-usd"), "10.00");
    assert.equal(flag(calls[1], "--resume"), "sonnet-stub");
    assert.equal(flag(calls[1], "--max-budget-usd"), "9.50", "the second run may spend only what's left");
  });

  it("counts a run that reports its cost several times once, at its highest total, resumed or not", () => {
    // A live wave (2026-10-23): one run printed six results, $7.63 up to $9.98, and summed they read as $55.13.
    // Each run here prints 0.3 and 0.6, then ends on 0.5: the highest, not the last, so the cap errs toward stopping.
    const before = sonnetCalls().length;
    const result = sonnet(16, 10, 0.5, { STUB_RUNNING_TOTALS: "0.3,0.6" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /the builder stopped \(exit 0, \$0\.60 spent\)/);
    assert.match(result.stdout, /the builder stopped \(exit 0, \$1\.20 spent\)/, "the resumed run adds its own highest total");
    const calls = sonnetCalls().slice(before);
    assert.equal(flag(calls[1], "--max-budget-usd"), "9.40", "the second run may spend what the first left");
  });

  it("counts a resumed run that reports the whole session's cost only for what it added", () => {
    // Another live wave (2026-10-23): the first run reported $6.26, and the resume that answered one review $6.48,
    // the session's total. Added up, they read as $12.74.
    const before = sonnetCalls().length;
    const result = sonnet(17, 10, "0.5,0.3", { STUB_SESSION_TOTALS: "1" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /the builder stopped \(exit 0, \$0\.50 spent\)/);
    assert.match(result.stdout, /the builder stopped \(exit 0, \$0\.80 spent\)/, "the resume reported $0.80 for the session, $0.30 of it its own");
    const calls = sonnetCalls().slice(before);
    assert.equal(flag(calls[1], "--max-budget-usd"), "9.50", "the cap holds a run to its own spend, so a resume gets what the wave has left");
  });

  it("counts a resumed run's own cost when it also prints running totals for the session", () => {
    // Both runs print 0.1 and 0.2 of their own before their last total. The resume's results read 0.6, 0.7 and 0.8.
    const before = sonnetCalls().length;
    const result = sonnet(18, 10, "0.5,0.3", { STUB_SESSION_TOTALS: "1", STUB_RUNNING_TOTALS: "0.1,0.2" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /the builder stopped \(exit 0, \$0\.50 spent\)/);
    assert.match(result.stdout, /the builder stopped \(exit 0, \$0\.80 spent\)/);
    assert.doesNotMatch(result.stdout, /warning: the resumed run reported/);
    assert.equal(flag(sonnetCalls().slice(before)[1], "--max-budget-usd"), "9.50");
  });

  it("counts all of a resumed run whose session total shrank, and says so", () => {
    const result = sonnet(19, 10, "0.5,0.3", { STUB_SESSION_TOTALS: "1", STUB_SESSION_SHRINKS: "1" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /warning: the resumed run reported \$0\.30 for its session, under the \$0\.50 it had spent, so all of it counts/);
    assert.match(result.stdout, /the builder stopped \(exit 0, \$0\.80 spent\)/);
  });

  it("hands a Claude Code wave that reached its cap with work left to the lead, without another run", () => {
    const before = sonnetCalls().length;
    const result = sonnet(11, 1, 1.2);
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /escalate: Sonnet 5\.5 \(high\) spent \$1\.20, and the wave's cap is \$1\.00\. Left: /);
    assert.equal(sonnetCalls().length, before + 1);
  });

  it("hands the wave to the lead when a Claude Code run never said what it cost, rather than guess what's left", () => {
    const before = sonnetCalls().length;
    const result = sonnet(14, 10, 0.5, { STUB_NO_RESULT: "1" });
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /escalate: Sonnet 5\.5 \(high\)'s run ended without reporting what it cost, so another run can't be held to the wave's \$10\.00 cap \(\$0\.00 reported so far\)/);
    assert.equal(sonnetCalls().length, before + 1, "no second run");
  });

  it("meets the cap in whole cents, however the runs' costs add up in floating point", () => {
    // 0.7 + 0.1 is 0.7999999999999999 in floating point: compared raw, it's under a $0.80 cap and a third run
    // would start with $0.00 to spend. In cents, the wave has spent exactly its cap after two runs.
    const before = sonnetCalls().length;
    const result = sonnet(15, 0.8, "0.7,0.1", { STUB_NEVER_FINISH: "1" });
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /escalate: Sonnet 5\.5 \(high\) spent \$0\.80, and the wave's cap is \$0\.80\./);
    assert.equal(sonnetCalls().length, before + 2);
  });

  // The guard's whole point: an OpenCode builder never works unguarded. One wave each, so the checkouts don't meet.
  const guarded = (wave, guard) =>
    spawnSync(process.execPath, [SCRIPT, "--root", root, "--spec", "specs/09-demo", "--wave", String(wave), "--builder", "glm"], {
      env: { ...env, STUB_GUARD: guard, RUN_WAVE_GUARD_LOAD_MS: "1500" },
      encoding: "utf8",
      timeout: 120_000,
    });

  it("stops an OpenCode builder and hands the wave to the lead when OpenCode never says it loaded the guard", () => {
    const result = guarded(2, "missing");
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /didn't log loading the guard plugin within 1\.5 seconds/);
    assert.match(result.stdout, /escalate: OpenCode didn't show the guard plugin loaded/);
  });

  it("stops an OpenCode builder when OpenCode loads the guard from another checkout, since it isn't working in the wave's", () => {
    const result = guarded(4, "elsewhere");
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /loaded the guard plugin from \/Users\/someone\/main-checkout, not the wave's checkout/);
  });

  it("accepts the wave's own checkout however OpenCode spells its path, through a link included", () => {
    const checkout = join(`${root}-builds`, "build-spec-09-wave-06");
    const alias = join(base, "alias-to-wave-06");
    symlinkSync(checkout, alias);
    const result = spawnSync(process.execPath, [SCRIPT, "--root", root, "--spec", "specs/09-demo", "--wave", "6", "--builder", "glm"], {
      env: { ...env, STUB_GUARD: "alias", STUB_ALIAS: alias, RUN_WAVE_GUARD_LOAD_MS: "1500" },
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(result.stdout, /not the wave's checkout/);
    assert.match(result.stdout, /done: PR #7/);
  });

  it("takes the builder down when the runner itself is stopped, and releases the wave", async () => {
    const builderPid = join(base, "builder.pid");
    const runner = spawn(process.execPath, [SCRIPT, "--root", root, "--spec", "specs/09-demo", "--wave", "5", "--builder", "glm"], {
      env: { ...env, STUB_GUARD: "sleep", STUB_PIDFILE: builderPid },
      stdio: "ignore",
    });
    const exited = new Promise((resolve) => runner.on("exit", (exitCode) => resolve(exitCode)));
    const checkout = join(`${root}-builds`, "build-spec-09-wave-05");
    for (let tries = 0; tries < 100 && !existsSync(builderPid); tries += 1) await sleep(100);
    assert.ok(existsSync(builderPid), "the stand-in builder started");
    runner.kill("SIGTERM");
    const code = await exited;
    assert.equal(code, 143);
    const pid = Number(readFileSync(builderPid, "utf8"));
    // The SIGKILL lands just before the runner exits; give the system a moment to reap it.
    const gone = async () => {
      for (let tries = 0; tries < 20; tries += 1) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (error.code === "ESRCH") return true;
        }
        await sleep(100);
      }
      return false;
    };
    assert.equal(await gone(), true, "the builder is gone");
    assert.equal(existsSync(`${checkout}.pid`), false, "the wave is released");
    // Its builder dies within the grace period, but no builder takes its place: no nudge, no resume.
    const calls = readFileSync(env.STUB_CALLS, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(calls.filter((args) => args.includes("build/spec-09-wave-05")).length, 1, "one builder, never resumed after the signal");
    const afterSignal = readFileSync(`${checkout}.log`, "utf8").split("the runner got SIGTERM")[1];
    assert.doesNotMatch(afterSignal, /nudge|resumes session/);
  });

  it("never takes an unreadable guard path on trust: the wait runs out and the OpenCode builder is stopped", () => {
    const result = guarded(7, "unreadable");
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /didn't log loading the guard plugin within 1\.5 seconds/);
  });

  // Starts the runner on a wave, waits for `pidfile` to name the process to stop, sends `signal`, and reports.
  async function stopRunner(wave, signal, extraEnv, pidfile) {
    const runner = spawn(process.execPath, [SCRIPT, "--root", root, "--spec", "specs/09-demo", "--wave", String(wave), "--builder", "glm"], { env: { ...env, ...extraEnv }, stdio: "ignore" });
    // Listened for from the start: a runner that ends on its own before the signal must not hang the test.
    const exited = new Promise((resolve) => runner.on("exit", (exitCode) => resolve(exitCode)));
    for (let tries = 0; tries < 100 && !existsSync(pidfile); tries += 1) await sleep(100);
    assert.ok(existsSync(pidfile), "the process to stop started");
    runner.kill(signal);
    const code = await exited;
    const pid = Number(readFileSync(pidfile, "utf8"));
    let gone = false;
    for (let tries = 0; tries < 20 && !gone; tries += 1) {
      try {
        process.kill(pid, 0);
        await sleep(100);
      } catch (error) {
        gone = error.code === "ESRCH";
      }
    }
    return { code, gone, released: !existsSync(join(`${root}-builds`, `build-spec-09-wave-0${wave}.pid`)) };
  }

  it("on Ctrl-C too: the builder goes, the wave is released, and the runner exits 130", async () => {
    const pidfile = join(base, "builder-int.pid");
    assert.deepEqual(await stopRunner(8, "SIGINT", { STUB_GUARD: "sleep", STUB_PIDFILE: pidfile }, pidfile), { code: 130, gone: true, released: true });
  });

  it("keeps all of a failed install's output in the wave's stderr log, and names that file", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--root", root, "--spec", "specs/09-demo", "--wave", "13", "--builder", "glm"], {
      env: { ...env, STUB_NPM_FAIL: "1" },
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const checkout = join(`${root}-builds`, "build-spec-09-wave-13");
    const kept = readFileSync(`${checkout}.stderr.log`, "utf8");
    assert.ok(kept.startsWith("npm-output-starts\n") && kept.endsWith("npm error the install failed\n"), "the whole output, not the last 4 KB");
    assert.ok(kept.length > 4096);
    assert.ok(result.stderr.includes(`npm ci --no-audit --no-fund failed (all of its output is in ${checkout}.stderr.log)`), result.stderr);
    assert.match(result.stderr, /npm error the install failed/);
    assert.equal(existsSync(`${checkout}.pid`), false, "the wave is released");
  });

  it("stops at once when nothing is running, such as while it waits on the reviewer bot", async () => {
    const runner = spawn(process.execPath, [SCRIPT, "--root", root, "--spec", "specs/09-demo", "--wave", "12", "--builder", "glm"], {
      env: { ...env, STUB_FINISH_FIRST: "1", STUB_REVIEWS: "none" },
      stdio: "ignore",
    });
    const exited = new Promise((resolve) => runner.on("exit", (exitCode) => resolve(exitCode)));
    const log = join(`${root}-builds`, "build-spec-09-wave-12.log");
    const waiting = () => existsSync(log) && readFileSync(log, "utf8").includes("Waiting for the review bot's review of PR #7.");
    for (let tries = 0; tries < 100 && !waiting(); tries += 1) await sleep(100);
    assert.ok(waiting(), "the runner waits on the reviewer bot, with no builder running");
    const sent = Date.now();
    runner.kill("SIGTERM");
    assert.equal(await exited, 143);
    assert.ok(Date.now() - sent < 2_500, `no five-second wait for a builder that isn't there (${Date.now() - sent} ms)`);
    assert.equal(existsSync(join(`${root}-builds`, "build-spec-09-wave-12.pid")), false, "the wave is released");
  });

  it("stopped mid-install, the runner takes npm ci down with it", async () => {
    const pidfile = join(base, "npm.pid");
    assert.deepEqual(await stopRunner(9, "SIGTERM", { STUB_NPM_PIDFILE: pidfile }, pidfile), { code: 143, gone: true, released: true });
  });

  it("installs with the config's build.install and build.installEnv instead of plain npm ci", () => {
    const file = join(root, "agentkit.config.json");
    const before = readFileSync(file, "utf8");
    const installs = () => readFileSync(`${env.STUB_CALLS}.npm`, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const count = installs().length;
    try {
      // The runner reads the repository's own config, not the checkout's, so a working-tree change is enough here.
      writeFileSync(file, configText({ build: { install: ["npm", "ci", "--prefer-offline"], installEnv: { npm_config_userconfig: "/dev/null" } } }));
      const result = spawnSync(process.execPath, [SCRIPT, "--root", root, "--spec", "specs/09-demo", "--wave", "20", "--builder", "glm"], { env, encoding: "utf8", timeout: 120_000 });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    } finally {
      writeFileSync(file, before);
    }
    const [install, ...more] = installs().slice(count);
    assert.equal(more.length, 0);
    assert.deepEqual(install.args, ["ci", "--prefer-offline"]);
    assert.equal(install.userconfig, "/dev/null");
    assert.equal(install.cwd, join(`${root}-builds`, "build-spec-09-wave-20"));
  });

  it("stops an OpenCode builder at once when OpenCode says the guard failed to load", () => {
    const result = guarded(3, "failed");
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /says the guard plugin failed to load/);
    assert.match(result.stdout, /escalate: OpenCode didn't show the guard plugin loaded/);
  });
});
