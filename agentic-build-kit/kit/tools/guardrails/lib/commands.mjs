// Turns parsed shell commands into what actually runs. Leading VAR=value assignments, reserved words
// and wrapper commands (env, command, exec, nohup, time, nice, timeout, xargs, npx, npm exec,
// sh -c, eval and similar) are peeled off; the strings run by sh -c and eval are analysed too; and
// cd is followed so later relative paths resolve from the right directory.
import { resolve } from "node:path";
import { DYNAMIC, parseShell } from "./shell.mjs";

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const RESERVED = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "case", "esac", "{", "}", "!"]);
const ALIASES = new Map([
  ["flyctl", "fly"],
  ["eas-cli", "eas"],
]);
const MAX_DEPTH = 4;

/**
 * Analysed commands: { program, args, redirects, group, dir, bareEnv }. `program` is "" when only
 * assignments or a wrapper remain; `dir` is the directory the command runs in.
 */
export function analyzeShell(source, context, depth = 0, group = null) {
  const vars = { HOME: context.home, PWD: context.cwd };
  const result = [];
  let dir = context.cwd;
  for (const parsed of parseShell(source, vars, group)) {
    const { inner, ...command } = unwrap(parsed.words);
    result.push({ ...command, redirects: parsed.redirects, group: parsed.group, dir });
    if (depth < MAX_DEPTH) {
      inner.forEach((text) => result.push(...analyzeShell(text, { ...context, cwd: dir }, depth + 1, parsed.group)));
    }
    dir = directoryAfter(command, dir, context.home);
  }
  return result;
}

/** The program a command word runs: no folder, no @version, lower case, known aliases folded. */
export function programName(word) {
  if (!word || word.includes(DYNAMIC)) return "";
  const base = word.slice(word.lastIndexOf("/") + 1).toLowerCase();
  const name = base.length > 1 ? base.replace(/(.)@[^@]*$/, "$1") : base;
  return ALIASES.get(name) ?? name;
}

function unwrap(words) {
  let rest = stripPrefix(words);
  const inner = [];
  for (let round = 0; round < 10 && rest.length > 0; round += 1) {
    const name = programName(rest[0]);
    const peel = WRAPPERS.get(name);
    const step = peel ? peel(rest.slice(1)) : null;
    if (!step) break;
    inner.push(...(step.inner ?? []));
    if (name === "env" && step.rest.length === 0 && inner.length === 0) {
      return { program: "env", args: [], bareEnv: true, inner };
    }
    rest = stripPrefix(step.rest);
  }
  return { program: programName(rest[0] ?? ""), args: rest.slice(1), bareEnv: false, inner };
}

function stripPrefix(words) {
  const start = words.findIndex((word) => !ASSIGNMENT.test(word) && !RESERVED.has(word));
  return start === -1 ? [] : words.slice(start);
}

/** Skips leading options; options in `valueOptions` also skip the word after them. */
function skipOptions(args, valueOptions = new Set()) {
  let index = 0;
  while (index < args.length && args[index].startsWith("-") && args[index] !== "-") {
    if (args[index] === "--") return args.slice(index + 1);
    index += valueOptions.has(args[index]) ? 2 : 1;
  }
  return args.slice(index);
}

const XARGS_VALUES = new Set(["-I", "-n", "-P", "-L", "-s", "-d", "-E", "-a", "--arg-file", "--delimiter", "--max-args", "--max-procs", "--max-chars"]);

const WRAPPERS = new Map([
  ["env", envStep],
  ["command", (args) => ({ rest: args[0] === "-v" || args[0] === "-V" ? [] : skipOptions(args) })],
  ["builtin", (args) => ({ rest: args })],
  ["exec", (args) => ({ rest: skipOptions(args, new Set(["-a"])) })],
  ["nohup", (args) => ({ rest: args })],
  ["time", (args) => ({ rest: skipOptions(args) })],
  ["nice", (args) => ({ rest: skipOptions(args, new Set(["-n"])) })],
  ["timeout", (args) => ({ rest: skipOptions(args, new Set(["-s", "-k"])).slice(1) })],
  ["stdbuf", (args) => ({ rest: skipOptions(args, new Set(["-i", "-o", "-e"])) })],
  ["caffeinate", (args) => ({ rest: skipOptions(args, new Set(["-t", "-w"])) })],
  ["xargs", (args) => ({ rest: skipOptions(args, XARGS_VALUES) })],
  ["npx", packageRunnerStep],
  ["pnpx", packageRunnerStep],
  ["bunx", packageRunnerStep],
  ["npm", (args) => (args[0] === "exec" || args[0] === "x" ? packageRunnerStep(args.slice(1)) : null)],
  ["pnpm", (args) => (args[0] === "dlx" || args[0] === "exec" ? packageRunnerStep(args.slice(1)) : null)],
  ["yarn", (args) => (args[0] === "dlx" || args[0] === "exec" ? packageRunnerStep(args.slice(1)) : null)],
  ["eval", (args) => ({ rest: [], inner: [args.join(" ")] })],
  ...["sh", "bash", "zsh", "dash", "ksh"].map((shell) => [shell, shellStep]),
]);

function envStep(args) {
  const split = args.findIndex((arg) => arg === "-S" || arg === "--split-string");
  if (split !== -1) return { rest: [], inner: [args[split + 1] ?? ""] };
  const rest = skipOptions(args, new Set(["-u", "--unset", "-C", "--chdir"]));
  return { rest: stripPrefix(rest) };
}

function packageRunnerStep(args) {
  let index = 0;
  while (index < args.length && args[index].startsWith("-")) {
    const arg = args[index];
    if (arg === "--") return { rest: args.slice(index + 1) };
    if (arg === "-c" || arg === "--call") return { rest: [], inner: [args[index + 1] ?? ""] };
    if (arg.startsWith("--call=")) return { rest: [], inner: [arg.slice("--call=".length)] };
    index += arg === "-p" || arg === "--package" ? 2 : 1;
  }
  return { rest: args.slice(index) };
}

/** sh -c 'string', bash -lc "string": the string is analysed as its own command line. */
function shellStep(args) {
  let command = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["-o", "+o", "-O", "+O"].includes(arg)) index += 1;
    else if (/^-[A-Za-z]*c[A-Za-z]*$/.test(arg)) command = true;
    else if (!arg.startsWith("-") && !arg.startsWith("+")) return command ? { rest: [], inner: [arg] } : null;
  }
  return null;
}

function directoryAfter(command, dir, home) {
  if (command.program !== "cd" && command.program !== "pushd") return dir;
  if (command.args.includes("-")) return dir;
  const target = command.args.find((arg) => !arg.startsWith("-"));
  if (target === undefined) return home ?? dir;
  return target.includes(DYNAMIC) ? dir : resolve(dir, target);
}
