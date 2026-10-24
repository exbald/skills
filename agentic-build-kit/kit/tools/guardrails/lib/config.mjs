// The project's settings for the tools, from agentkit.config.json at the repository root: the project and its owner,
// the default branch, the reviewer bot, CI's required jobs, paths and commands only the owner touches, the deploy
// target and the builders. Everything that differs between projects lives here, so the tools' code is the same in
// every repository. The scripts a person or the lead runs read it strictly and stop on a broken file. The hooks read
// it leniently: a broken file must not switch the guard off, so they fall back to the defaults and say what's wrong.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export const CONFIG_FILE = "agentkit.config.json";

/** A config file that can't be read or doesn't fit; its message names the file and the key. */
export class ConfigError extends Error {}

// Paths that never change what a deployed service runs. Anything else counts as shipped, so an unlisted folder costs
// at most an unneeded deploy (tools/guardrails/lib/deploy.mjs).
const NOT_SHIPPED = ["docs/", "specs/", "tools/", ".claude/", ".github/", ".opencode/", "AGENTS.md", "CLAUDE.md", "README.md", CONFIG_FILE];
const HARNESSES = ["opencode", "claude"];
const ADAPTERS = ["none", "fly"];
// Sections merged one level deep over their defaults; every other key replaces its default whole.
const SECTIONS = new Set(["verify", "reviewer", "ci", "deploy", "build"]);

function defaults(root) {
  return {
    project: basename(root),
    owner: "the project owner",
    repo: null,
    defaultBranch: "main",
    lockfile: "package-lock.json",
    verify: { command: null },
    protectedPaths: [],
    deniedCommands: [],
    reviewer: { login: null, name: "the reviewer bot", trigger: "/review" },
    ci: { workflowFile: ".github/workflows/verify.yml", requiredJobs: [{ workflow: "verify", job: "verify" }] },
    deploy: { adapter: "none", healthUrl: null, notShipped: NOT_SHIPPED, fly: { app: null } },
    builders: {},
    build: { install: null, installEnv: {}, longCommands: [] },
    screens: null,
  };
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";
const isWords = (value) => Array.isArray(value) && value.length > 0 && value.every(isText);
const isRepoPath = (value) => isText(value) && !value.startsWith("/") && !value.split("/").includes("..");

function merge(base, file) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(file)) {
    if (key.startsWith("$")) continue;
    if (!Object.hasOwn(base, key)) throw new ConfigError(`${CONFIG_FILE}: unknown key "${key}"`);
    merged[key] = SECTIONS.has(key) && isObject(value) ? { ...base[key], ...value } : value;
  }
  if (isObject(file.deploy) && isObject(file.deploy.fly)) merged.deploy = { ...merged.deploy, fly: { ...base.deploy.fly, ...file.deploy.fly } };
  return merged;
}

function listProblems(list, key, check) {
  if (!Array.isArray(list)) return [`${key} must be a list`];
  return list.flatMap((entry, index) => (check(entry) ? [] : [`${key}[${index}] doesn't fit (see references/adapting.md)`]));
}

function builderProblems(builders) {
  if (!isObject(builders)) return ["builders must be an object of name: builder"];
  return Object.entries(builders).flatMap(([name, builder]) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return [`builders: "${name}" isn't a name (lower case, digits and dashes)`];
    if (!isObject(builder) || !HARNESSES.includes(builder.harness)) return [`builders.${name}.harness must be one of ${HARNESSES.join(", ")}`];
    if (!isText(builder.model)) return [`builders.${name}.model must be the model id the harness takes`];
    if (builder.label !== undefined && !isText(builder.label)) return [`builders.${name}.label must be text`];
    if (builder.effort !== undefined && !isText(builder.effort)) return [`builders.${name}.effort must be text`];
    const budget = builder.budgetUsd;
    if (budget !== undefined && !(Number.isFinite(budget) && budget > 0)) return [`builders.${name}.budgetUsd must be a positive number of dollars`];
    return [];
  });
}

function deployProblems({ adapter, healthUrl, notShipped, fly }) {
  const problems = [];
  if (!ADAPTERS.includes(adapter)) problems.push(`deploy.adapter must be one of ${ADAPTERS.join(", ")}`);
  if (healthUrl !== null && !/^https?:\/\/\S+$/.test(String(healthUrl))) problems.push("deploy.healthUrl must be an http(s) URL or null");
  if (!Array.isArray(notShipped) || !notShipped.every(isText)) problems.push("deploy.notShipped must be a list of paths");
  if (adapter === "fly" && !isText(fly?.app)) problems.push('deploy.fly.app must name the Fly app when deploy.adapter is "fly"');
  if (adapter !== "none" && healthUrl === null) problems.push("deploy.healthUrl must be set when there is a deploy target: the rollback depends on it");
  return problems;
}

/** Every way `config` doesn't fit, as "key: what's wrong" lines. */
export function configProblems(config) {
  const problems = [];
  const need = (ok, message) => ok || problems.push(message);
  need(isText(config.project), "project must be text");
  need(isText(config.owner), "owner must be text");
  need(config.repo === null || /^[\w.-]+\/[\w.-]+$/.test(String(config.repo)), "repo must be owner/name, as GitHub has it, or null");
  need(isText(config.defaultBranch) && !/\s/.test(config.defaultBranch), "defaultBranch must be a branch name");
  need(config.lockfile === null || isText(config.lockfile), "lockfile must be a file name or null");
  need(isObject(config.verify) && (config.verify.command === null || isWords(config.verify.command)), "verify.command must be a command as a list of words, or null");
  problems.push(...listProblems(config.protectedPaths, "protectedPaths", (entry) => isObject(entry) && isRepoPath(entry.path) && (entry.reason === undefined || isText(entry.reason))));
  problems.push(...listProblems(config.deniedCommands, "deniedCommands", (entry) => isObject(entry) && isText(entry.command) && (entry.reason === undefined || isText(entry.reason))));
  const { reviewer, ci, build } = config;
  need(isObject(reviewer) && (reviewer.login === null || isText(reviewer.login)) && isText(reviewer.name) && isText(reviewer.trigger), "reviewer needs login (or null), name and trigger as text");
  need(isObject(ci) && isRepoPath(ci.workflowFile), "ci.workflowFile must be a path in the repository");
  problems.push(...listProblems(ci?.requiredJobs, "ci.requiredJobs", (entry) => isObject(entry) && isText(entry.workflow) && isText(entry.job)));
  if (isObject(config.deploy)) problems.push(...deployProblems(config.deploy));
  else problems.push("deploy must be an object");
  problems.push(...builderProblems(config.builders));
  need(isObject(build) && (build.install === null || isWords(build.install)), "build.install must be a command as a list of words, or null");
  need(isObject(build?.installEnv) && Object.values(build.installEnv).every((value) => typeof value === "string"), "build.installEnv must map names to text");
  need(Array.isArray(build?.longCommands) && build.longCommands.every(isText), "build.longCommands must be a list of command prefixes");
  need(config.screens === null || isObject(config.screens), "screens must be an object or null (tools/screens checks its keys)");
  return problems;
}

function deepFreeze(value) {
  if (value && typeof value === "object") Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/**
 * `file`, a parsed config, laid over the defaults for the repository at `root` and checked. Throws ConfigError when it
 * doesn't fit. scripts/init.mjs checks the file it's about to write with this, so it never writes one the tools refuse.
 */
export function configFrom(root, file) {
  if (!isObject(file)) throw new ConfigError(`${CONFIG_FILE} must hold one JSON object`);
  const config = merge(defaults(root), file);
  const problems = configProblems(config);
  if (problems.length > 0) throw new ConfigError(`${CONFIG_FILE}: ${problems.join("; ")}`);
  return deepFreeze({ ...config, problem: null });
}

/** The configuration for the repository at `root`, the file over the defaults. Throws ConfigError when the file doesn't fit. */
export function readConfig(root) {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return deepFreeze({ ...defaults(root), problem: null });
  let file;
  try {
    file = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ConfigError(`${CONFIG_FILE} isn't readable JSON: ${error.message}`);
  }
  return configFrom(root, file);
}

/** For the hooks: never throws. A broken file gives the defaults, with `problem` saying what's wrong. */
export function configAt(root) {
  try {
    return readConfig(root);
  } catch (error) {
    return deepFreeze({ ...defaults(root), problem: error.message });
  }
}

/** The branches only the owner pushes to: main and master always, and the configured default branch. */
export function releaseBranches(config) {
  return new Set(["main", "master", config.defaultBranch]);
}
