// The files the guardrails keep in specs/, all gitignored: the task marker, the verification stamp
// and the Stop hook's count of consecutive blocks. Also the verification command itself.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MARKER_FILE = "specs/.current-task";
export const STAMP_FILE = "specs/.verified";
export const BLOCKS_FILE = "specs/.stop-blocks";
export const LEDGER_FILE = "specs/LEDGER.md";
export const STATE_FILES = Object.freeze([MARKER_FILE, STAMP_FILE, BLOCKS_FILE]);

/** The stamp written by verify.mjs ({ tree, command, at }), or null when missing or unreadable. */
export function readStamp(root) {
  try {
    const stamp = JSON.parse(readFileSync(join(root, STAMP_FILE), "utf8"));
    return typeof stamp?.tree === "string" ? stamp : null;
  } catch {
    return null;
  }
}

export function writeStamp(root, stamp) {
  mkdirSync(dirname(join(root, STAMP_FILE)), { recursive: true });
  writeFileSync(join(root, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`);
}

export function clearStamp(root) {
  rmSync(join(root, STAMP_FILE), { force: true });
}

export function readBlockCount(root) {
  try {
    const count = Number.parseInt(readFileSync(join(root, BLOCKS_FILE), "utf8"), 10);
    return Number.isInteger(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

export function writeBlockCount(root, count) {
  writeFileSync(join(root, BLOCKS_FILE), `${count}\n`);
}

/** Puts the counter back to 0, without creating the file when there is nothing to reset. */
export function resetBlockCount(root) {
  if (existsSync(join(root, BLOCKS_FILE))) writeBlockCount(root, 0);
}

/**
 * The verification command: agentkit.config.json's verify.command when it names one, else `npm run verify` once
 * package.json has that script, and until then the TypeScript check.
 */
export function verifyCommand(pkg, config = null) {
  const [command, ...args] = config?.verify?.command ?? [];
  if (command) return { command, args };
  return typeof pkg?.scripts?.verify === "string"
    ? { command: "npm", args: ["run", "verify"] }
    : { command: "npx", args: ["tsc", "--noEmit", "-p", "."] };
}
