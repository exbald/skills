#!/usr/bin/env node
// Runs one wave of a spec with a builder model and watches it:
//   node tools/build/run-wave.mjs --spec specs/02-app-api --wave 1 --builder <name> [--budget 10] [--dry-run]
// The builders, the repository, the reviewer bot and the default branch come from agentkit.config.json at the
// repository's root. It prepares the wave's own checkout beside the repository, briefs the builder, stops a command
// that hangs, restarts a builder that stops responding, and sends one that stops early back to work, at most three
// times. It exits when the wave's pull request is approved, answered and green (0), when the builder wrote
// BLOCKED.md (2), or when the lead must decide (3). The lead then audits and merges.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { nudgeMessage, waveBrief } from "./lib/brief.mjs";
import { requiredChecks } from "../guardrails/lib/ci.mjs";
import { readConfig } from "../guardrails/lib/config.mjs";
import { prepareCheckout } from "./lib/checkout.mjs";
import { claimWave, isAlive } from "./lib/claim.mjs";
import { builderCommand, builderEnv, builderLabel, costOf, DEFAULT_BUDGET_USD, hooksWired, includesEarlierRuns, parseEvent, reportsCost, sessionOf } from "./lib/builders.mjs";
import { parseGhJson, pullRequestFacts } from "./lib/github.mjs";
import { commandLimitMs, commandShells, descendants, GUARD_LOAD_MS, guardCheckout, guardFailedToLoad, guardLoaded, IDLE_MS, idleAction, parsePs } from "./lib/processes.mjs";
import { isWaiting, nextStep, outsideLists, porcelainPaths, specNumber, waveBranch, waveOutcome, waveTasks, worktreePath } from "./lib/wave.mjs";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const POLL_MS = 60_000;
const MAX_AWAIT_MS = 45 * 60_000;
const MAX_READ_FAILURES = 5;
// RUN_WAVE_GUARD_LOAD_MS shortens the wait for OpenCode's guard line, for the runner's own tests only.
const GUARD_WAIT_MS = Number(process.env.RUN_WAVE_GUARD_LOAD_MS) || GUARD_LOAD_MS;
/** The longest a wave may run, nudges and waits included, before it goes to the lead. */
const MAX_WAVE_MS = 8 * 3_600_000;
/** How long a SIGTERM gets before SIGKILL, and a restarted builder before the runner stops waiting for it. */
const GRACE_MS = 30_000;
// A `stopped` wave has no code here: stopOnSignals's end() exits with 143 or 130 once its grace is over, and
// finish() never decides that exit. Any other kind not listed goes to the lead.
const EXIT = Object.freeze({ done: 0, blocked: 2, escalate: 3 });
const USAGE = "Usage: node tools/build/run-wave.mjs --spec specs/NN-name --wave N --builder <name> [--budget USD] [--root DIR] [--dry-run]";

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--help") options.help = true;
    else if (["--spec", "--wave", "--builder", "--budget", "--root"].includes(flag) && value !== undefined) {
      options[flag.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unknown argument ${flag}.\n${USAGE}`);
  }
  if (options.help) return options;
  const wave = Number(options.wave);
  if (!options.spec || !options.builder) throw new Error(USAGE);
  if (!Number.isInteger(wave) || wave < 1) throw new Error(`--wave must be a wave number, not ${options.wave}.\n${USAGE}`);
  return { ...options, spec: options.spec.replace(/\/$/, ""), wave, root: resolve(options.root ?? REPOSITORY) };
}

/**
 * The builder `--builder` names in agentkit.config.json, and the wave's budget: --budget, else the builder's own
 * budgetUsd, else DEFAULT_BUDGET_USD. Only a Claude Code builder is metered, but a typo stops every run.
 */
function chooseBuilder(options, config) {
  const builder = config.builders[options.builder];
  if (!builder) {
    const names = Object.keys(config.builders);
    const known = names.length > 0 ? `The builders in agentkit.config.json are: ${names.join(", ")}.` : "agentkit.config.json names no builders.";
    throw new Error(`Unknown builder "${options.builder}". ${known}\n${USAGE}`);
  }
  const budget = Number(options.budget ?? builder.budgetUsd ?? DEFAULT_BUDGET_USD);
  // The budget is a spend cap: a typo must stop the run, never reach claude as NaN.
  if (!Number.isFinite(budget) || budget <= 0) throw new Error(`--budget must be a positive number of dollars, not ${options.budget}.\n${USAGE}`);
  return { builder: { ...builder, label: builderLabel(options.builder, builder) }, budget };
}

/** What every wave needs from agentkit.config.json before anything runs: the repository and the reviewer bot. */
function checkConfig(config) {
  if (!config.repo) throw new Error("agentkit.config.json has no repo (owner/name on GitHub), so the runner can't find the wave's pull request. Set it and run again.");
  if (!config.reviewer.login) throw new Error("agentkit.config.json has no reviewer.login, so no review of the wave's pull request can count. Set it and run again.");
}

function sh(command, args, cwd, { env = process.env, check = true } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (check && (result.error || result.status !== 0)) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result;
}

// Every gh call names the repository with --repo or its API path, so the directory it runs in doesn't matter.
const ghJson = (args) => parseGhJson(sh("gh", args, REPOSITORY).stdout);

/**
 * Runs a command to its end without blocking the runner, in its own process group, which `group.pid` names
 * meanwhile: a stop signal then takes the command down with the runner, as it does a builder.
 */
function runAsync(command, args, { cwd, env, group, stderrFile }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "ignore", "pipe"] });
    group.pid = child.pid;
    child.on("close", () => {
      group.pid = null;
    });
    // All of it in the wave's stderr log; the end of it in the error.
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      appendFileSync(stderrFile, chunk);
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    child.on("error", reject);
    const said = (code) => stderr.trim() || `exit code ${code}, with no output`;
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed (all of its output is in ${stderrFile}): ${said(code)}`))));
  });
}

/**
 * The install a checkout gets before its builder starts: agentkit.config.json's build.install, else `npm ci` when the
 * checkout has a package-lock.json, else none.
 */
function installCommand(config, worktree) {
  if (config.build.install) return config.build.install;
  return existsSync(join(worktree, "package-lock.json")) ? ["npm", "ci", "--no-audit", "--no-fund"] : null;
}

/** The wave's checkout (lib/checkout.mjs, which never discards a commit), with the repository's packages. */
async function readyCheckout({ root, config, branch, worktree, log, group, stderrFile }) {
  log(prepareCheckout({ root, branch, worktree, defaultBranch: config.defaultBranch }));
  const install = installCommand(config, worktree);
  if (install) {
    // The builder's environment, so nothing inherited points the install elsewhere, and the canonical path as both
    // cwd and PWD, so the two never disagree through a link (lib/builders.mjs, builderEnv). build.installEnv adds what
    // the project's install needs, such as npm_config_userconfig=/dev/null where a global npmrc breaks it.
    const here = realPath(worktree);
    const env = { ...builderEnv(process.env, here), ...config.build.installEnv };
    const [command, ...args] = install;
    await runAsync(command, args, { cwd: here, env, group, stderrFile });
  }
}

const prFacts = ({ branch, required, config }) => pullRequestFacts({ branch, required, gh: ghJson, repo: config.repo, reviewer: config.reviewer });

function waveFacts(target) {
  const { worktree, spec, wave, config } = target;
  const ahead = sh("git", ["rev-list", "--count", "@{u}..HEAD"], worktree, { check: false });
  const tasks = waveTasks(worktree, spec, wave);
  // Committed and uncommitted alike, so a builder is never told to commit a file its tasks don't list.
  const committed = sh("git", ["diff", "--name-only", `origin/${config.defaultBranch}...HEAD`], worktree).stdout.split("\n").filter(Boolean);
  const uncommitted = porcelainPaths(sh("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktree).stdout);
  return {
    tasks,
    outside: outsideLists(spec, tasks, [...new Set([...committed, ...uncommitted])]),
    blocked: existsSync(join(worktree, spec, "BLOCKED.md")),
    dirty: uncommitted.length > 0,
    unpushed: ahead.status !== 0 || Number(ahead.stdout.trim()) > 0,
    ...prFacts(target),
  };
}

/** A path with its links resolved, or as given when it doesn't exist here. */
function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Sends `signal` to a PID or, negative, a process group. Gone already is fine. */
function signal(pid, name) {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
}

/** Stops each hung command and everything it started, by PID: SIGTERM, then SIGKILL for what's left. */
function stopCommands(pids, rows) {
  const all = descendants(rows, pids);
  for (const pid of all) signal(pid, "SIGTERM");
  setTimeout(() => {
    for (const pid of all) signal(pid, "SIGKILL");
  }, GRACE_MS).unref();
}

/**
 * Reads the builder's output: every line or chunk counts as a sign of life; JSON events carry session and cost.
 * `onGuardFailure(why)` runs when OpenCode's log says the guard plugin didn't load, or loaded from a checkout
 * other than `checkout`: then OpenCode isn't working in the wave's checkout at all.
 */
function followOutput(child, state, { files, checkout, onGuardFailure }) {
  createInterface({ input: child.stdout }).on("line", (line) => {
    state.lastEvent = Date.now();
    appendFileSync(files.events, `${line}\n`);
    const event = parseEvent(line);
    if (!event) return;
    state.session = sessionOf(event) ?? state.session;
    // One run can print several results, one each time background work wakes it, and each reports the run's total
    // so far: keep the highest, never their sum (a live wave printed $7.63 up to $9.98, which summed to $55.13).
    // Whether that total takes in the session's earlier runs shows on the run's first result that says
    // (includesEarlierRuns); one without the token counts leaves the question open.
    state.events += 1;
    if (state.sessionTotals === null) state.sessionTotals = includesEarlierRuns(event);
    state.cost = Math.max(state.cost, costOf(event));
    state.costed = state.costed || reportsCost(event);
  });
  child.stderr.on("data", (chunk) => {
    state.lastEvent = Date.now();
    appendFileSync(files.stderr, chunk);
    // A log line can arrive split across chunks, so the checks read the last few kilobytes.
    state.recentLog = (state.recentLog + chunk.toString()).slice(-8192);
    // Loaded only once the guardrails line names a checkout: an unreadable one keeps the runner waiting, and the
    // GUARD_WAIT_MS deadline then stops the builder. Never accepted unverified.
    const from = !state.guardLoaded && !state.guardFailed && guardLoaded(state.recentLog) ? guardCheckout(state.recentLog) : null;
    if (from !== null) {
      // Both sides resolved, so /var and /private/var (macOS) can't read as two places.
      if (realPath(from) === checkout) state.guardLoaded = true;
      else {
        state.guardFailed = true;
        onGuardFailure(`OpenCode loaded the guard plugin from ${from}, not the wave's checkout ${checkout}, so it isn't working there`);
      }
    }
    if (!state.guardFailed && guardFailedToLoad(state.recentLog)) {
      state.guardFailed = true;
      onGuardFailure("OpenCode's log says the guard plugin failed to load");
    }
  });
}

/**
 * Every minute, looks at a builder that has been silent for 10: stops its hung commands, or restarts it. A stopped
 * command's tool result arrives within seconds, so a builder still silent a minute later is restarted.
 * Returns the interval, which `stop` clears.
 */
function watchSilence(child, state, { log, awaitingReview, restart, longCommands }) {
  const check = () => {
    const quietMs = Date.now() - state.lastEvent;
    if (quietMs < IDLE_MS) return;
    const rows = parsePs(sh("ps", ["-A", "-o", "pid=,ppid=,etime=,command="], REPOSITORY).stdout);
    const action = idleAction({ quietMs, shells: commandShells(rows, child.pid), awaitingReview: awaitingReview(), longCommands });
    if (action.kind === "stop-commands") {
      const ran = action.pids.map((pid) => rows.find((row) => row.pid === pid)).filter(Boolean);
      const limit = (row) => commandLimitMs(row.command, longCommands) / 60_000;
      log(`stopping commands past their limit: ${ran.map((row) => `${row.pid} after ${Math.round(row.elapsedMs / 60_000)} min (limit ${limit(row)})`).join(", ")}`);
      stopCommands(action.pids, rows);
    } else if (action.kind === "restart") {
      log("the builder has been silent for 10 minutes with nothing running: restarting it");
      restart();
    }
  };
  return setInterval(() => {
    try {
      check();
    } catch (error) {
      log(`couldn't check on the builder: ${error.message}`);
    }
  }, POLL_MS);
}

/**
 * The builder's two deadlines: an OpenCode builder must show its guard loaded within GUARD_LOAD_MS (a plugin skipped
 * silently logs nothing), and no run goes past the wave's deadline, even one that keeps printing.
 */
function armDeadlines({ builder, state, deadline, log, stop }) {
  if (builder.harness === "opencode") {
    setTimeout(() => {
      if (state.finished || state.guardLoaded || state.guardFailed) return;
      state.guardFailed = true;
      log(`OpenCode didn't log loading the guard plugin within ${GUARD_WAIT_MS / 1000} seconds: stopping the builder before it works unguarded`);
      stop();
    }, GUARD_WAIT_MS).unref();
  }
  setTimeout(() => {
    if (state.finished) return;
    state.timedOut = true;
    log(`the wave has run ${MAX_WAVE_MS / 3_600_000} hours: stopping the builder`);
    stop();
  }, Math.max(0, deadline - Date.now())).unref();
}

/** Runs the builder until it exits, watching for silence. Resolves with its session, cost and how it ended. */
function runBuilder({ builder, worktree, message, session, budgetUsd, title, files, log, awaitingReview, longCommands, deadline, onStart }) {
  return new Promise((done) => {
    const { command, args } = builderCommand(builder, { message, session, title, budgetUsd });
    // Its own process group, so a restart stops the builder and its private server together, by PID.
    const here = realPath(worktree);
    const child = spawn(command, args, { cwd: here, env: builderEnv(process.env, here), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    onStart(child.pid);
    const state = { lastEvent: Date.now(), session, cost: 0, costed: false, sessionTotals: null, events: 0, restarted: false, finished: false, guardFailed: false, guardLoaded: false, timedOut: false, recentLog: "" };
    let watch = null;
    const finish = (code) => {
      if (state.finished) return;
      state.finished = true;
      clearInterval(watch);
      const { cost, costed, events, restarted, guardFailed, timedOut } = state;
      done({ code, session: state.session, cost, costed, sessionTotals: state.sessionTotals === true, events, restarted, guardFailed, timedOut });
    };
    // A stop takes the whole group: SIGTERM, SIGKILL after the grace period, and the runner moves on after one
    // more, even if something in the group still holds its pipes open.
    const stop = () => {
      clearInterval(watch);
      signal(-child.pid, "SIGTERM");
      setTimeout(() => signal(-child.pid, "SIGKILL"), GRACE_MS).unref();
      setTimeout(() => finish(null), 2 * GRACE_MS).unref();
    };
    followOutput(child, state, {
      files,
      checkout: realPath(worktree),
      onGuardFailure: (why) => {
        log(`${why}: stopping the builder before it works unguarded`);
        stop();
      },
    });
    armDeadlines({ builder, state, deadline, log, stop });
    const restart = () => {
      state.restarted = true;
      stop();
    };
    watch = watchSilence(child, state, { log, awaitingReview, restart, longCommands });
    child.on("close", finish);
    child.on("error", (error) => {
      log(`the builder couldn't start: ${error.message}`);
      finish(-1);
    });
  });
}

/** Where the wave stands, waiting while the reviewer bot or CI works, for up to 45 minutes. */
async function settle(target, log) {
  const started = Date.now();
  let failures = 0;
  for (;;) {
    // A gh or network blip mid-wave is waited out; five in a row go to the lead, never a lost wave.
    let facts;
    try {
      facts = waveFacts(target);
      failures = 0;
    } catch (error) {
      failures += 1;
      log(`couldn't read the wave's state (${failures} in a row): ${error.message}`);
      if (failures >= MAX_READ_FAILURES) return { kind: "escalate", reason: `Couldn't read the wave's state ${failures} times in a row: ${error.message}` };
      await sleep(POLL_MS);
      continue;
    }
    const outcome = waveOutcome(facts, { reviewer: target.config.reviewer, defaultBranch: target.config.defaultBranch });
    if (outcome.kind !== "await") return outcome;
    if (Date.now() - started > MAX_AWAIT_MS) return { kind: "escalate", reason: `Still waiting after 45 minutes: ${outcome.reason}` };
    log(outcome.reason);
    await sleep(POLL_MS);
  }
}

/** The watchdog reads ps every minute. If this Mac's ps can't be read, stop now rather than watch nothing. */
function checkPs() {
  const rows = parsePs(sh("ps", ["-A", "-o", "pid=,ppid=,etime=,command="], REPOSITORY).stdout);
  // The runner's own line must be there, and every process's age must read: an age that doesn't would hide a
  // hung command. (Not "some process is old": on a machine booted a minute ago, none is.)
  const own = rows.find((row) => row.pid === process.pid && row.command.includes("run-wave"));
  if (!own || !rows.every((row) => Number.isFinite(row.elapsedMs))) {
    throw new Error("Couldn't read this runner's own line in ps -A -o pid=,ppid=,etime=,command=, so the watchdog couldn't see a hung builder.");
  }
}

/** A run that ends the wave whatever its state: an unguarded builder, or the wave's time used up. */
function runVerdict(run, files, builder) {
  if (run.guardFailed) return { kind: "escalate", reason: `OpenCode didn't show the guard plugin loaded, so ${builder.label} was stopped before it worked unguarded. See ${files.stderr}.` };
  if (run.timedOut) return { kind: "escalate", reason: `The wave ran past ${MAX_WAVE_MS / 3_600_000} hours. See ${files.log}.` };
  return null;
}

// Dollars compared in whole cents, so sums like 0.1 + 0.2 meet the cap exactly.
const cents = (usd) => Math.round(usd * 100);

/** Builds the wave until it's done, blocked or for the lead: runs the builder, then nudges it while work is left. */
async function buildWave({ builder, budget, brief, target, files, log, onStart, onStop, stopping = () => false }) {
  // A runner that got SIGTERM or SIGINT never starts or resumes a builder, nor nudges one, even in its grace
  // period: it stops before anything is started and as soon as a run ends. The exit code stays end()'s own,
  // 143 or 130 (stopOnSignals), since end() exits the process once the grace is over.
  const stopped = { kind: "stopped", reason: "The runner was stopped, so no builder starts again." };
  if (stopping()) return stopped;
  const awaitingReview = () => isWaiting(prFacts(target));
  // A Claude Code builder's guard is Claude Code's hook: launch only in a checkout that wires it.
  const metered = builder.harness === "claude";
  if (metered && !hooksWired(target.worktree)) {
    return { kind: "escalate", reason: `${target.worktree}/.claude/settings.json doesn't run tools/guardrails/hooks/guard.mjs, so ${builder.label} would work unguarded.` };
  }
  const longCommands = target.config.build.longCommands;
  const deadline = Date.now() + MAX_WAVE_MS;
  let message = brief;
  let session = null;
  let spent = 0;
  // What the session being resumed has cost so far: a run whose totals take it in adds only what it reported beyond.
  let sessionSpent = 0;
  let nudges = 0;
  for (;;) {
    if (stopping()) return stopped;
    log(`${builder.label} ${session ? `resumes session ${session}` : "starts"}`);
    const run = await runBuilder({ builder, worktree: target.worktree, message, session, budgetUsd: budget - spent, title: target.branch, files, log, awaitingReview, longCommands, deadline, onStart });
    onStop();
    if (stopping()) return stopped;
    // --max-budget-usd holds a run to its own spend (a resume capped at $0.005, with the session at $0.0102, spent
    // $0.0030 over 5 turns), so the next run is still given what the wave has left.
    const before = session !== null && run.session === session ? sessionSpent : 0;
    // A session's total never shrinks, so one below what it had spent means the output changed: count it all.
    const shrank = run.sessionTotals && run.cost < before;
    if (shrank) log(`warning: the resumed run reported $${run.cost.toFixed(2)} for its session, under the $${before.toFixed(2)} it had spent, so all of it counts. See ${files.events}.`);
    const own = run.sessionTotals && !shrank ? run.cost - before : run.cost;
    sessionSpent = before + own;
    session = run.session ?? session;
    spent += own;
    const how = run.code === null ? "stopped by the runner" : `exit ${run.code}`;
    log(`the builder stopped (${how}${metered ? `, $${spent.toFixed(2)} spent` : ""})`);
    // No JSON at all means the builder's output format changed: no session to resume, no cost to count.
    if (run.events === 0) log(`warning: the builder printed no JSON events, so its output format may have changed. See ${files.stderr}.`);
    const verdict = runVerdict(run, files, builder);
    if (verdict) return verdict;
    const settled = await settle(target, log);
    // A wave that finished as it crossed the cap is done; one with work left can't spend more.
    if (settled.kind === "done" || settled.kind === "blocked") return settled;
    // A run that never reported its cost (stopped for silence, or its output changed) spent an unknown amount, so
    // the next run can't be held to what's left: the lead decides.
    if (metered && !run.costed) {
      return { kind: "escalate", reason: `${builder.label}'s run ended without reporting what it cost, so another run can't be held to the wave's $${budget.toFixed(2)} cap ($${spent.toFixed(2)} reported so far). Left: ${settled.reason}` };
    }
    if (metered && cents(spent) >= cents(budget)) return { kind: "escalate", reason: `${builder.label} spent $${spent.toFixed(2)}, and the wave's cap is $${budget.toFixed(2)}. Left: ${settled.reason}` };
    const step = nextStep(settled, nudges);
    if (step.kind !== "nudge") return step;
    nudges += 1;
    log(`nudge ${nudges}: ${step.reason}`);
    message = session ? nudgeMessage(step.reason, { restarted: run.restarted }) : `${brief}\n\n${nudgeMessage(step.reason)}`;
  }
}

/**
 * A runner stopped by SIGTERM or SIGINT takes its builder with it: SIGTERM to the builder's group, SIGKILL five
 * seconds later, then the claim is released and the runner exits (143 or 130). A builder never outlives its runner.
 */
function stopOnSignals(builderGroup, claim, log) {
  // Only a builder that's running now, and whose group still lives: a group id from an earlier run may be reused.
  const builder = (name) => {
    if (builderGroup.pid && isAlive(-builderGroup.pid)) signal(-builderGroup.pid, name);
  };
  const end = (code) => {
    builder("SIGKILL");
    claim.release();
    process.exit(code);
  };
  const shutdown = (name, code) => {
    // A second signal doesn't wait: it ends now, still releasing the wave.
    if (builderGroup.stopping) return end(code);
    builderGroup.stopping = true;
    log(`the runner got ${name}: stopping the builder and releasing the wave`);
    // Nothing running, nothing to wait for.
    if (!builderGroup.pid || !isAlive(-builderGroup.pid)) return end(code);
    builder("SIGTERM");
    setTimeout(() => end(code), 5_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM", 143));
  process.on("SIGINT", () => shutdown("SIGINT", 130));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return void process.stdout.write(`${USAGE}\n`);
  const { spec, wave, root } = options;
  const config = readConfig(root);
  const { builder, budget } = chooseBuilder(options, config);
  checkConfig(config);
  const branch = waveBranch(spec, wave);
  const worktree = worktreePath(root, branch);
  const tasks = waveTasks(root, spec, wave);
  if (tasks.length === 0) throw new Error(`${spec} has no tasks in wave ${wave}.`);
  const { project, repo, reviewer, defaultBranch } = config;
  const brief = waveBrief({ specDir: spec, wave, branch, tasks, specNumber: specNumber(spec), project, repo, reviewer, defaultBranch });
  if (options.dryRun) {
    const { command, args } = builderCommand(builder, { message: "<brief>", title: branch, budgetUsd: budget });
    const plan = { branch, worktree, builder: builder.label, tasks: tasks.map((task) => task.id), command: [command, ...args].join(" "), brief };
    return void process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  }
  const files = { log: `${worktree}.log`, events: `${worktree}.events.jsonl`, stderr: `${worktree}.stderr.log`, pid: `${worktree}.pid` };
  mkdirSync(dirname(worktree), { recursive: true });
  checkPs();
  const claim = claimWave(files.pid);
  process.on("exit", claim.release);
  const log = (text) => {
    const line = `${new Date().toISOString()} ${text}`;
    appendFileSync(files.log, `${line}\n`);
    process.stdout.write(`${line}\n`);
  };
  const builderGroup = { pid: null, stopping: false };
  stopOnSignals(builderGroup, claim, log);
  await readyCheckout({ root, config, branch, worktree, log, group: builderGroup, stderrFile: files.stderr });
  // The jobs merge-approved.mjs will require, read once, so the runner calls done only what it can merge.
  const required = requiredChecks(root, config);
  const onStart = (pgid) => {
    builderGroup.pid = pgid;
    claim.recordBuilder(pgid);
  };
  const onStop = () => {
    builderGroup.pid = null;
  };
  const stopping = () => builderGroup.stopping;
  const step = await buildWave({ builder, budget, brief, target: { worktree, spec, wave, branch, required, config }, files, log, onStart, onStop, stopping });
  finish(step, log);
}

function finish(step, log) {
  log(`${step.kind}: ${step.reason}`);
  process.exitCode = EXIT[step.kind] ?? EXIT.escalate;
}

main().catch((error) => {
  process.stderr.write(`run-wave: ${error.message}\n`);
  process.exitCode = 1;
});
