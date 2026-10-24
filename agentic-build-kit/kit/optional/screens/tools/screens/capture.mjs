#!/usr/bin/env node
// The screen check's capture: opens each gallery entry on the Android emulator, in each theme, saves a screenshot, and
// writes one page that sets each beside its frozen design. This file is the order of the steps and the cleanup; what
// it decides is in lib/ and tested there. What it knows about the app comes from agentkit.config.json's screens section
// (lib/settings.mjs). Node's own modules only.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readConfig } from "../guardrails/lib/config.mjs";
import { parseArgs, USAGE } from "./lib/args.mjs";
import { adbRun, appInstalled, bootCompleted, chooseDevice, clearReadyMark, demoMode, deviceOptions, metroRunning, openDevClient, openLink, readyMarked, screencap } from "./lib/device.mjs";
import { comparisonPage } from "./lib/page.mjs";
import { pairsFor } from "./lib/pairs.mjs";
import { screensSettings } from "./lib/settings.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BOOT_TIMEOUT_MS = 3 * 60_000;
const BOOT_POLL_MS = 2_000;
const METRO_TIMEOUT_MS = 2 * 60_000;
const METRO_POLL_MS = 1_000;
const READY_TIMEOUT_MS = 15_000;
// The run's first pair also waits for the bundle to load, so it gets longer, with its gallery link opened again
// meanwhile: one opened while the bundle is still loading can be lost.
const FIRST_READY_TIMEOUT_MS = 2 * 60_000;
const REOPEN_EVERY_MS = 10_000;
const READY_POLL_MS = 500;
/** How long a process gets to stop after SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 10_000;

/** The shell's convention: 128 plus the signal's number. */
const EXIT_SIGINT = 130;
const EXIT_SIGTERM = 143;

/** A failure with a plain message for the lead: printed as it is, exit 1. */
class Failure extends Error {}

const say = (line) => process.stdout.write(`${line}\n`);
const complain = (line) => process.stderr.write(`${line}\n`);

/** Polls `check` every `everyMs` until it's true, for at most `forMs`. */
async function waitUntil(check, { forMs, everyMs }) {
  const deadline = Date.now() + forMs;
  while (true) {
    if (await check()) return true;
    if (Date.now() + everyMs > deadline) return false;
    await sleep(everyMs);
  }
}

/** What this run started, so the cleanup stops those and nothing else: each in its own process group, by its PID. */
const started = [];

function start(name, command, args, options) {
  const child = spawn(command, args, { detached: true, ...options });
  const entry = { name, child, pid: child.pid, failed: null };
  child.on("error", (error) => {
    entry.failed = `Couldn't start ${name} (${command}): ${error.message}`;
  });
  child.unref();
  started.push(entry);
  return entry;
}

const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** SIGTERM to the group, then SIGKILL after the grace period if anything is left. */
async function stop(entry) {
  if (entry.pid === undefined || !groupAlive(entry.pid)) return;
  try {
    process.kill(-entry.pid, "SIGTERM");
  } catch {
    return;
  }
  if (await waitUntil(async () => !groupAlive(entry.pid), { forMs: STOP_GRACE_MS, everyMs: 200 })) return;
  try {
    process.kill(-entry.pid, "SIGKILL");
  } catch {
    // It went in the meantime.
  }
}

/** The project's name and screens settings, from agentkit.config.json. */
function readSettings() {
  const config = readConfig(REPO);
  return { project: config.project, settings: screensSettings(config.screens) };
}

function readIds(settings) {
  const file = join(REPO, settings.idsFile);
  if (!existsSync(file)) throw new Failure(`The gallery isn't built: ${settings.idsFile} is missing. The app's gallery writes it (README, "What the app provides").`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * The device this run uses: a named serial as itself (chooseDevice checks it's attached), else an attached emulator
 * of the image, else one this run boots. While the boot is waited out, an emulator of that image is looked for by
 * name too, never as "the one device".
 */
async function ensureDevice(opts, options, emulator) {
  if (options.serial !== null) return await chooseDevice(opts, options);
  let serial = await chooseDevice(opts, options);
  if (serial !== null) return serial;
  say(`No emulator of image ${options.avd} attached: booting it.`);
  const boot = start("the emulator", emulator, ["-avd", options.avd, "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot-save", "-no-metrics"], { stdio: "ignore" });
  const booted = await waitUntil(
    async () => {
      if (boot.failed) throw new Failure(boot.failed);
      if (boot.child.exitCode !== null) throw new Failure(`The emulator stopped at once (exit ${boot.child.exitCode}). Is "${options.avd}" an image on this Mac? (emulator -list-avds)`);
      serial ??= await chooseDevice(opts, options);
      return serial !== null && (await bootCompleted(opts, serial));
    },
    { forMs: BOOT_TIMEOUT_MS, everyMs: BOOT_POLL_MS },
  );
  if (!booted) throw new Failure("The emulator didn't boot within 3 minutes.");
  return serial;
}

async function ensureMetro(opts, serial, out, settings) {
  const port = settings.metroPort;
  if (!(await metroRunning(port))) {
    say(`Starting Metro on port ${port} (its log is ${join(out, "metro.log")}).`);
    const log = openSync(join(out, "metro.log"), "a");
    const metro = start("Metro", "npx", ["expo", "start", "--dev-client", "--port", String(port)], { cwd: join(REPO, settings.appDir), stdio: ["ignore", log, log] });
    closeSync(log);
    const running = await waitUntil(
      async () => {
        if (metro.failed) throw new Failure(metro.failed);
        return metroRunning(port);
      },
      { forMs: METRO_TIMEOUT_MS, everyMs: METRO_POLL_MS },
    );
    if (!running) throw new Failure("Metro didn't report running within 2 minutes.");
  }
  await adbRun(opts, ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
}

/** One pair: open its link, wait for the ready mark, let it settle, take the picture. Returns why not, or null. */
async function capture(opts, serial, pair, settleMs, { readyMs, reopenEveryMs }) {
  await clearReadyMark(opts, serial);
  await openLink(opts, serial, pair.link);
  // The first pair's wait also covers the bundle loading. Its deadline counts from this first open and isn't
  // restarted by a reopen: the gallery link is opened again every so often while the entry stays unmarked.
  const deadline = Date.now() + readyMs;
  let openedAt = Date.now();
  let ready = false;
  while (!ready && Date.now() < deadline) {
    if (reopenEveryMs !== null && Date.now() - openedAt >= reopenEveryMs) {
      await openLink(opts, serial, pair.link);
      openedAt = Date.now();
    }
    ready = await readyMarked(opts, serial, pair.id, pair.theme);
    if (!ready) await sleep(READY_POLL_MS);
  }
  if (!ready) return `${pair.id} ${pair.theme}: the entry never marked itself ready within ${readyMs / 1000} seconds.`;
  await sleep(settleMs);
  await screencap(opts, serial, pair.capture);
  return null;
}

async function run(options, ids, { project, settings }, state) {
  const sdk = process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
  const opts = deviceOptions(join(sdk, "platform-tools/adb"), settings);
  mkdirSync(options.out, { recursive: true });
  const pairs = pairsFor(options.only ?? ids, options.themes, { designRoot: join(REPO, settings.designRoot), outDir: options.out, settings });

  await adbRun(opts, ["version"]);
  const serial = await ensureDevice(opts, options, join(sdk, "emulator/emulator"));
  state.serial = serial;
  state.opts = opts;
  if (!(await appInstalled(opts, serial))) throw new Failure(`The development build isn't installed: run \`npx expo run:android\` in ${settings.appDir}.`);
  await ensureMetro(opts, serial, options.out, settings);
  // The bundle is loaded before the first pair: a cold gallery link lands in the dev client's launcher instead.
  await openDevClient(opts, serial, settings.metroPort);

  state.demo = true;
  await demoMode(opts, serial, true);
  const captured = new Set();
  const failures = [];
  for (const [index, pair] of pairs.entries()) {
    // The run's first pair (`--only` included) waits out the bundle load; every later pair gets the short wait.
    const wait = index === 0 ? { readyMs: FIRST_READY_TIMEOUT_MS, reopenEveryMs: REOPEN_EVERY_MS } : { readyMs: READY_TIMEOUT_MS, reopenEveryMs: null };
    try {
      const why = await capture(opts, serial, pair, options.settleMs, wait);
      if (why === null) captured.add(`${pair.id}.${pair.theme}`);
      else failures.push(why);
    } catch (error) {
      failures.push(`${pair.id} ${pair.theme}: ${error.message}`);
      // A hung adb would hang every pair after it in turn: stop, and write the page for what there is.
      if (error.message.startsWith("adb didn't answer")) break;
    }
  }

  const page = join(options.out, "index.html");
  writeFileSync(page, comparisonPage(pairs, { outDir: options.out, captured, project }));
  say(`Captured ${captured.size} of ${pairs.length}. ${pathToFileURL(page)}`);
  for (const failure of failures) complain(`  not captured: ${failure}`);
  return failures.length === 0 ? 0 : 1;
}

/** Releases the status bar, then stops Metro and the emulator if this run started them. Safe to call twice. */
let cleaning = null;
function cleanUp(state) {
  cleaning ??= (async () => {
    if (state.demo) {
      await demoMode(state.opts, state.serial, false).catch((error) => complain(`Couldn't release the status bar: ${error.message}`));
    }
    for (const name of ["Metro", "the emulator"]) {
      for (const entry of started.filter((one) => one.name === name)) await stop(entry);
    }
  })();
  return cleaning;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    say(USAGE);
    return 0;
  }
  let app;
  let ids;
  try {
    app = readSettings();
    ids = readIds(app.settings);
  } catch (error) {
    complain(error.message);
    return 1;
  }
  let options;
  try {
    options = parseArgs(argv, { repoRoot: REPO, ids, settings: app.settings, project: app.project, env: process.env });
  } catch (error) {
    complain(error.message);
    complain(USAGE);
    return 2;
  }
  const state = { demo: false, serial: null, opts: null };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      complain(`\n${signal}: stopping what this run started.`);
      await cleanUp(state);
      process.exit(signal === "SIGINT" ? EXIT_SIGINT : EXIT_SIGTERM);
    });
  }
  try {
    return await run(options, ids, app, state);
  } catch (error) {
    complain(error.message);
    return 1;
  } finally {
    await cleanUp(state);
  }
}

process.exitCode = await main();
