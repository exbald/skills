// One runner per wave: a pidfile beside the wave's checkout names the runner building it and,
// once it starts one, the builder's process group. A runner that takes over a dead one's wave stops that
// builder first, so two builders never work in one checkout.
import { existsSync, openSync, readFileSync, rmSync, writeFileSync, closeSync } from "node:fs";

/** Whether a process (or, negative, a process group) lives. Only ESRCH means gone: EPERM is another user's. */
export function isAlive(pid, kill = process.kill.bind(process)) {
  if (!Number.isInteger(pid) || pid === 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

/** The claim a pidfile holds: { runner, builder }. An older file holds just the runner's pid. */
export function readClaim(pidfile) {
  const text = readFileSync(pidfile, "utf8").trim();
  try {
    const claim = JSON.parse(text);
    if (claim && typeof claim === "object") return { runner: Number(claim.runner), builder: claim.builder === null ? null : Number(claim.builder) };
  } catch {
    // A bare pid.
  }
  return { runner: Number(text), builder: null };
}

const writeClaim = (pidfile, claim, flag) => {
  const fd = openSync(pidfile, flag);
  try {
    writeFileSync(fd, `${JSON.stringify(claim)}\n`);
  } finally {
    closeSync(fd);
  }
};

/**
 * Claims the wave for runner `pid`. Refuses while the runner a pidfile names lives. Takes over a pidfile a dead
 * runner left, after stopping the builder group it recorded (SIGKILL, since its runner can't stop it any more).
 * The file is created exclusively, so two runners starting together can't both claim it. Returns
 * { recordBuilder(pgid), release() }; release removes the pidfile only while it's still this runner's.
 */
export function claimWave(pidfile, { pid = process.pid, kill = process.kill.bind(process) } = {}) {
  if (existsSync(pidfile)) {
    const held = readClaim(pidfile);
    if (isAlive(held.runner, kill)) throw new Error(`Runner ${held.runner} is already building this wave (${pidfile}).`);
    if (held.builder && isAlive(-held.builder, kill)) {
      try {
        kill(-held.builder, "SIGKILL");
      } catch {
        // Gone in between.
      }
    }
    rmSync(pidfile, { force: true });
  }
  try {
    writeClaim(pidfile, { runner: pid, builder: null }, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Another runner claimed this wave just now (${pidfile}).`);
    throw error;
  }
  const mine = () => existsSync(pidfile) && readClaim(pidfile).runner === pid;
  return {
    recordBuilder: (pgid) => {
      if (mine()) writeClaim(pidfile, { runner: pid, builder: pgid }, "w");
    },
    release: () => {
      if (mine()) rmSync(pidfile);
    },
  };
}
