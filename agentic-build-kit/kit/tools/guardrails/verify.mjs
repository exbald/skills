#!/usr/bin/env node
// Runs the project's verification and, when it passes, writes specs/.verified with the git tree
// hash of exactly what was checked. The Stop hook compares that hash with HEAD^{tree}, so the order
// is: finish the task, run this, commit everything in one commit, push.
// Usage: node tools/guardrails/verify.mjs (from anywhere in the repository)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readConfig } from "./lib/config.mjs";
import { repoRoot, workingTreeHash } from "./lib/git.mjs";
import { STAMP_FILE, clearStamp, verifyCommand, writeStamp } from "./lib/state.mjs";

function readPackage(root) {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const root = repoRoot(process.cwd());
  if (!root) {
    console.error("verify: not inside a git repository");
    return 1;
  }
  clearStamp(root);
  // Read strictly: a broken agentkit.config.json fails verification rather than quietly running the default command.
  const { command, args } = verifyCommand(readPackage(root), readConfig(root));
  const label = [command, ...args].join(" ");
  const tree = workingTreeHash(root);
  process.stdout.write(`verify: running ${label}\n`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) {
    console.error(`verify: could not run ${label}: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    console.error(`verify: ${label} failed (${result.status ?? result.signal}), so no stamp was written`);
    return result.status ?? 1;
  }
  if (workingTreeHash(root) !== tree) {
    console.error("verify: files changed while verification ran, so no stamp was written. Run it again.");
    return 1;
  }
  writeStamp(root, { tree, command: label, at: new Date().toISOString() });
  process.stdout.write(`verify: passed. ${STAMP_FILE} records tree ${tree}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`verify: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
