#!/usr/bin/env node
// Deploys the default branch (AGENTS.md, Pull requests) to the target agentkit.config.json names (deploy.adapter).
// It builds from an export of origin's committed tree, never from the working directory, so nothing unmerged or
// untracked ships. It skips the deploy when nothing that ships changed since the live release's commit. After a
// deploy it checks the health route, and if the new release isn't healthy it redeploys the release that was live
// before, with the settings of the commit that release was built from. The target's own work is its adapter's
// (lib/deploy-fly.mjs); with deploy.adapter "none" there is nothing to deploy.
// Usage: node tools/guardrails/deploy-approved.mjs [--dry-run]
//   --dry-run  builds the default branch on the target's builder and stops there: nothing is deployed.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "./lib/config.mjs";
import { imageLabel, rollbackCommit, shippedPaths, waitForHealthy } from "./lib/deploy.mjs";
import { flyAdapter } from "./lib/deploy-fly.mjs";

// One line per target. A new target is a module shaped like lib/deploy-fly.mjs, and its name here.
const ADAPTERS = { fly: flyAdapter };

/** A failed release that was rolled back: something did change, unlike the other failures. */
class RolledBack extends Error {}

const short = (sha) => sha.slice(0, 7);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new Error(`${command} ${args.join(" ")} could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

const hasCommit = (root) => (sha) => spawnSync("git", ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], { cwd: root, stdio: "ignore" }).status === 0;

/** Writes a commit's tree, as committed, into a new folder under `dir`. */
function exportTree(root, commit, dir, name) {
  const target = join(dir, name);
  mkdirSync(target);
  run("git", ["archive", "--format=tar", `--output=${join(dir, `${name}.tar`)}`, commit], root);
  run("tar", ["-xf", join(dir, `${name}.tar`), "-C", target]);
  return target;
}

/** True when the live release's commit is known and nothing that ships changed between it and `sha`. */
function nothingToShip(root, live, sha, notShipped) {
  if (!live || !hasCommit(root)(live)) return false;
  return shippedPaths(run("git", ["diff", "--name-only", live, sha], root).split("\n").filter(Boolean), notShipped).length === 0;
}

async function rollBack({ adapter, config, root, dir, source, before, sha }) {
  if (adapter.live() === before) throw new Error(`${short(sha)} didn't go live, and ${before} is still running. See the deploy's output above.`);
  const previous = rollbackCommit(before, hasCommit(root));
  const settings = previous ? exportTree(root, previous, dir, "previous") : source;
  const from = previous ? short(previous) : `${config.defaultBranch}, since git doesn't know the commit the old release was built from`;
  process.stderr.write(`${short(sha)} isn't healthy. Rolling back to ${before}, with the settings of ${from}.\n`);
  const healthy = adapter.rollback(before, settings) && (await waitForHealthy(config.deploy.healthUrl));
  if (healthy) throw new RolledBack(`${short(sha)} wasn't healthy, so ${adapter.target} is back on ${before}, which is.`);
  throw new Error(`${short(sha)} wasn't healthy, and the rollback to ${before} isn't either. Check ${adapter.target} now.`);
}

async function main(dryRun) {
  const root = run("git", ["rev-parse", "--show-toplevel"], process.cwd());
  const config = readConfig(root);
  if (config.deploy.adapter === "none") {
    process.stdout.write('Nothing to deploy: agentkit.config.json sets deploy.adapter to "none".\n');
    return;
  }
  const branch = config.defaultBranch;
  run("git", ["fetch", "--quiet", "origin", branch], root);
  const sha = run("git", ["rev-parse", `origin/${branch}`], root);
  const adapter = ADAPTERS[config.deploy.adapter](config, (command, args) => run(command, args, root));
  const before = adapter.live();
  const live = adapter.commitOf(before);
  if (!dryRun && nothingToShip(root, live, sha, config.deploy.notShipped)) {
    process.stdout.write(`Nothing to deploy: ${adapter.target} runs ${short(live)}, and nothing that ships changed up to ${short(sha)}.\n`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), `${config.project}-deploy-`));
  try {
    const source = exportTree(root, sha, dir, "source");
    const label = imageLabel(sha, new Date(), branch);
    if (dryRun) {
      if (!adapter.build(source, label)) throw new Error(`the build of ${short(sha)} failed.`);
      process.stdout.write(`Built ${short(sha)} as ${label} without deploying. ${adapter.target} still runs ${before}.\n`);
      return;
    }
    if (adapter.release(source, label) && (await waitForHealthy(config.deploy.healthUrl))) {
      process.stdout.write(`Deployed ${short(sha)} to ${adapter.target} as ${label}. ${config.deploy.healthUrl} answers 200.\n`);
      return;
    }
    await rollBack({ adapter, config, root, dir, source, before, sha });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const USAGE = "Usage: node tools/guardrails/deploy-approved.mjs [--dry-run]";
const args = process.argv.slice(2);
try {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${USAGE}\nDeploys the default branch to agentkit.config.json's deploy target and rolls back if it isn't healthy. --dry-run only builds it.\n`);
  } else {
    if (args.some((arg) => arg !== "--dry-run")) throw new Error(USAGE);
    await main(args.includes("--dry-run"));
  }
} catch (error) {
  console.error(`${error instanceof RolledBack ? "Rolled back" : "Not deployed"}: ${error.message}`);
  process.exitCode = 1;
}
