#!/usr/bin/env node
// Sets a repository up for agent builds: copies the kit (the agent contract, the guardrails, the spec checker, the wave
// runner, the records and the harness wiring), fills its {{PLACEHOLDERS}}, writes agentkit.config.json, and prints what
// is left for a person to do. It never overwrites a kit file unless --force: when any exists already, it writes
// nothing and names them. The files a repository usually has already (.gitignore, CLAUDE.md, package.json and
// .claude/settings.json) are merged instead, and a merge only ever adds. Node's own modules only.
// Usage: node scripts/init.mjs <target-dir> [options]   (--help lists them)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { configFrom } from "../kit/tools/guardrails/lib/config.mjs";
import { configFile, fill, githubRepo, mergeClaudeMd, mergeClaudeSettings, mergeGitignore, mergePackageJson, parseArgs, placeholders, USAGE } from "./lib/kit.mjs";

const KIT = fileURLToPath(new URL("../kit/", import.meta.url));
const SCREENS = join(KIT, "optional", "screens");
// Files a repository usually has already: merged, never overwritten, and never a conflict.
const MERGED = new Set(["CLAUDE.md", ".claude/settings.json"]);

/** A failure with a plain message for the person running init: printed as it is, exit 1. */
class Failure extends Error {}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** The values init would use without asking: what the flags say, else what the repository says, else the defaults. */
function defaultsFor(target, options) {
  const remoteHead = git(target, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])?.replace(/^origin\//, "");
  const lockfile = ["pnpm-lock.yaml", "yarn.lock"].find((name) => existsSync(join(target, name))) ?? "package-lock.json";
  return {
    project: options.project ?? basename(target),
    owner: options.owner ?? git(target, ["config", "user.name"]) ?? "the project owner",
    repo: options.repo ?? githubRepo(git(target, ["remote", "get-url", "origin"])),
    defaultBranch: options.defaultBranch ?? remoteHead ?? git(target, ["symbolic-ref", "--short", "HEAD"]) ?? "main",
    reviewerLogin: options.reviewerLogin ?? null,
    reviewerName: options.reviewerName ?? "the reviewer bot",
    reviewerTrigger: options.reviewerTrigger ?? "/review",
    deploy: options.deploy ?? "none",
    flyApp: options.flyApp ?? null,
    healthUrl: options.healthUrl ?? null,
    withScreens: options.withScreens,
    lockfile,
    date: new Date().toLocaleDateString("en-CA"),
  };
}

/** Asks for each value the flags didn't give, its default in brackets: Enter keeps it. Only on a terminal, without --yes. */
async function ask(values, options) {
  if (options.yes || !process.stdin.isTTY) return values;
  const questions = [
    ["project", "Project name"],
    ["owner", "Owner (decides what agents can't)"],
    ["repo", "GitHub repository (owner/name)"],
    ["defaultBranch", "Default branch"],
    ["reviewerLogin", "Reviewer bot's GitHub login"],
    ["deploy", "Deploy target (none or fly)"],
  ];
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let answers = { ...values };
    for (const [key, question] of questions) {
      if (options[key] !== undefined) continue;
      const answer = (await prompt.question(`${question} [${answers[key] ?? "none"}]: `)).trim();
      if (answer !== "") answers = { ...answers, [key]: answer };
    }
    if (answers.deploy === "fly" && options.flyApp === undefined) answers = { ...answers, flyApp: (await prompt.question("Fly app: ")).trim() || null };
    if (answers.deploy === "fly" && options.healthUrl === undefined) answers = { ...answers, healthUrl: (await prompt.question("Health URL: ")).trim() || null };
    return answers;
  } finally {
    prompt.close();
  }
}

/** Every file under `dir`, as paths relative to it, leaving out what macOS's Finder leaves behind. */
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.name === ".DS_Store") return [];
    return entry.isDirectory() ? walk(path, base) : [relative(base, path)];
  });
}

/** What init copies: { from, to, template } for each kit file, the optional screens module with --with-screens. */
function kitFiles(withScreens) {
  const files = [
    ...walk(KIT).filter((rel) => !rel.startsWith("optional/")).map((rel) => ({ from: join(KIT, rel), rel })),
    ...(withScreens ? walk(SCREENS).map((rel) => ({ from: join(SCREENS, rel), rel })) : []),
  ];
  return files.map(({ from, rel }) => ({ from, template: rel.endsWith(".tmpl"), to: rel.replace(/\.tmpl$/, "") }));
}

/** The whole change, worked out before anything is written: what's copied, what's merged, and what's in the way. */
function plan(target, values, options) {
  const config = configFile(values);
  try {
    configFrom(target, config);
  } catch (error) {
    throw new Failure(`The settings don't fit: ${error.message}. Pass them as flags (--help lists them).`);
  }
  const table = placeholders(values);
  const copies = kitFiles(values.withScreens).filter((file) => !MERGED.has(file.to));
  const writes = [...copies.map((file) => file.to), "agentkit.config.json"];
  const conflicts = options.force ? [] : writes.filter((rel) => existsSync(join(target, rel)));
  const read = (rel) => (existsSync(join(target, rel)) ? readFileSync(join(target, rel), "utf8") : null);
  const kitSettings = JSON.parse(readFileSync(join(KIT, ".claude", "settings.json"), "utf8"));
  const merges = {
    ".gitignore": mergeGitignore(read(".gitignore")),
    "CLAUDE.md": mergeClaudeMd(read("CLAUDE.md")),
    "package.json": mergePackageJson(read("package.json"), values),
    ".claude/settings.json": mergeClaudeSettings(read(".claude/settings.json"), kitSettings),
  };
  const contents = copies.map((file) => ({ ...file, text: file.template ? filled(file, table) : null }));
  return { config, contents, merges, conflicts };
}

/** A kit template, filled. One it can't fill is a fault in the kit, not in the settings, and says which file. */
function filled(file, table) {
  try {
    return fill(readFileSync(file.from, "utf8"), table);
  } catch (error) {
    throw new Failure(`The kit's ${relative(KIT, file.from)} has a placeholder init can't fill: ${error.message}.`);
  }
}

function writeFile(target, rel, text) {
  mkdirSync(dirname(join(target, rel)), { recursive: true });
  writeFileSync(join(target, rel), text);
}

function apply(target, { config, contents, merges }) {
  for (const file of contents) {
    mkdirSync(dirname(join(target, file.to)), { recursive: true });
    if (file.text === null) copyFileSync(file.from, join(target, file.to));
    else writeFileSync(join(target, file.to), file.text);
  }
  writeFile(target, "agentkit.config.json", `${JSON.stringify(config, null, 2)}\n`);
  for (const [rel, merge] of Object.entries(merges)) if (merge.added.length > 0) writeFile(target, rel, merge.text);
}

function report({ contents, merges }, dryRun) {
  const verb = dryRun ? "Would write" : "Wrote";
  process.stdout.write(`${verb} ${contents.length + 1} files (the kit and agentkit.config.json).\n`);
  for (const [rel, merge] of Object.entries(merges)) {
    if (merge.added.length > 0) process.stdout.write(`${dryRun ? "Would add" : "Added"} to ${rel}: ${merge.added.join(", ")}\n`);
  }
  for (const merge of Object.values(merges)) if (merge.note) process.stdout.write(`Note: ${merge.note}\n`);
}

function nextSteps(values) {
  const steps = [
    `Read agentkit.config.json. ${values.reviewerLogin ? "Check" : "Set"} reviewer.login before the first merge, and check builders, protectedPaths, deniedCommands and deploy.`,
    "Install the reviewer bot on the repository (a GitHub App), and set reviewer.trigger to the comment that asks it for a review.",
    `Branch protection is optional: merge-approved.mjs already waits for the reviewer's approval and CI's verify job once ${values.defaultBranch} has .github/workflows/verify.yml. Protecting ${values.defaultBranch} (no direct pushes, the verify check required) adds a backstop for people.`,
    "Secrets never go in the repository: the owner keeps .env.local and the deploy platform's secret store. The guard denies agents both.",
    "Hooks: Claude Code runs them from .claude/settings.json and OpenCode from .opencode/plugins/guardrails.js, with nothing to install. For ZCode, add tools/ as a plugin marketplace and install guardrails.",
    "Run npm run verify, then commit the kit on a branch and open its pull request: the first round of the review loop.",
    "Write the product spec and the build plan (specs/README.md), then spec 01 from specs/_template/, and check it with node tools/spec-check/check.mjs.",
    "Plan a wave without running it: node tools/build/run-wave.mjs --spec specs/01-name --wave 1 --builder sonnet --dry-run.",
  ];
  if (values.deploy === "fly") steps.push("Check the deploy without touching production: node tools/guardrails/deploy-approved.mjs --dry-run (flyctl must be signed in).");
  if (values.withScreens) steps.push("Check agentkit.config.json's screens section against the app, and build the app's gallery (tools/screens/README.md, What the app provides).");
  process.stdout.write(`\nNext steps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n`);
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) return void process.stdout.write(`${USAGE}\n`);
  const target = resolve(options.target);
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new Failure(`${target} isn't a folder.`);
  if (git(target, ["rev-parse", "--show-toplevel"]) === null) throw new Failure(`${target} isn't a git repository. Run git init there first: the guardrails need git.`);
  const values = await ask(defaultsFor(target, options), options);
  const change = plan(target, values, options);
  if (change.conflicts.length > 0) {
    throw new Failure(`These kit files exist already, so nothing was written:\n${change.conflicts.map((rel) => `  ${rel}`).join("\n")}\nMove them aside, or run again with --force to overwrite them.`);
  }
  if (options.dryRun) {
    report(change, true);
    return void process.stdout.write(`\nagentkit.config.json:\n${JSON.stringify(change.config, null, 2)}\n`);
  }
  apply(target, change);
  report(change, false);
  nextSteps(values);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`init: ${error.message}\n${error instanceof Failure ? "" : `${USAGE}\n`}`);
  process.exitCode = 1;
}
