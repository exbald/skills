import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { get } from "node:http";

// What the script asks adb. Each function takes `opts`: `{ adb }`, the path of the adb to run, so the tests can hand it
// a stand-in, and for the calls that reach the app, its package (`appId`), the ready file the gallery writes in the
// app's own storage (`readyFile`) and the dev client's link scheme (`devClientScheme`), from the screens settings
// (lib/settings.mjs). adb can hang (README, "adb hangs"), so nothing here waits on it without a timer.
const DEMO = "com.android.systemui.demo";
const ADB_TIMEOUT_MS = 20_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const onDevice = (serial, ...args) => ["-s", serial, ...args];

/** The `opts` the adb calls take: adb's path, and the app's package, ready file and dev client scheme from the settings. */
export function deviceOptions(adb, { appId, readyFile, devClientScheme }) {
  return { adb, appId, readyFile, devClientScheme };
}

/** Runs adb with args. Throws a plain Error naming the args if adb doesn't answer within timeoutMs (default 20 s). */
export function adbRun({ adb }, args, { timeoutMs = ADB_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(adb, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    let timedOut = false;
    // Only this adb process, by its PID: the timer kills what it started and nothing else.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't run adb at ${adb}: ${error.message}. Set ANDROID_HOME to the Android SDK.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!timedOut) return resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") });
      const seconds = Number.isInteger(timeoutMs / 1000) ? timeoutMs / 1000 : (timeoutMs / 1000).toFixed(1);
      reject(new Error(`adb didn't answer within ${seconds} seconds (adb ${args.join(" ")}). See "adb hangs" in tools/screens/README.md.`));
    });
  });
}

const text = async (opts, args) => (await adbRun(opts, args)).stdout.toString("utf8");

/** The `opts` key a call needs, or a plain error: a call aimed at an unnamed app would reach the wrong one, or none. */
function setting(opts, key) {
  if (typeof opts[key] !== "string" || opts[key] === "") throw new Error(`No ${key} for this adb call: pass the screens settings' ${key}.`);
  return opts[key];
}

/**
 * The serials in the "device" state. A line in any other state counts as not attached, and an unauthorized one is
 * warned about, so a stray phone can never take the run.
 */
export async function devicesAttached(opts, { warn = (line) => process.stderr.write(`${line}\n`) } = {}) {
  const lines = (await text(opts, ["devices"])).split("\n").filter((line) => line.includes("\t"));
  const states = lines.map((line) => line.trim().split(/\s+/));
  if (states.some(([, state]) => state === "unauthorized")) warn("Accept the debugging prompt on that device.");
  return states.filter(([, state]) => state === "device").map(([serial]) => serial);
}

/** The image an attached emulator runs, read from its console: `emu avd name` changes nothing. */
export async function avdName(opts, serial) {
  return (await text(opts, onDevice(serial, "emu", "avd", "name"))).split("\n")[0].trim();
}

/**
 * The device this run uses, chosen by name, never by count: a run that took "the one attached device" once reached a
 * phone. A named serial (`--serial` or `ANDROID_SERIAL`) is used alone: the run fails when
 * it isn't attached. Otherwise the first attached emulator whose image is `avd`, or null when there is none, so the
 * caller boots the image. Only `devices` and `emu avd name` reach a device the run doesn't use, and a serial that
 * isn't an emulator is never touched unless it's named.
 */
export async function chooseDevice(opts, { serial, avd }) {
  const attached = await devicesAttached(opts);
  if (serial !== null) {
    if (!attached.includes(serial.value)) {
      throw new Error(
        serial.from === "--serial"
          ? `${serial.value} isn't attached: start it, or run without --serial.`
          : `${serial.value} (from ANDROID_SERIAL) isn't attached: start it, or unset ANDROID_SERIAL.`,
      );
    }
    return serial.value;
  }
  for (const one of attached.filter((candidate) => candidate.startsWith("emulator-"))) {
    // A console that fails or times out (a booting emulator's may not answer yet) means "not this one".
    if ((await avdName(opts, one).catch(() => null)) === avd) return one;
  }
  return null;
}

export async function bootCompleted(opts, serial) {
  return (await text(opts, onDevice(serial, "shell", "getprop", "sys.boot_completed"))).trim() === "1";
}

export async function appInstalled(opts, serial) {
  const app = setting(opts, "appId");
  const listed = await text(opts, onDevice(serial, "shell", "pm", "list", "packages", app));
  return listed.split("\n").some((line) => line.trim() === `package:${app}`);
}

/** Opens a deep link in the app. The device's shell would read the `&` as "run in the background", so it's quoted. */
export async function openLink(opts, serial, link) {
  await startView(opts, serial, link);
}

/**
 * Opens the dev client on Metro's address, so the bundle is loaded before the first gallery link: a cold gallery
 * link lands in the dev client's launcher instead. The three flags keep the dev client's own screens out of every
 * capture: no onboarding, no floating "Tools" gear, no dev menu opened at launch.
 */
export async function openDevClient(opts, serial, port) {
  await startView(
    opts,
    serial,
    `${setting(opts, "devClientScheme")}://expo-development-client/?url=http%3A%2F%2Flocalhost%3A${port}&__expo_disable_fab=1&__expo_disable_onboarding=1&__expo_disable_auto_launch=1`,
  );
}

async function startView(opts, serial, link) {
  const { stdout, stderr } = await adbRun(opts, onDevice(serial, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", `'${link}'`, setting(opts, "appId")));
  const said = `${stdout.toString("utf8")}${stderr}`;
  if (/Error|Exception/.test(said)) throw new Error(`Couldn't open ${link}: ${said.trim().split("\n")[0]}`);
}

/**
 * True when the gallery's ready file holds exactly `gallery-ready <id> <theme>`. It's read with `run-as`, which a
 * development build allows, rather than from `uiautomator dump`: a dump waits for the screen to go idle, and a thread
 * whose card or composer keeps changing never does. A missing file reads as not ready.
 */
export async function readyMarked(opts, serial, id, theme) {
  const { code, stdout } = await adbRun(opts, onDevice(serial, "exec-out", "run-as", setting(opts, "appId"), "cat", setting(opts, "readyFile")));
  return code === 0 && stdout.toString("utf8").trim() === `gallery-ready ${id} ${theme}`;
}

/**
 * Deletes the ready file, so a mark left by an earlier entry or run can't pass for the next one. Throws when it
 * can't: a stale mark passing as ready is the false capture this file exists to prevent. `rm -f` succeeds when
 * there's no file.
 */
export async function clearReadyMark(opts, serial) {
  const { code, stderr } = await adbRun(opts, onDevice(serial, "exec-out", "run-as", setting(opts, "appId"), "rm", "-f", setting(opts, "readyFile")));
  if (code !== 0) throw new Error(`Couldn't clear the ready file (adb exit ${code}): ${stderr.trim().split("\n")[0] ?? ""}`);
}

export async function screencap(opts, serial, file) {
  const { stdout } = await adbRun(opts, onDevice(serial, "exec-out", "screencap", "-p"));
  if (!stdout.subarray(0, 4).equals(PNG_SIGNATURE)) throw new Error(`adb gave no picture for ${file}.`);
  writeFileSync(file, stdout);
}

/** The status bar pinned (12:00, full battery, full signal, no notifications), or released. */
export async function demoMode(opts, serial, on) {
  const broadcast = (...extras) => adbRun(opts, onDevice(serial, "shell", "am", "broadcast", "-a", DEMO, "-e", "command", ...extras));
  if (!on) {
    await broadcast("exit");
    return;
  }
  await adbRun(opts, onDevice(serial, "shell", "settings", "put", "global", "sysui_demo_allowed", "1"));
  await broadcast("enter");
  await broadcast("clock", "-e", "hhmm", "1200");
  await broadcast("battery", "-e", "level", "100", "-e", "plugged", "false");
  await broadcast("network", "-e", "wifi", "show", "-e", "level", "4");
  await broadcast("notifications", "-e", "visible", "false");
}

/** True when Metro answers on its port. Anything else, no answer included, is false: it never waits past `timeoutMs`. */
export function metroRunning(port, { timeoutMs = 2_000 } = {}) {
  return new Promise((done) => {
    const request = get({ host: "localhost", port, path: "/status", timeout: timeoutMs }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => done(body.includes("packager-status:running")));
      response.on("error", () => done(false));
    });
    // A server that accepts and never answers ends here: destroying the request doesn't always raise 'error'.
    request.on("timeout", () => {
      request.destroy();
      done(false);
    });
    request.on("error", () => done(false));
  });
}
