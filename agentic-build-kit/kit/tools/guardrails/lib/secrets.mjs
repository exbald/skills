// Secrets. AGENTS.md: never read, edit or print .env* files or secrets, and never put a secret in
// a command. Loading a .env file into a process with --env-file stays allowed: it never prints it.
import { splitOptions } from "./args.mjs";
import { globToRegExp } from "./paths.mjs";

export const ENV_REASON =
  "AGENTS.md: never read, edit or print .env* files. Secrets live in the deploy platform's secret store and the human-managed .env.local. " +
  "To give a process its variables, run it with node --env-file=.env.local …; if the task needs a secret value, stop and write BLOCKED.md.";
const PRINT_ENV_REASON =
  "Printing the environment can expose secrets (AGENTS.md: never print secrets). " +
  'Check a single variable without printing it, for example test -n "$NAME" && echo set.';
const LIVE_KEY_REASON =
  "This command contains a live Stripe key (sk_live_ or rk_live_). Never put secrets in commands; " +
  "use Stripe sandbox keys from the secret store or .env.local loaded with --env-file.";

// Commands that print, copy or load a file named in their arguments.
const READERS = new Set([
  ...["cat", "less", "more", "head", "tail", "grep", "egrep", "fgrep", "rg", "sed", "awk", "gawk"],
  ...["cp", "mv", "source", ".", "bat", "nl", "tac", "xxd", "od", "hexdump", "strings", "base64"],
  ...["diff", "cut", "sort", "uniq", "jq", "vi", "vim", "nvim", "nano", "code", "open", "scp", "rsync", "curl"],
]);
const PATTERN_FIRST = new Set(["grep", "egrep", "fgrep", "rg"]);
const GREP_VALUES = new Set(["-e", "-f", "-m", "-A", "-B", "-C", "-d", "-D", "-g", "-t", "-T", "--regexp", "--file", "--glob", "--type"]);
const ENV_SAMPLES = [".env", ".env.local", ".env.production", ".envrc"];

/** A .env* file name (".env", ".env.local", "config/.env.production"), or a glob that matches one. */
export function isEnvFile(word) {
  const name = (String(word).replace(/\/+$/, "").split("/").pop() ?? "").toLowerCase();
  if (name.startsWith(".env")) return true;
  if (!name.startsWith(".") || !/[*?[]/.test(name)) return false;
  const pattern = globToRegExp(name);
  return ENV_SAMPLES.some((sample) => pattern.test(sample));
}

export function liveKeyReason(source) {
  return /(?:sk|rk)_live_/.test(source) ? LIVE_KEY_REASON : null;
}

/** Shell commands that print the environment or read, copy or load a .env* file. */
export function envCommandReason(commands) {
  for (const command of commands) {
    if (printsEnvironment(command)) return PRINT_ENV_REASON;
    if (command.redirects.some(({ op, target }) => op !== "<<" && op !== "<<-" && op !== "<<<" && isEnvFile(target))) return ENV_REASON;
    if (READERS.has(command.program) && fileArguments(command).some(namesEnvFile)) return ENV_REASON;
  }
  return null;
}

function printsEnvironment({ program, args, bareEnv }) {
  if (bareEnv || program === "printenv") return true;
  if (program === "export" || program === "declare" || program === "typeset") return args.every((arg) => arg.startsWith("-"));
  return program === "set" && args.length === 0;
}

/** grep and rg take a pattern first unless -e or -f gives it; a pattern naming .env is fine. */
function fileArguments({ program, args }) {
  if (!PATTERN_FIRST.has(program)) return args;
  const parsed = splitOptions(args, GREP_VALUES);
  const patternGiven = parsed.values.some(([option]) => ["-e", "-f", "--regexp", "--file"].includes(option));
  const operands = patternGiven ? parsed.operands : parsed.operands.slice(1);
  return [...operands, ...parsed.options.filter((option) => option.includes("="))];
}

function namesEnvFile(arg) {
  if (!arg.startsWith("-")) return isEnvFile(arg);
  const equals = arg.indexOf("=");
  if (equals === -1 || /^--env-file(-if-exists)?$/.test(arg.slice(0, equals))) return false;
  return isEnvFile(arg.slice(equals + 1));
}
