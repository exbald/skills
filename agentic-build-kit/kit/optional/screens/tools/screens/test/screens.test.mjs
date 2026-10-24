import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, USAGE } from "../lib/args.mjs";
import { adbRun, avdName, chooseDevice, clearReadyMark, demoMode, deviceOptions, devicesAttached, metroRunning, openDevClient, readyMarked } from "../lib/device.mjs";
import { comparisonPage } from "../lib/page.mjs";
import { designFor, galleryLink, pairsFor } from "../lib/pairs.mjs";
import { DEFAULTS, screensSettings } from "../lib/settings.mjs";

// The decisions the capture script makes, without a device: the settings, the arguments, the pairs, the page, and the
// adb calls against a stand-in adb written to a temporary folder (a real one can hang, and CI has none).
const project = "acme";
const repoRoot = "/work/acme";
const ids = ["S01-welcome", "S03-thread", "S03-thread-login", "S08-approval"];
const now = new Date(2026, 9, 23, 14, 5, 9);
const REQUIRED = { appId: "com.acme.app", linkScheme: "acme", avd: "acme-pixel8-api35", idsFile: "apps/mobile/src/dev/gallery/ids.json" };
const SETTINGS = screensSettings({ ...REQUIRED, comparedWith: { "S03-thread-login": "S03-thread" } });
const parse = (argv, env = {}) => parseArgs(argv, { repoRoot, ids, now, env, settings: SETTINGS, project });

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "screens-test-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in adb: a Node script that logs each call's arguments to `calls` and runs `body`, which sees `args`. */
function standIn(name, body) {
  const file = join(dir, name);
  const calls = `${file}.calls`;
  writeFileSync(file, `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");\n${body}\n`);
  chmodSync(file, 0o755);
  const logged = () => readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { adb: file, logged };
}

describe("the settings", () => {
  it("fills in every default from the four required keys, and keeps what's given", () => {
    const settings = screensSettings(REQUIRED);
    assert.deepEqual({ ...settings, designFiles: { ...settings.designFiles }, comparedWith: { ...settings.comparedWith } }, {
      ...REQUIRED,
      galleryPath: "dev/gallery",
      devClientScheme: "exp+acme",
      appDir: "apps/mobile",
      readyFile: "files/gallery-ready",
      designRoot: "design/screens",
      designFiles: { dark: "screen.png", light: "screen-light.png" },
      comparedWith: {},
      idPattern: "^S\\d{2}-[a-z0-9-]+$",
      metroPort: 8081,
      settleMs: 2000,
    });
    assert.equal(screensSettings({ ...REQUIRED, metroPort: 8082, devClientScheme: "exp+acme-dev" }).metroPort, 8082);
    assert.equal(screensSettings({ ...REQUIRED, devClientScheme: "exp+acme-dev" }).devClientScheme, "exp+acme-dev");
    assert.ok(Object.isFrozen(SETTINGS) && Object.isFrozen(SETTINGS.comparedWith), "settings can't change under a run");
    assert.equal(DEFAULTS.settleMs, 2000);
  });

  it("names a missing section, and every missing required key", () => {
    for (const missing of [undefined, null, []]) assert.throws(() => screensSettings(missing), /has no screens section/);
    assert.throws(() => screensSettings({ linkScheme: "acme" }), /screens section has no appId, avd, idsFile\./);
  });

  it("refuses a key it doesn't know, and values that don't fit, naming the key", () => {
    assert.throws(() => screensSettings({ ...REQUIRED, avdName: "x" }), /unknown keys: avdName/);
    assert.throws(() => screensSettings({ ...REQUIRED, appId: "acme" }), /screens\.appId/);
    assert.throws(() => screensSettings({ ...REQUIRED, linkScheme: "ac me" }), /screens\.linkScheme/);
    assert.throws(() => screensSettings({ ...REQUIRED, idsFile: "../ids.json" }), /screens\.idsFile/);
    assert.throws(() => screensSettings({ ...REQUIRED, readyFile: "../x" }), /screens\.readyFile/);
    assert.throws(() => screensSettings({ ...REQUIRED, designFiles: { dark: "screen.png" } }), /screens\.designFiles/);
    assert.throws(() => screensSettings({ ...REQUIRED, metroPort: 70000 }), /screens\.metroPort/);
    assert.throws(() => screensSettings({ ...REQUIRED, settleMs: 0 }), /screens\.settleMs/);
    assert.throws(() => screensSettings({ ...REQUIRED, comparedWith: { "S03-thread-login": "../S03" } }), /screens\.comparedWith/);
  });

  it("refuses an id pattern that isn't one, doesn't match the whole id, or lets a path through", () => {
    assert.throws(() => screensSettings({ ...REQUIRED, idPattern: "^[" }), /screens\.idPattern isn't a regular expression/);
    assert.throws(() => screensSettings({ ...REQUIRED, idPattern: "S\\d{2}" }), /must match the whole id/);
    assert.throws(() => screensSettings({ ...REQUIRED, idPattern: "^.*$" }), /matches "": an id names a folder/);
    assert.throws(() => screensSettings({ ...REQUIRED, idPattern: "^[a-z./]+$" }), /matches "\.":/);
    assert.equal(screensSettings({ ...REQUIRED, idPattern: "^[a-z][a-z0-9-]*$" }).idPattern, "^[a-z][a-z0-9-]*$");
  });
});

describe("the arguments", () => {
  it("defaults to both themes, the settings' image and settle time, and an out folder beside the repository named by the time", () => {
    const options = parse([]);
    assert.deepEqual(options.themes, ["dark", "light"]);
    assert.equal(options.avd, "acme-pixel8-api35");
    assert.equal(options.only, null);
    assert.equal(options.settleMs, 2000);
    assert.equal(options.out, "/work/acme-builds/screens/2026-10-23-140509");
    const slower = parseArgs([], { repoRoot, ids, now, settings: screensSettings({ ...REQUIRED, settleMs: 2500 }), project });
    assert.equal(slower.settleMs, 2500);
  });

  it("defaults to the same <project>-builds folder from the main checkout and from a build clone", () => {
    const clone = parseArgs([], { repoRoot: "/work/acme-builds/build-spec-07-wave-04", ids, now, env: {}, settings: SETTINGS, project });
    assert.equal(clone.out, "/work/acme-builds/screens/2026-10-23-140509");
  });

  it("takes the serial from --serial or ANDROID_SERIAL, the flag first, or none at all", () => {
    assert.deepEqual(parse(["--serial", "emulator-5556"]).serial, { value: "emulator-5556", from: "--serial" });
    assert.deepEqual(parse([], { ANDROID_SERIAL: "emulator-5556" }).serial, { value: "emulator-5556", from: "ANDROID_SERIAL" });
    assert.deepEqual(parse(["--serial", "emulator-5558"], { ANDROID_SERIAL: "emulator-5556" }).serial, { value: "emulator-5558", from: "--serial" });
    assert.equal(parse([], {}).serial, null);
    // No env at all (the caller didn't pass one) reads as none given, not a crash.
    assert.equal(parseArgs([], { repoRoot, ids, now, settings: SETTINGS, project }).serial, null);
  });

  it("shows --serial in the usage line, and the flag needs a value", () => {
    assert.match(USAGE, /\[--serial <serial>\]/);
    assert.throws(() => parse(["--serial"]), /--serial needs a value/);
  });

  it("--only splits on commas", () => {
    assert.deepEqual(parse(["--only", "S03-thread,S08-approval"]).only, ["S03-thread", "S08-approval"]);
  });

  it("--only keeps the gallery's order and names each id once, whatever order it's given in", () => {
    assert.deepEqual(parse(["--only", "S08-approval,S01-welcome,S08-approval"]).only, ["S01-welcome", "S08-approval"]);
  });

  it("refuses an --only with no id in it", () => {
    for (const empty of ["", ","]) assert.throws(() => parse(["--only", empty]), /--only needs at least one id/);
  });

  it("refuses a theme that isn't dark or light", () => {
    assert.throws(() => parse(["--themes", "purple"]), /purple/);
    assert.deepEqual(parse(["--themes", "light"]).themes, ["light"]);
  });

  it("refuses an --out inside the repository", () => {
    assert.throws(() => parse(["--out", "/work/acme/shots"]), /inside the repository/);
    assert.equal(parse(["--out", "/work/elsewhere"]).out, "/work/elsewhere");
  });

  it("takes --settle-ms as a positive integer", () => {
    assert.equal(parse(["--settle-ms", "900"]).settleMs, 900);
    for (const bad of ["0", "-5", "abc", "1.5"]) assert.throws(() => parse(["--settle-ms", bad]), /--settle-ms/);
  });

  it("refuses an --only id that isn't in the gallery, naming it", () => {
    assert.throws(() => parse(["--only", "S03-thread,S99-nothing"]), /S99-nothing/);
  });
});

describe("the pairs", () => {
  it("builds the gallery link", () => {
    assert.equal(galleryLink("S03-thread", "light", SETTINGS), "acme://dev/gallery?screen=S03-thread&theme=light");
    const other = screensSettings({ ...REQUIRED, linkScheme: "acme-dev", galleryPath: "debug/screens" });
    assert.equal(galleryLink("S03-thread", "dark", other), "acme-dev://debug/screens?screen=S03-thread&theme=dark");
  });

  it("finds each theme's frozen design, or null, and borrows S03-thread's for the sign-in card", () => {
    const root = join(dir, "designs");
    for (const [folder, files] of [["S01-welcome", ["screen.png"]], ["S03-thread", ["screen.png", "screen-light.png"]]]) {
      mkdirSync(join(root, folder), { recursive: true });
      for (const file of files) writeFileSync(join(root, folder, file), "png");
    }
    assert.equal(designFor(root, "S03-thread", "dark", SETTINGS), join(root, "S03-thread", "screen.png"));
    assert.equal(designFor(root, "S03-thread", "light", SETTINGS), join(root, "S03-thread", "screen-light.png"));
    assert.equal(designFor(root, "S01-welcome", "light", SETTINGS), null);
    assert.equal(designFor(root, "S08-approval", "dark", SETTINGS), null);
    assert.equal(SETTINGS.comparedWith["S03-thread-login"], "S03-thread");
    assert.equal(designFor(root, "S03-thread-login", "dark", SETTINGS), join(root, "S03-thread", "screen.png"));
    assert.equal(designFor(root, "S03-thread-login", "dark", screensSettings(REQUIRED)), null, "no comparedWith, no borrowed design");
    const renamed = screensSettings({ ...REQUIRED, designFiles: { dark: "screen.png", light: "screen-day.png" } });
    assert.equal(designFor(root, "S03-thread", "light", renamed), null, "the light design's file name comes from the settings");
    const [pair] = pairsFor(["S03-thread-login"], ["dark"], { designRoot: root, outDir: "/out", settings: SETTINGS });
    assert.equal(pair.comparedWith, "S03-thread");
    assert.match(comparisonPage([pair], { outDir: "/out", captured: new Set(), project }), /S03-thread-login \(compared with S03-thread\)/);
  });

  it("throws on an id that isn't a design folder's name", () => {
    for (const bad of ["../x", "S3-thread", "S03-Thread"]) {
      assert.throws(() => pairsFor([bad], ["dark"], { designRoot: "/d", outDir: "/o", settings: SETTINGS }), /id/i);
    }
  });

  it("keeps the ids' order, dark before light", () => {
    const pairs = pairsFor(["S03-thread", "S01-welcome"], ["light", "dark"], { designRoot: "/d", outDir: "/o", settings: SETTINGS });
    assert.deepEqual(
      pairs.map((pair) => `${pair.id} ${pair.theme}`),
      ["S03-thread dark", "S03-thread light", "S01-welcome dark", "S01-welcome light"],
    );
    assert.equal(pairs[0].capture, "/o/S03-thread.dark.png");
    assert.equal(pairs[0].link, "acme://dev/gallery?screen=S03-thread&theme=dark");
  });
});

describe("the page", () => {
  const base = { link: "x", comparedWith: null };

  it("escapes what it is given, shows a missing image as missing, and has no script", () => {
    const pairs = [
      { ...base, id: "S01<b>", theme: "dark", capture: "/out/S01<b>.dark.png", design: "/repo/design/screens/S01/screen.png" },
      { ...base, id: "S02-home", theme: "dark", capture: "/out/S02-home.dark.png", design: null },
      { ...base, id: "S03-thread", theme: "dark", capture: "/out/S03-thread.dark.png", design: "/repo/design/screens/S03-thread/screen.png" },
    ];
    const html = comparisonPage(pairs, { outDir: "/out", captured: new Set(["S02-home.dark", "S01<b>.dark"]), project: "acme <dev>" });
    assert.match(html, /<title>acme &lt;dev&gt;: the screen check<\/title>/);
    assert.ok(!html.includes("S01<b>"));
    assert.match(html, /S01&lt;b&gt;/);
    assert.match(html, /no capture/);
    assert.match(html, /no frozen design/);
    assert.ok(!/<script/i.test(html));
    // Each theme's heading is above its row of figures, not a flex item beside them.
    assert.ok(!/<section class="pair">/.test(html));
    assert.match(html, /<h3>S02-home dark<\/h3>\n<div class="pair">/);
    // S01 has both images, S02 has its capture, and S03 has its design: four in all.
    assert.equal((html.match(/<img /g) ?? []).length, 4);
  });

  it("links the images by paths relative to the out folder", () => {
    const pair = { ...base, id: "S02-home", theme: "light", capture: "/work/acme-builds/screens/t/S02-home.light.png", design: "/work/acme/design/screens/S02-home/screen-light.png" };
    const html = comparisonPage([pair], { outDir: "/work/acme-builds/screens/t", captured: new Set(["S02-home.light"]), project });
    assert.match(html, /src="S02-home\.light\.png"/);
    assert.match(html, /src="\.\.\/\.\.\/\.\.\/acme\/design\/screens\/S02-home\/screen-light\.png"/);
    assert.ok(!html.includes('src="/'));
  });
});

describe("adb", () => {
  it("a hanging adb is stopped, by its PID, with a plain message", async () => {
    const pidfile = join(dir, "hang.pid");
    // A shell script writes its PID, then becomes the process that never exits. 
    const adb = join(dir, "adb-hang");
    writeFileSync(adb, `#!/bin/sh\n[ "$1" = warm ] && exit 0\necho $$ > ${pidfile}\nexec sleep 60\n`);
    chmodSync(adb, 0o755);
    // The first run of a new script can be slow on macOS (it's scanned), which would eat the timeout: run it once first.
    spawnSync(adb, ["warm"]);
    await assert.rejects(adbRun({ adb }, ["devices"], { timeoutMs: 1000 }), /adb didn't answer within .* seconds \(adb devices\)\. See "adb hangs" in tools\/screens\/README\.md\./);
    const pid = Number(readFileSync(pidfile, "utf8"));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  });

  it("lists the attached devices, two included, and none for offline", async () => {
    const two = standIn("adb-two", `process.stdout.write("List of devices attached\\nemulator-5554\\tdevice\\nR58M123ABC\\tdevice\\n\\n");`);
    assert.deepEqual(await devicesAttached({ adb: two.adb }), ["emulator-5554", "R58M123ABC"]);
    const offline = standIn("adb-offline", `process.stdout.write("List of devices attached\\nemulator-5554\\toffline\\n\\n");`);
    assert.deepEqual(await devicesAttached({ adb: offline.adb }), []);
  });

  it("asks an emulator's console for its image's name, the first line trimmed", async () => {
    const stub = standIn("adb-avd", `if (args.includes("emu")) process.stdout.write("acme-pixel8-api35\\r\\nOK\\r\\n");`);
    assert.equal(await avdName({ adb: stub.adb }, "emulator-5556"), "acme-pixel8-api35");
    assert.deepEqual(stub.logged(), [["-s", "emulator-5556", "emu", "avd", "name"]]);
  });

  it("chooses the attached emulator whose image is --avd; nothing but emu avd name reaches another device", async () => {
    const both = standIn(
      "adb-choose-two",
      `if (args[0] === "devices") process.stdout.write("List of devices attached\\nemulator-5554\\tdevice\\nR58M123ABC\\tdevice\\nemulator-5556\\tdevice\\n\\n");`
        + ` else process.stdout.write(args[1] === "emulator-5556" ? "acme-pixel8-api35\\r\\nOK\\r\\n" : "qaiz-pixel8-api35\\r\\nOK\\r\\n");`,
    );
    assert.equal(await chooseDevice({ adb: both.adb }, { serial: null, avd: "acme-pixel8-api35" }), "emulator-5556");
    assert.deepEqual(both.logged().filter((call) => call.includes("emulator-5554")), [["-s", "emulator-5554", "emu", "avd", "name"]]);
    assert.deepEqual(both.logged().filter((call) => call.includes("R58M123ABC")), []);

    // Only another project's emulator attached: none is chosen, so the script boots --avd. Still nothing else to it.
    const alone = standIn(
      "adb-choose-one",
      `if (args[0] === "devices") process.stdout.write("List of devices attached\\nemulator-5554\\tdevice\\n\\n");`
        + ` else process.stdout.write("qaiz-pixel8-api35\\r\\nOK\\r\\n");`,
    );
    assert.equal(await chooseDevice({ adb: alone.adb }, { serial: null, avd: "acme-pixel8-api35" }), null);
    assert.deepEqual(alone.logged().filter((call) => call.includes("emulator-5554")), [["-s", "emulator-5554", "emu", "avd", "name"]]);
  });

  it("uses a named serial alone, and a missing one fails naming where it came from, after only adb devices", async () => {
    const attached = standIn("adb-named-yes", `if (args[0] === "devices") process.stdout.write("List of devices attached\\nR58M123ABC\\tdevice\\n\\n");`);
    assert.equal(await chooseDevice({ adb: attached.adb }, { serial: { value: "R58M123ABC", from: "--serial" }, avd: "acme-pixel8-api35" }), "R58M123ABC");
    assert.deepEqual(attached.logged(), [["devices"]]);

    const missing = standIn("adb-named-no", `if (args[0] === "devices") process.stdout.write("List of devices attached\\nemulator-5554\\tdevice\\n\\n");`);
    await assert.rejects(
      chooseDevice({ adb: missing.adb }, { serial: { value: "emulator-5556", from: "--serial" }, avd: "acme-pixel8-api35" }),
      /emulator-5556 isn't attached: start it, or run without --serial\./,
    );
    await assert.rejects(
      chooseDevice({ adb: missing.adb }, { serial: { value: "emulator-5556", from: "ANDROID_SERIAL" }, avd: "acme-pixel8-api35" }),
      /emulator-5556 \(from ANDROID_SERIAL\) isn't attached: start it, or unset ANDROID_SERIAL\./,
    );
    assert.deepEqual(missing.logged(), [["devices"], ["devices"]]);
  });

  it("opens the dev client on the bundle's address, its own screens kept away, quoted as a gallery link", async () => {
    const stub = standIn("adb-dev-client", "");
    await openDevClient(deviceOptions(stub.adb, SETTINGS), "emulator-5554", 8081);
    assert.deepEqual(stub.logged(), [
      ["-s", "emulator-5554", "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d",
        "'exp+acme://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081&__expo_disable_fab=1&__expo_disable_onboarding=1&__expo_disable_auto_launch=1'",
        "com.acme.app"],
    ]);
  });

  it("sees the ready mark for its own id and theme only, read from the app's ready file", async () => {
    const stub = standIn("adb-ready", `if (args.includes("cat")) process.stdout.write("gallery-ready S03-thread dark\\n");`);
    const opts = deviceOptions(stub.adb, SETTINGS);
    assert.equal(await readyMarked(opts, "emulator-5554", "S03-thread", "dark"), true);
    assert.equal(await readyMarked(opts, "emulator-5554", "S03-thread", "light"), false);
    assert.equal(await readyMarked(opts, "emulator-5554", "S03-thread-cap", "dark"), false);
    assert.deepEqual(stub.logged()[0], ["-s", "emulator-5554", "exec-out", "run-as", "com.acme.app", "cat", "files/gallery-ready"]);
  });

  it("reads a missing ready file as not ready, and clears the file with run-as", async () => {
    const stub = standIn("adb-no-ready", `if (args.includes("cat")) { process.stderr.write("cat: files/gallery-ready: No such file or directory\\n"); process.exit(1); }`);
    const opts = deviceOptions(stub.adb, SETTINGS);
    assert.equal(await readyMarked(opts, "emulator-5554", "S03-thread", "dark"), false);
    await clearReadyMark(opts, "emulator-5554");
    assert.deepEqual(stub.logged()[1], ["-s", "emulator-5554", "exec-out", "run-as", "com.acme.app", "rm", "-f", "files/gallery-ready"]);
  });

  it("fails loudly when the ready file can't be cleared, so a stale mark never passes", async () => {
    const stub = standIn("adb-no-clear", `if (args.includes("rm")) { process.stderr.write("run-as: package not debuggable: com.acme.app\\n"); process.exit(1); }`);
    await assert.rejects(clearReadyMark(deviceOptions(stub.adb, SETTINGS), "emulator-5554"), /Couldn't clear the ready file \(adb exit 1\): run-as: package not debuggable/);
  });

  it("refuses a call that reaches the app when no app is named, before adb runs", async () => {
    const stub = standIn("adb-no-app", "");
    await assert.rejects(readyMarked({ adb: stub.adb }, "emulator-5554", "S03-thread", "dark"), /No appId for this adb call/);
    await assert.rejects(openDevClient({ adb: stub.adb, appId: "com.acme.app" }, "emulator-5554", 8081), /No devClientScheme for this adb call/);
    assert.throws(() => stub.logged(), /ENOENT/, "adb never ran");
  });

  it("pins the status bar in six commands, and releases it", async () => {
    const stub = standIn("adb-demo", "");
    await demoMode({ adb: stub.adb }, "emulator-5554", true);
    const broadcast = (...extras) => ["-s", "emulator-5554", "shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", ...extras];
    assert.deepEqual(stub.logged(), [
      ["-s", "emulator-5554", "shell", "settings", "put", "global", "sysui_demo_allowed", "1"],
      broadcast("enter"),
      broadcast("clock", "-e", "hhmm", "1200"),
      broadcast("battery", "-e", "level", "100", "-e", "plugged", "false"),
      broadcast("network", "-e", "wifi", "show", "-e", "level", "4"),
      broadcast("notifications", "-e", "visible", "false"),
    ]);
    await sleep(0);
    await demoMode({ adb: stub.adb }, "emulator-5554", false);
    assert.deepEqual(stub.logged().at(-1), broadcast("exit"));
  });
});

describe("Metro's status", () => {
  const listen = (server) => new Promise((done) => server.listen(0, "127.0.0.1", () => done(server.address().port)));

  it("is true for a Metro that's running, and false for a closed port or a server that never answers", async () => {
    const metro = createServer((_request, response) => response.end("packager-status:running"));
    const silent = createSocketServer(() => {});
    const [metroPort, silentPort] = [await listen(metro), await listen(silent)];
    const closed = createServer();
    const closedPort = await listen(closed);
    await new Promise((done) => closed.close(done));
    try {
      assert.equal(await metroRunning(metroPort), true);
      assert.equal(await metroRunning(closedPort), false);
      // A hang here would end the test by its own timeout instead of the answer.
      assert.equal(await metroRunning(silentPort, { timeoutMs: 200 }), false);
    } finally {
      metro.close();
      silent.close();
      silent.closeAllConnections?.();
    }
  });
});
