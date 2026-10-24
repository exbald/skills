import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nudgeMessage, waveBrief } from "../lib/brief.mjs";
import { REVIEW_WAIT_MS } from "../lib/wave.mjs";
import { builderCommand, builderEnv, builderLabel, costOf, hooksWired, includesEarlierRuns, parseEvent, sessionOf } from "../lib/builders.mjs";
import { ciState, reviewFacts } from "../lib/github.mjs";
import { commandLimitMs, commandShells, descendants, elapsedMs, guardCheckout, guardFailedToLoad, guardLoaded, IDLE_MS, idleAction, LONG_COMMAND_MS, parsePs } from "../lib/processes.mjs";
import { BUILDERS, REVIEWER } from "./acme.mjs";

const MIN = 60_000;

describe("the builder's processes", () => {
  it("reads ps's elapsed times", () => {
    assert.equal(elapsedMs("05:06"), (5 * 60 + 6) * 1000);
    assert.equal(elapsedMs("01:02:03"), (3600 + 120 + 3) * 1000);
    assert.equal(elapsedMs("2-01:00:00"), (2 * 24 + 1) * 3600 * 1000);
    assert.ok(Number.isNaN(elapsedMs("garbage")), "unreadable, never \"just started\"");
  });

  // The runner (100) starts OpenCode (200), whose private server (300) runs a shell command (400 -> 401),
  // an MCP server (500) with its own shell (600), and a language server (700).
  const ps = [
    "  200   100       20:00 opencode run --standalone -m zai-coding-plan/glm-5.3#max",
    "  300   200       20:00 /opt/homebrew/bin/opencode serve --stdio --port 0",
    "  400   300       12:00 /bin/zsh -c npm run dev",
    "  401   400       12:00 node node_modules/.bin/vite",
    "  500   300       20:00 node /Users/x/.npm/_npx/mcp-server/index.js",
    "  600   500       20:00 sh -c sleep 99999",
    "  700   300       20:00 typescript-language-server --stdio",
  ].join("\n");

  it("counts fish and nu as shells too, for a builder whose shell is one of them", () => {
    const rows = parsePs("  200   100   20:00 opencode run\n  410   200   12:00 /opt/homebrew/bin/fish -c npm run dev\n  420   200   11:00 nu -c ls");
    assert.deepEqual(commandShells(rows, 200).map((shell) => shell.pid), [410, 420]);
  });

  it("finds the commands the builder ran, and never its helpers' shells", () => {
    const shells = commandShells(parsePs(ps), 200);
    assert.deepEqual(shells.map((shell) => shell.pid), [400]);
    assert.equal(shells[0].elapsedMs, 12 * MIN);
  });

  // Captured live on 2026-10-23 (paths shortened): `claude -p` (200) with its MCP servers started through npx, and
  // the Bash tool's command (400), which Claude Code wraps in a zsh that sources its shell snapshot and evals it.
  const claudePs = [
    "  200   100       00:20 claude -p --model claude-sonnet-5-5 --effort high --output-format stream-json --verbose",
    "  300   200       00:19 npm exec resend-mcp",
    "  310   300       00:12 node /Users/x/.npm/_npx/5b00477b7fe701ab/node_modules/.bin/resend-mcp",
    "  320   200       00:19 npm exec @z_ai/mcp-server",
    "  330   320       00:18 node /Users/x/.npm/_npx/aefbec131226782c/node_modules/.bin/zai-mcp-server",
    "  400   200       12:00 /bin/zsh -c source '/Users/x/.claude/shell-snapshots/snapshot-zsh-1.sh' 2>/dev/null || true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null || true && eval 'npm ci' < /dev/null && pwd -P >| /tmp/claude-becf-cwd",
    "  401   400       12:00 npm ci",
  ].join("\n");

  it("finds the command Sonnet ran under Claude Code, and reads it inside Claude Code's wrapper", () => {
    const shells = commandShells(parsePs(claudePs), 200);
    assert.deepEqual(shells.map((shell) => shell.pid), [400]);
    assert.equal(commandLimitMs(shells[0].command), LONG_COMMAND_MS, "an install, though it sits inside eval '…'");
    const dev = claudePs.replace("eval 'npm ci'", "eval 'npm run dev'");
    assert.equal(commandLimitMs(commandShells(parsePs(dev), 200)[0].command), IDLE_MS);
  });

  it("never takes a helper for the harness because its path mentions one", () => {
    const rows = parsePs([
      "  200   100   20:00 claude -p --model claude-sonnet-5-5",
      "  300   200   20:00 node /Users/x/.claude/plugins/cache/p/server.js",
      "  310   300   20:00 sh -c sleep 99999",
      "  400   200   20:00 node /tmp/bin/opencode run",
      "  410   400   12:00 /bin/zsh -c npm run dev",
      "  500   200   20:00 /opt/tools/OpenCode serve",
      "  510   500   11:00 sh -c npm test",
    ].join("\n"));
    assert.deepEqual(commandShells(rows, 200).map((shell) => shell.pid), [410, 510], "the plugin's shell is its own; a scripted harness, or one in capitals, still counts");
  });

  it("waits while the builder talks or a command is still young", () => {
    assert.equal(idleAction({ quietMs: IDLE_MS - 1, shells: [], awaitingReview: false }).kind, "wait");
    assert.equal(idleAction({ quietMs: IDLE_MS, shells: [{ pid: 9, elapsedMs: MIN, command: "sh -c ls" }], awaitingReview: false }).kind, "wait");
  });

  it("stops a command that has run over 10 minutes, unless it's the builder waiting on the reviewer bot", () => {
    const shells = commandShells(parsePs(ps), 200);
    assert.deepEqual(idleAction({ quietMs: IDLE_MS, shells, awaitingReview: false }), { kind: "stop-commands", pids: [400] });
    assert.equal(idleAction({ quietMs: IDLE_MS, shells, awaitingReview: true }).kind, "wait");
    assert.equal(idleAction({ quietMs: IDLE_MS, shells: [], awaitingReview: true }).kind, "wait", "between two polls for the bot's review");
  });

  it("gives installs, builds and the test suite 30 minutes before they count as hung", () => {
    for (const command of ["/bin/zsh -c npm ci", "bash -c node tools/guardrails/verify.mjs", "sh -c npm run verify", "zsh -c npx vitest run", "sh -c npm test -w @acme/app"]) {
      assert.equal(commandLimitMs(command), LONG_COMMAND_MS, command);
    }
    assert.equal(commandLimitMs("/bin/zsh -c npm run dev"), IDLE_MS);
    const install = { pid: 7, elapsedMs: 12 * MIN, command: "/bin/zsh -c npm ci" };
    assert.equal(idleAction({ quietMs: IDLE_MS, shells: [install], awaitingReview: false }).kind, "wait");
    assert.equal(idleAction({ quietMs: IDLE_MS, shells: [{ ...install, elapsedMs: LONG_COMMAND_MS }], awaitingReview: false }).kind, "stop-commands");
  });

  it("gives the project's own slow commands (build.longCommands) 30 minutes too, matched as whole words", () => {
    const longCommands = ["expo export", "./gradlew assembleRelease"];
    const wrapped = "/bin/zsh -c source '/Users/x/.claude/shell-snapshots/snapshot-zsh-1.sh' 2>/dev/null || true && eval 'npx expo export --platform android' < /dev/null";
    assert.equal(commandLimitMs(wrapped, longCommands), LONG_COMMAND_MS, "inside Claude Code's wrapper");
    assert.equal(commandLimitMs("sh -c ./gradlew assembleRelease", longCommands), LONG_COMMAND_MS);
    assert.equal(commandLimitMs(wrapped), IDLE_MS, "not long unless the config says so");
    assert.equal(commandLimitMs("sh -c npx expo exporter", longCommands), IDLE_MS, "a longer word isn't the command");
    const export_ = { pid: 8, elapsedMs: 12 * MIN, command: "sh -c npx expo export" };
    assert.equal(idleAction({ quietMs: IDLE_MS, shells: [export_], awaitingReview: false }).kind, "stop-commands");
    assert.equal(idleAction({ quietMs: IDLE_MS, shells: [export_], awaitingReview: false, longCommands }).kind, "wait");
  });

  it("spots OpenCode's log line for a guard plugin that didn't load", () => {
    const failed = 'level=WARN message="failed to load plugin" target=/x/repo/.opencode/plugins/guardrails.js ref=err_1 cause="Cause(...)"';
    assert.equal(guardFailedToLoad(failed), true);
    assert.equal(guardFailedToLoad('msg="loading plugin" id=/x/repo/.opencode/plugins/guardrails.js'), false);
    assert.equal(guardFailedToLoad('message="failed to load plugin" target=/Users/x/.config/opencode/plugins/other.js'), false);
  });

  it("knows OpenCode loaded the guard only from its loading line, with no failure after it", () => {
    const loading = 'level=INFO msg="loading plugin" id=/x/repo/.opencode/plugins/guardrails.js entrypoint=file:///x';
    assert.equal(guardLoaded(loading), true);
    assert.equal(guardLoaded(`${loading}\nlevel=WARN message="failed to load plugin" target=/x/repo/.opencode/plugins/guardrails.js`), false);
    assert.equal(guardLoaded('msg="loading plugin" id=/Users/x/.config/opencode/plugins/other.js'), false);
    assert.equal(guardLoaded(""), false);
  });

  it("reads which checkout OpenCode loaded the guard from", () => {
    assert.equal(guardCheckout('msg="loading plugin" id=/Users/x/acme/.opencode/plugins/guardrails.js entrypoint=file:///x'), "/Users/x/acme");
    assert.equal(guardCheckout('msg="loading plugin" id=/Users/x/.config/opencode/plugins/shared-memory.ts'), null);
    assert.equal(guardCheckout('msg="loading plugin" id="/Users/x/My Builds/wave/.opencode/plugins/guardrails.js" entrypoint=x'), "/Users/x/My Builds/wave");
    const both = 'msg="loading plugin" id=/Users/x/.config/opencode/plugins/shared-memory.ts\nmsg="loading plugin" id=/Users/x/wave/.opencode/plugins/guardrails.js';
    assert.equal(guardCheckout(both), "/Users/x/wave", "another plugin's line first");
    assert.equal(guardCheckout('msg="loading plugin" id=.opencode/plugins/guardrails.js'), null, "a relative path names no checkout");
  });

  it("reaches everything a hung command started, and nothing beside it", () => {
    const rows = parsePs(ps);
    assert.deepEqual(descendants(rows, [400]), [400, 401]);
    assert.deepEqual(descendants(rows, [300]).sort((a, b) => a - b), [300, 400, 401, 500, 600, 700]);
    assert.deepEqual(descendants(rows, [999]), [999]);
  });

  it("restarts a builder that's silent with nothing running", () => {
    assert.equal(idleAction({ quietMs: IDLE_MS, shells: [], awaitingReview: false }).kind, "restart");
  });
});

describe("the builders", () => {
  it("runs an OpenCode builder (GLM 5.3 at max) on a private OpenCode server, and resumes its session", () => {
    const { command, args } = builderCommand(BUILDERS.glm, { message: "go", title: "build/spec-02-wave-01" });
    assert.equal(command, "opencode");
    assert.deepEqual(args.slice(0, 8), ["run", "--standalone", "--print-logs", "-m", "zai-coding-plan/glm-5.3#max", "--auto", "--format", "json"]);
    assert.equal(args.at(-1), "go");
    assert.deepEqual(builderCommand(BUILDERS.glm, { message: "on", session: "ses_1" }).args.slice(-3), ["--session", "ses_1", "on"]);
  });

  it("runs a Claude Code builder (Sonnet at high effort) under a spend cap, and resumes its session", () => {
    const { command, args } = builderCommand(BUILDERS.sonnet, { message: "go", budgetUsd: 7.5 });
    assert.equal(command, "claude");
    assert.ok(args.includes("--effort") && args[args.indexOf("--effort") + 1] === "high");
    assert.equal(args[args.indexOf("--model") + 1], "claude-sonnet-5-5", "the config's pinned id, never the moving alias");
    assert.equal(args[args.indexOf("--max-budget-usd") + 1], "7.50");
    assert.deepEqual(builderCommand(BUILDERS.sonnet, { message: "on", session: "abc" }).args.slice(-3), ["--resume", "abc", "on"]);
    assert.ok(!builderCommand({ harness: "claude", model: "claude-opus-5-5" }, { message: "go" }).args.includes("--effort"), "no effort unless the config gives one");
    assert.throws(() => builderCommand({ harness: "grok", model: "grok-4.7" }, { message: "go" }), /Unknown harness "grok"/);
  });

  it("names a builder by its label, or by its name and model", () => {
    assert.equal(builderLabel("glm", BUILDERS.glm), "GLM 5.3 (max)");
    assert.equal(builderLabel("opus", { harness: "claude", model: "claude-opus-5-5" }), "opus (claude-opus-5-5)");
  });

  it("knows a checkout whose Claude Code settings run the guard, which a Claude Code builder needs", () => {
    assert.equal(hooksWired(new URL("../../..", import.meta.url).pathname), true, "this repository");
    assert.equal(hooksWired("/nonexistent"), false);
  });

  it("leaves out what ties the builder to the session that launched it", () => {
    const env = builderEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_PROJECT_DIR: "/main", GIT_DIR: "/x/.git", GIT_PREFIX: "a/", GIT_COMMON_DIR: "/x", HOME: "/h", PWD: "/main" }, "/builds/wave");
    assert.deepEqual(env, { PATH: "/bin", HOME: "/h", PWD: "/builds/wave" }, "PWD is the wave's checkout, never the launcher's");
    for (const checkout of [undefined, "", "builds/wave"]) {
      assert.throws(() => builderEnv({ PWD: "/main" }, checkout), /needs the checkout's absolute path/, "never PWD: undefined or a relative path");
    }
  });

  it("reads the session and the cost from either builder's events", () => {
    assert.equal(sessionOf(parseEvent('{"type":"text","sessionID":"ses_9","part":{}}')), "ses_9");
    assert.equal(sessionOf(parseEvent('{"type":"system","subtype":"init","session_id":"abc"}')), "abc");
    assert.equal(costOf(parseEvent('{"type":"result","total_cost_usd":1.75}')), 1.75);
    assert.equal(costOf(parseEvent('{"type":"text"}')), 0);
    assert.equal(parseEvent("not json"), null);
  });

  it("tells a result that counts the session's earlier runs from one that counts the run alone", () => {
    // A live wave's two results (2026-10-23): the first run, then the resume, whose totals include the first.
    const first = { type: "result", total_cost_usd: 6.26, usage: { output_tokens: 141325 }, modelUsage: { "claude-sonnet-5-5": { outputTokens: 141325 } } };
    const resumed = { type: "result", total_cost_usd: 6.48, usage: { output_tokens: 2556 }, modelUsage: { "claude-sonnet-5-5": { outputTokens: 143881 } } };
    assert.equal(includesEarlierRuns(first), false);
    assert.equal(includesEarlierRuns(resumed), true);
    // Every model's tokens count toward the session's.
    const twoModels = { a: { outputTokens: 100 }, b: { outputTokens: 50 } };
    assert.equal(includesEarlierRuns({ type: "result", total_cost_usd: 1, usage: { output_tokens: 120 }, modelUsage: twoModels }), true);
    assert.equal(includesEarlierRuns({ type: "result", total_cost_usd: 1, usage: { output_tokens: 150 }, modelUsage: twoModels }), false);
    // No signal: the runner waits for a result that has both, and a run without one counts its total as its own.
    assert.equal(includesEarlierRuns({ type: "result", total_cost_usd: 0.5 }), null, "no modelUsage");
    assert.equal(includesEarlierRuns({ type: "result", total_cost_usd: 0.5, modelUsage: twoModels }), null, "no usage");
    assert.equal(includesEarlierRuns({ type: "text", usage: { output_tokens: 1 }, modelUsage: { m: { outputTokens: 9 } } }), null, "only a result reports a cost");
  });
});

describe("the reviewer bot's review and CI, from GitHub's answers", () => {
  const HEAD = "head";
  const at = (minute) => new Date(Date.UTC(2026, 9, 23, 10, minute)).toISOString();
  const now = Date.parse(at(50));
  const byBot = (state, minute, commit = HEAD) => ({ login: "acme-review-bot[bot]", state, commit, at: at(minute) });
  const said = (body, minute, login = "ada") => ({ login, body, at: at(minute) });
  const factsOf = (facts) => reviewFacts({ reviewer: REVIEWER, ...facts });

  it("waits for a first review from when the pull request opened", () => {
    const facts = factsOf({ head: HEAD, createdAt: at(30), reviews: [], comments: [], now });
    assert.equal(facts.pending, true);
    assert.equal(facts.waitedMs, 20 * MIN);
  });

  it("counts the trigger (/review) after the latest review as a review asked for", () => {
    const facts = factsOf({ head: HEAD, createdAt: at(0), reviews: [byBot("CHANGES_REQUESTED", 10, "old")], comments: [said("Fixed both.\n\n/review", 20)], now });
    assert.equal(facts.pending, true);
    assert.equal(facts.waitedMs, 30 * MIN);
  });

  it("knows whether an approval's notes have an answer, and a bare trigger isn't one", () => {
    const reviews = [byBot("CHANGES_REQUESTED", 10, "old"), byBot("APPROVED", 20)];
    const unanswered = factsOf({ head: HEAD, createdAt: at(0), reviews, comments: [said("/review", 15)], now });
    assert.deepEqual(unanswered, { state: "APPROVED", onHead: true, pending: false, answered: false, rounds: 2, unreadable: false, waitedMs: 0 });
    const answered = factsOf({ head: HEAD, createdAt: at(0), reviews, comments: [said("Thanks. Note 1 is on #36.", 25)], now });
    assert.equal(answered.answered, true);
  });

  it("flags a review of the bot's with no time, which merge-approved.mjs refuses", () => {
    const facts = factsOf({ head: HEAD, createdAt: at(0), reviews: [byBot("APPROVED", 20), { ...byBot("COMMENTED", 25), at: null }], comments: [], now });
    assert.equal(facts.unreadable, true);
  });

  it("keeps a dismissed latest review, as merge-approved.mjs does", () => {
    const facts = factsOf({ head: HEAD, createdAt: at(0), reviews: [byBot("CHANGES_REQUESTED", 10), byBot("DISMISSED", 20)], comments: [], now });
    assert.equal(facts.state, "DISMISSED");
  });

  it("counts a reply in a review thread as an answer, and never another bot's comment", () => {
    const reviews = [byBot("APPROVED", 20)];
    const bot = factsOf({ head: HEAD, createdAt: at(0), reviews, comments: [said("Coverage: 93%", 25, "codecov[bot]")], now });
    assert.equal(bot.answered, false);
    const thread = factsOf({ head: HEAD, createdAt: at(0), reviews, comments: [said("Fair, it's on #36.", 25)], now });
    assert.equal(thread.answered, true);
  });

  it("goes by the bot's latest review whatever the order, and ignores everyone else's", () => {
    const reviews = [byBot("APPROVED", 20), byBot("CHANGES_REQUESTED", 30), { login: "ada", state: "APPROVED", commit: HEAD, at: at(40) }];
    const facts = factsOf({ head: HEAD, createdAt: at(0), reviews, comments: [], now });
    assert.equal(facts.state, "CHANGES_REQUESTED");
    assert.equal(facts.rounds, 2);
  });

  it("reads CI from the head's checks, as the merge script does: the required jobs must succeed", () => {
    const job = (name, status, conclusion) => ({ __typename: "CheckRun", workflowName: "verify", name, status, conclusion });
    const green = [job("verify", "COMPLETED", "SUCCESS"), job("image", "COMPLETED", "SUCCESS")];
    // ci.requiredJobs, as requiredChecks() returns them once the default branch has the workflow.
    const required = [{ workflow: "verify", job: "verify" }, { workflow: "verify", job: "image" }];
    const ciOf = (checks) => ciState(checks, required);
    assert.equal(ciState([], required), "none");
    assert.equal(ciOf(green), "pass");
    assert.equal(ciOf([...green, { __typename: "CheckRun", workflowName: "other", name: "lint", status: "COMPLETED", conclusion: "SKIPPED" }]), "pass");
    assert.equal(ciOf([job("verify", "COMPLETED", "SUCCESS"), job("image", "IN_PROGRESS", null)]), "pending");
    assert.equal(ciOf([job("verify", "COMPLETED", "SUCCESS")]), "pending", "a required job hasn't started");
    assert.equal(ciOf([job("verify", "COMPLETED", "SUCCESS"), job("image", "COMPLETED", "SKIPPED")]), "fail", "a skipped required job proves nothing");
    assert.equal(ciOf([job("verify", "COMPLETED", "FAILURE"), job("image", "IN_PROGRESS", null)]), "fail");
    assert.equal(ciOf([{ __typename: "StatusContext", context: "x", state: "PENDING" }]), "pending");
    assert.equal(ciState([job("lint", "COMPLETED", "SUCCESS")], []), "pass", "no workflow on the default branch, so no required jobs, as merge-approved.mjs reads it");
  });
});

describe("the brief", () => {
  const tasks = [
    { id: "task-01", file: "specs/02-app-api/tasks/task-01-shared-contracts.md" },
    { id: "task-02", file: "specs/02-app-api/tasks/task-02-schema-v1.md" },
  ];
  const brief = waveBrief({ specDir: "specs/02-app-api", wave: 1, branch: "build/spec-02-wave-01", tasks, specNumber: "02", project: "acme", repo: "acme/acme", reviewer: REVIEWER, defaultBranch: "main" });

  it("names the wave's tasks in order, its branch and its pull request", () => {
    assert.ok(brief.indexOf("task-01: specs/02-app-api/tasks/task-01") < brief.indexOf("task-02: specs/02-app-api/tasks/task-02"));
    assert.match(brief, /git push -u origin build\/spec-02-wave-01/);
    assert.match(brief, /build\(spec-02\): wave 1/);
  });

  it("names the project, the pull request's base, the repository and the reviewer bot from the config", () => {
    assert.match(brief, /of specs\/02-app-api in acme, unattended/);
    assert.match(brief, /Open one pull request into main with gh/);
    assert.match(brief, /The reviewer bot, acme-review-bot, reviews it within minutes\. Wait for that review: check gh api repos\/acme\/acme\/pulls\/<number>\/reviews/);
    assert.match(brief, /comment \/review once more and keep waiting/);
    assert.match(brief, /After each push, comment \/review, and keep going until the bot approves/);
    assert.match(brief, /Stop when the review bot's latest review approves your PR's head/);
    const trunk = waveBrief({ specDir: "specs/02-app-api", wave: 1, branch: "b", tasks, specNumber: "02", project: "acme", repo: "acme/acme", reviewer: REVIEWER, defaultBranch: "trunk" });
    assert.match(trunk, /Open one pull request into trunk with gh/);
  });

  it("holds the builder to AGENTS.md and the review rules, and says when to stop", () => {
    assert.match(brief, /Read AGENTS\.md first/);
    assert.match(brief, /Notes in an approving review need answers too/);
    assert.match(brief, /Never merge it/);
    assert.match(brief, /BLOCKED\.md/);
    assert.match(brief, /past 10 minutes, or 30 for installs, builds and tests/);
    assert.match(brief, /don't edit docs\/log\.md or docs\/STATUS\.md unless a task lists them/);
    assert.match(brief, /apart from the work loop's own bookkeeping: each task's Status, its box in the spec's README, its ledger row, BLOCKED\.md and specs\/\.current-task/);
    assert.match(brief, /If a review note needs a file no task lists, don't change it, even for a bug: answer the note, say it's for the lead/);
    assert.match(brief, /From the fourth review on, change code only for correctness, security and data bugs, and only in files the wave's tasks list\.\n {3}Answer every other note in a comment saying it's deferred, and list it under what you deferred in your last message, without changing code or filing issues/);
    assert.match(brief, new RegExp(`If none has come in ${REVIEW_WAIT_MS / 60_000} minutes`), "the brief's wait is the runner's");
  });

  it("tells a stopped builder why it's back", () => {
    assert.match(nudgeMessage("task-02 isn't complete."), /^You stopped before the wave was finished\. task-02 isn't complete\./);
    assert.match(nudgeMessage("x", { restarted: true }), /stopped responding for 10 minutes/);
  });
});
