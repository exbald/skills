#!/usr/bin/env node
// Checks spec folders against the format in specs/README.md, and checks that tasks which can run
// together don't share files. See tools/spec-check/README.md.
// Usage: node tools/spec-check/check.mjs [--ready] [--across] [specs/NN-name ...]
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { CONFIG_FILE, ConfigError, readConfig } from "../guardrails/lib/config.mjs";
import { formatProblems } from "./lib/format.mjs";
import { acrossOverlaps, waveOverlaps } from "./lib/overlap.mjs";
import { readinessProblems } from "./lib/ready.mjs";
import { readSpec, specDirs } from "./lib/spec.mjs";

const USAGE = "Usage: node tools/spec-check/check.mjs [--ready] [--across] [specs/NN-name ...]";
const OPTIONS = new Set(["--ready", "--across"]);

class UsageError extends Error {}

/** The nearest folder, starting at `start` and going up, that contains specs/. */
function findRoot(start) {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, "specs")) && statSync(join(current, "specs")).isDirectory()) return realpathSync(current);
    const parent = dirname(current);
    if (parent === current) throw new UsageError("no specs/ folder found here or above");
    current = parent;
  }
}

function parseArgs(argv) {
  const flags = new Set();
  const folders = [];
  for (const arg of argv) {
    if (arg.startsWith("-")) {
      if (!OPTIONS.has(arg)) throw new UsageError(`unknown option ${arg}`);
      flags.add(arg);
    } else folders.push(arg);
  }
  return { ready: flags.has("--ready"), across: flags.has("--across"), folders };
}

function resolveFolders(root, folders) {
  if (folders.length === 0) return specDirs(root);
  return folders.map((folder) => {
    const abs = resolve(folder);
    const rel = relative(root, existsSync(abs) ? realpathSync(abs) : abs).split("\\").join("/");
    if (!existsSync(abs) || !statSync(abs).isDirectory() || !specDirs(root).includes(rel)) {
      throw new UsageError(`${folder} isn't a spec folder`);
    }
    return rel;
  });
}

/** The config, or a problem saying why it can't be read: a broken file fails the check, as it fails verify. */
function settings(root) {
  try {
    return { config: readConfig(root), problems: [] };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { config: null, problems: [{ file: CONFIG_FILE, message: error.message.replace(`${CONFIG_FILE}: `, "") }] };
  }
}

function collectProblems(root, specs, { ready, across }) {
  const { config, problems: configProblems } = settings(root);
  const lockfile = config ? config.lockfile : "package-lock.json";
  const problems = specs.flatMap((spec) => [
    ...formatProblems(root, spec, { lockfile }),
    ...waveOverlaps(spec),
    ...(ready ? readinessProblems(root, spec) : []),
  ]);
  problems.unshift(...configProblems);
  if (across) {
    specs.forEach((a, index) => {
      for (const b of specs.slice(index + 1)) problems.push(...acrossOverlaps(a, b));
    });
  }
  return problems;
}

function main(argv) {
  const options = parseArgs(argv);
  const root = findRoot(process.cwd());
  const dirs = resolveFolders(root, options.folders);
  if (options.across && dirs.length < 2) throw new UsageError("--across needs at least two specs");
  const specs = dirs.map((dir) => readSpec(root, dir));
  const problems = collectProblems(root, specs, options);
  for (const { file, message } of problems) process.stdout.write(`${file}: ${message}\n`);
  const tasks = specs.reduce((sum, spec) => sum + spec.tasks.length, 0);
  process.stdout.write(
    problems.length === 0
      ? `spec-check: ${specs.length} spec(s), ${tasks} tasks, no problems.\n`
      : `spec-check: ${problems.length} problem(s).\n`,
  );
  return problems.length === 0 ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  process.stderr.write(`spec-check: ${error.message}\n${USAGE}\n`);
  process.exitCode = 2;
}
