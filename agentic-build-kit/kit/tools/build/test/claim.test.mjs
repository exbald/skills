import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { claimWave, isAlive, readClaim } from "../lib/claim.mjs";

const failing = (code) => () => {
  throw Object.assign(new Error(code), { code });
};

describe("one runner per wave", () => {
  let dir;
  let pidfile;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "run-wave-claim-"));
    pidfile = join(dir, "build-spec-02-wave-01.pid");
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("counts a process or group as alive unless the system says it's gone", () => {
    assert.equal(isAlive(process.pid), true);
    assert.equal(isAlive(41, failing("ESRCH")), false);
    assert.equal(isAlive(41, failing("EPERM")), true, "another user's live process");
    assert.equal(isAlive(-41, () => true), true, "a process group");
    assert.equal(isAlive(Number.NaN), false);
    assert.equal(isAlive(0), false);
  });

  it("claims a free wave, records its builder, and releases only its own claim", () => {
    const claim = claimWave(pidfile, { pid: 4242, kill: failing("ESRCH") });
    assert.deepEqual(readClaim(pidfile), { runner: 4242, builder: null });
    claim.recordBuilder(7000);
    assert.deepEqual(readClaim(pidfile), { runner: 4242, builder: 7000 });
    writeFileSync(pidfile, `${JSON.stringify({ runner: 5151, builder: null })}\n`);
    claim.release();
    assert.equal(existsSync(pidfile), true, "a later runner's claim stays");
    rmSync(pidfile);
  });

  it("refuses while the runner it names lives, even as another user", () => {
    writeFileSync(pidfile, `${JSON.stringify({ runner: 4242, builder: 7000 })}\n`);
    assert.throws(() => claimWave(pidfile, { pid: 5151, kill: () => true }), /Runner 4242 is already building this wave/);
    assert.throws(() => claimWave(pidfile, { pid: 5151, kill: failing("EPERM") }), /Runner 4242/);
  });

  it("stops a dead runner's builder before taking over, so two builders never share a checkout", () => {
    writeFileSync(pidfile, `${JSON.stringify({ runner: 4242, builder: 7000 })}\n`);
    const signals = [];
    const kill = (pid, signal) => {
      signals.push([pid, signal]);
      if (pid === 4242) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    };
    const claim = claimWave(pidfile, { pid: 5151, kill });
    assert.deepEqual(signals, [[4242, 0], [-7000, 0], [-7000, "SIGKILL"]]);
    assert.deepEqual(readClaim(pidfile), { runner: 5151, builder: null });
    claim.release();
    assert.equal(existsSync(pidfile), false);
  });

  it("reads an older pidfile that holds only the runner's pid", () => {
    writeFileSync(pidfile, "4242\n");
    assert.deepEqual(readClaim(pidfile), { runner: 4242, builder: null });
    rmSync(pidfile);
  });
});
