// AGENTS.md "Never" rules over analysed shell commands: deploys and secrets, history rewrites,
// merges, killing processes by name or port, sudo, sweeping deletes, live payments and releases, and the
// commands agentkit.config.json reserves for the owner (deniedCommands). Each rule returns a plain reason
// that says what to do instead, or null. Reasons that name who decides take the owner from the config.
import { resolve } from "node:path";
import { hasShortFlag, splitOptions } from "./args.mjs";
import { programName } from "./commands.mjs";
import { HISTORY_REWRITE, SKIP_HOOKS, gitReason } from "./git-rules.mjs";
import { isInside } from "./paths.mjs";
import { DYNAMIC } from "./shell.mjs";

const DEPLOY =
  "Deploy with node tools/guardrails/deploy-approved.mjs. It deploys the default branch only, and rolls back if the new release isn't healthy (AGENTS.md, Pull requests).";
const PR_MERGE =
  "Merge with node tools/guardrails/merge-approved.mjs <number>. It merges only when the reviewer bot approved the PR's current head (AGENTS.md, Pull requests).";
const REPO_DELETE = "Deleting a GitHub repository is never allowed.";
const GH_ALIAS = "A gh alias hides the command it runs from the guard. Run the full gh command instead.";
const SUDO = "sudo is not available to agents. If the task needs root, stop and write BLOCKED.md.";

/** The reasons that name who decides, for the project's owner. */
function ownerReasons(owner) {
  return {
    flyChange: `On Fly, agents only read state and restart or start machines. Code and fly.toml changes ship through a pull request and node tools/guardrails/deploy-approved.mjs. Anything else (scaling, stopping machines, shells on the machine, IPs, certificates, volumes, storage, tokens) is for ${owner}: stop and write BLOCKED.md if the task needs it.`,
    flySecrets: `Fly secrets are managed by ${owner}. If the task needs a secret added or changed, stop and write BLOCKED.md (or check the spec's action-required.md).`,
    flyDestroy: "Destroying Fly apps, machines or volumes is never an agent's call. Stop and write BLOCKED.md if you think it is needed.",
    kill: `Killing processes by name, pattern or port can close ${owner}'s editor and browser (AGENTS.md, Never). Stop a server you started by its own PID: kill <pid>.`,
    liveStripe: `Live-mode Stripe is human-only: ${owner} switches on live mode. Use a Stripe sandbox (test mode) instead.`,
    release: `Publishing a package or submitting to an app store is a release, and releases are human-gated. Leave it to ${owner}.`,
    denied: (command) => `${command} is reserved for ${owner} (agentkit.config.json, deniedCommands). If the task needs it, stop and write BLOCKED.md.`,
  };
}

const PID_FINDERS = new Set(["lsof", "pgrep", "pidof", "ps", "fuser"]);
const SWEEPING_WORDS = new Set(["/", "/*", "~", "~/", "*", ".*", ".", "./", "./*", "..", "../", "../*"]);
const DESTROY_VERBS = ["destroy", "delete", "remove", "rm"];

const RULES = new Map([
  ["git", gitReason],
  ["git-filter-repo", () => HISTORY_REWRITE],
  ["bfg", () => HISTORY_REWRITE],
  ["fly", flyReason],
  ["gh", ghReason],
  ["pkill", (_command, _context, said) => said.kill],
  ["killall", (_command, _context, said) => said.kill],
  ["kill", killReason],
  ["fuser", ({ args }, _context, said) => (hasShortFlag(splitOptions(args).options, "k") ? said.kill : null)],
  ["sudo", () => SUDO],
  ["rm", rmReason],
  ["stripe", ({ args }, _context, said) => (args.some((arg) => arg === "--live" || arg.startsWith("--live=")) ? said.liveStripe : null)],
  ["npm", npmReason],
  ["eas", ({ args }, _context, said) => (positionals(args)[0] === "submit" ? said.release : null)],
]);

/** The first AGENTS.md rule the commands break, or null. */
export function forbiddenReason(commands, context) {
  const config = context.config();
  const said = ownerReasons(config.owner);
  for (const command of commands) {
    if (command.args.some((arg) => arg === "--no-verify" || arg.startsWith("--no-verify="))) return SKIP_HOOKS;
    const rule = RULES.get(command.program);
    const reason = (rule ? rule(command, context, said) : null) ?? deniedReason(command, config.deniedCommands, said);
    if (reason) return reason;
  }
  return killByLookupReason(commands, said);
}

/**
 * A command agentkit.config.json reserves for the owner. "eve deploy" names a program and the operands it starts
 * with, so `npx eve deploy --prod` matches and `eve dev` doesn't.
 */
function deniedReason(command, entries, said) {
  for (const entry of entries) {
    const [program, ...words] = entry.command.trim().split(/\s+/);
    if (programName(program) !== command.program) continue;
    const operands = positionals(command.args);
    if (words.every((word, index) => operands[index] === word)) return entry.reason ?? said.denied(entry.command);
  }
  return null;
}

function positionals(args) {
  return splitOptions(args).operands;
}

// The Fly commands agents may run on their own: reading state, and restarting or starting machines. Each
// command lists its allowed subcommands, "" meaning none, so a new subcommand stays denied until it's
// added here. Anything else changes what runs, what it costs, how it's reached or what it stores, so it
// goes through deploy-approved.mjs or the owner. On a project not deployed to Fly the rules cost nothing.
const allow = (names, subcommands) => names.map((name) => [name, subcommands]);
const FLY_ALLOWED = new Map([
  ...allow(["status", "logs", "doctor", "version"], [""]),
  ...allow(["releases"], ["", "list"]),
  ...allow(["platform"], ["regions", "vm-sizes", "status"]),
  ...allow(["image"], ["show"]),
  ...allow(["scale"], ["show"]),
  ...allow(["config"], ["show", "validate"]),
  ...allow(["auth"], ["whoami"]),
  ...allow(["checks", "check"], ["list"]),
  ...allow(["secrets", "secret"], ["list"]),
  ...allow(["apps", "app"], ["list", "restart"]),
  ...allow(["volumes", "volume", "vol"], ["list", "show"]),
  ...allow(["ips", "ip"], ["list"]),
  ...allow(["certs", "cert"], ["list", "show", "check"]),
  ...allow(["machines", "machine", "m"], ["list", "status", "restart", "start"]),
]);
const FLY_VALUE_OPTIONS = new Set([
  ...["-a", "--app", "-c", "--config", "-r", "--region", "-o", "--org", "-t", "--access-token"],
  ...["-i", "--instance", "--machine", "-n", "--lines"],
]);

function flyReason({ args }, _context, said) {
  if (args.includes("--help") || args.includes("-h")) return null;
  const words = new Set(args.map((arg) => arg.toLowerCase()));
  const has = (...candidates) => candidates.some((candidate) => words.has(candidate));
  if (has("deploy")) return DEPLOY;
  if (has("secrets", "secret") && has("set", "unset", "import")) return said.flySecrets;
  if (has("apps", "app", "volumes", "volume", "vol", "machines", "machine", "m") && has(...DESTROY_VERBS)) return said.flyDestroy;
  const [command, sub = ""] = splitOptions(args, FLY_VALUE_OPTIONS).operands.map((word) => word.toLowerCase());
  if (command === undefined) return null;
  return FLY_ALLOWED.get(command)?.includes(sub) ? null : said.flyChange;
}

function ghReason({ args }) {
  const [group, action] = splitOptions(args, new Set(["-R", "--repo"])).operands;
  if (group === "pr" && action === "merge") return PR_MERGE;
  if (group === "repo" && action === "delete") return REPO_DELETE;
  if (group === "alias" && (action === "set" || action === "import")) return GH_ALIAS;
  if (group === "api") return ghApiMergeReason(args);
  return null;
}

// Endpoints match in any spelling (graphql, /graphql, a full URL, any case), and a PR number may come
// from the shell. REST: a pull request merge (pulls/<n>/merge) or one branch into another (merges).
const MERGE_ENDPOINTS = [/(^|\/)pulls\/[^/]+\/merge\/?$/i, /(^|\/)merges\/?$/i];
const GRAPHQL_ENDPOINT = /(^|\/)graphql\/?$/i;
const MERGE_MUTATIONS = /\b(mergePullRequest|enablePullRequestAutoMerge|mergeBranch)\b/;
const GRAPHQL_UNREADABLE =
  "A GraphQL query read from stdin or a file, or built by the shell, can't be checked for merge mutations. Pass the query inline with -f query='…' and values as variables (-F name=value). To merge a pull request, use node tools/guardrails/merge-approved.mjs <number>.";

/** `gh api` can merge too: a write to a REST merge endpoint, or a GraphQL merge mutation. */
function ghApiMergeReason(args) {
  if (args.some((arg) => MERGE_MUTATIONS.test(arg))) return PR_MERGE;
  const paths = args.map((arg) => arg.split(/[?#]/)[0]);
  if (paths.some((path) => GRAPHQL_ENDPOINT.test(path)) && hidesQuery(args)) return GRAPHQL_UNREADABLE;
  const hitsEndpoint = paths.some((path) => MERGE_ENDPOINTS.some((endpoint) => endpoint.test(path)));
  return hitsEndpoint && apiMethod(args) !== "GET" ? PR_MERGE : null;
}

/** The query is out of the checks' sight when it comes from --input (stdin or a file) or a hidden query field. */
function hidesQuery(args) {
  return args.some((arg) => arg === "--input" || arg.startsWith("--input=")) || apiFields(args).some(isHiddenQuery);
}

// gh api's fields: -f/--raw-field send their text as it is, -F/--field read a file when the value starts with @.
const FIELD_FLAG = /^(?:(--raw-field|--field)(?:=(.*))?|-([fF])=?(.*))$/s;

/** Every field as { typed, key, value }, from `-f key=value`, `-fkey=value`, `--field=key=value` and the rest. */
function apiFields(args) {
  return args.flatMap((arg, index) => {
    const match = FIELD_FLAG.exec(arg);
    if (!match) return [];
    const [, long, longValue, short, shortValue] = match;
    const pair = (long ? longValue : shortValue) || String(args[index + 1] ?? "");
    const split = pair.indexOf("=");
    const key = split < 0 ? pair : pair.slice(0, split);
    return [{ typed: long === "--field" || short === "F", key, value: split < 0 ? "" : pair.slice(split + 1) }];
  });
}

/** Only the `query` field carries the GraphQL document; the others are variables. A shell-built key might be `query`. */
function isHiddenQuery({ typed, key, value }) {
  if (key.includes(DYNAMIC)) return true;
  return key === "query" && (value.includes(DYNAMIC) || (typed && value.startsWith("@")));
}

/** gh api's method: -X/--method when given, otherwise POST when it sends fields, GET when it doesn't. */
function apiMethod(args) {
  for (const [index, arg] of args.entries()) {
    if (arg === "-X" || arg === "--method") return String(args[index + 1] ?? "").toUpperCase();
    if (arg.startsWith("--method=")) return arg.slice("--method=".length).toUpperCase();
    if (/^-X\S/.test(arg)) return arg.slice(2).toUpperCase();
  }
  return args.some((arg) => /^(-[fF]|--field|--raw-field|--input)(=|$)/.test(arg) || /^-[fF]\S/.test(arg)) ? "POST" : "GET";
}

/** kill -9 -1 signals every process the user owns. */
function killReason({ args }, _context, said) {
  const signalWords = args[0] === "-s" || args[0] === "-n" ? 2 : args[0]?.startsWith("-") && args[0] !== "--" ? 1 : 0;
  return args.slice(signalWords).filter((arg) => arg !== "--").includes("-1") ? said.kill : null;
}

/** kill fed by lsof, pgrep, pidof, ps or fuser, in one pipeline or through $(...). */
function killByLookupReason(commands, said) {
  const groups = new Map();
  commands.forEach((command) => groups.set(command.group, [...(groups.get(command.group) ?? []), command.program]));
  for (const programs of groups.values()) {
    if (programs.includes("kill") && programs.some((program) => PID_FINDERS.has(program))) return said.kill;
  }
  return null;
}

function rmReason({ args, dir }, context) {
  const { options, operands } = splitOptions(args);
  if (!options.includes("--recursive") && !hasShortFlag(options, "rR")) return null;
  const target = operands.find((word) => isSweepingTarget(word, dir, context));
  if (target === undefined) return null;
  return `Refusing to delete ${target}: that removes the system, your home folder or the whole repository. Delete specific paths instead.`;
}

function isSweepingTarget(word, dir, context) {
  if (SWEEPING_WORDS.has(word)) return true;
  if (word.includes(DYNAMIC)) return false;
  const target = resolve(dir, word.replace(/\/(\*|\.)?$/, "") || "/");
  const protectedDirs = ["/", context.home, context.root(), context.projectRoot()].filter(Boolean);
  return protectedDirs.some((protectedDir) => target === protectedDir || isInside(protectedDir, target));
}

function npmReason({ args }, _context, said) {
  const [sub, script] = positionals(args);
  if (sub === "publish") return said.release;
  return ["run", "run-script", "rum", "urn"].includes(sub) && script === "deploy" ? DEPLOY : null;
}
