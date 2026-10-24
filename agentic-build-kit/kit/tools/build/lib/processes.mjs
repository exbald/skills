// The builder's processes. When a builder goes quiet, the runner looks for a command it ran
// that never returned, such as a dev server or a test in watch mode, and stops just that command by PID.
// The builder's own helpers (its private server, MCP and language servers) are never touched.

/** How long a builder may stay quiet before the runner looks into it. */
export const IDLE_MS = 10 * 60_000;
/** How long a command known to run long may go before it counts as hung: installs, builds and the test suite. */
export const LONG_COMMAND_MS = 30 * 60_000;

// Commands that can legitimately run past 10 minutes on a slow network or a cold cache: npm installs, the verify
// script and the suites it runs. A project's own slow builds (agentkit.config.json's build.longCommands, such as
// "eve build" or "expo export") join them.
const LONG = /\bnpm (?:ci|install|i)\b|\bverify\.mjs\b|\bnpm (?:run )?(?:verify|test|build|bundle)\b|\bvitest\b|\bjest\b|\btsc\b/;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether `command` runs one of `longCommands` anywhere in it, as whole words: the harness wraps a command in a shell
 * (Claude Code's `eval '…'` included), so "expo export" sits mid-line, and must not match "expo exporter".
 */
function runsLongCommand(command, longCommands) {
  return longCommands.some((long) => new RegExp(`(?:^|[^\\w./-])${escape(long.trim())}(?![\\w-])`).test(command));
}

/** How long `command` may run before the runner stops it. `longCommands` adds the project's own slow commands. */
export function commandLimitMs(command, longCommands = []) {
  return LONG.test(command) || runsLongCommand(command, longCommands) ? LONG_COMMAND_MS : IDLE_MS;
}

// Both harnesses run commands through sh -c or the user's shell (zsh for Claude Code here, from the live capture);
// fish and nu are here in case the user's shell is one of them. csh and tcsh aren't: neither harness supports them.
const SHELL = /^(?:\S*\/)?(?:(?:ba|z|da|k)?sh|fish|nu)(?:\s|$)/;
// The harness's own processes, by the program they run: opencode or claude, in any case, directly or as a script
// under node or bun. A helper whose path only mentions one, such as an MCP server under ~/.claude/plugins/, isn't
// the harness. A program path with a space in it isn't matched, on purpose: the runner starts both by bare name,
// OpenCode's private server runs from the install's bin folder (no space in a Homebrew or npm install), and
// matching across spaces would let any argument ending in /claude count as the harness again. A harness started
// through env or with interpreter flags (node --flag …/opencode) isn't matched either. Every miss is on the safe
// side: the commands below it go unseen, so a quiet builder is restarted, and no shell is stopped by mistake.
const HARNESS = /^(?:(?:\S*\/)?(?:node|bun)\s+)?(?:\S*\/)?(?:opencode|claude)(?:\s|$)/i;

/** How long OpenCode has to log that it loaded the guard plugin before the runner stops the builder. */
export const GUARD_LOAD_MS = 2 * 60_000;

/** Whether OpenCode's log says the guard plugin failed to load: the builder must not go on without it. */
export function guardFailedToLoad(log) {
  return /failed to load plugin[^\n]*guardrails\.js/.test(String(log));
}

/**
 * Whether OpenCode's log says it loaded the guard plugin, and nothing says that failed. OpenCode 2.0.20 logs
 * `msg="loading plugin" id=…/.opencode/plugins/guardrails.js` at startup with --print-logs. A plugin skipped
 * silently logs neither line, so the runner waits for this one rather than only for a failure.
 */
export function guardLoaded(log) {
  return /loading plugin[^\n]*guardrails\.js/.test(String(log)) && !guardFailedToLoad(log);
}

/**
 * The checkout OpenCode loaded the guard plugin from, read from its loading line: the folder that holds
 * `.opencode/plugins/guardrails.js`. OpenCode works in that checkout, so it must be the wave's own.
 */
export function guardCheckout(log) {
  // Every plugin logs its own loading line, so this reads the guardrails one, wherever it falls. OpenCode logs in
  // logfmt, so a path with spaces comes quoted. Null until a guardrails line with a readable absolute path shows.
  const suffix = "/.opencode/plugins/guardrails.js";
  for (const match of String(log).matchAll(/loading plugin[^\n]*?id=(?:"([^"\n]+)"|(\S+))/g)) {
    const path = match[1] ?? match[2];
    if (path.startsWith("/") && path.endsWith(suffix)) return path.slice(0, -suffix.length);
  }
  return null;
}

/** Every process under `pids`, the pids included, from ps's rows: what stopping a command must reach. */
export function descendants(rows, pids) {
  const below = (pid) => rows.filter((row) => row.ppid === pid).flatMap((row) => [row.pid, ...below(row.pid)]);
  return [...new Set(pids.flatMap((pid) => [pid, ...below(pid)]))];
}

/** ps's elapsed time, [[dd-]hh:]mm:ss, in milliseconds, or NaN when it can't be read. */
export function elapsedMs(etime) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(etime).trim());
  if (!match) return Number.NaN;
  const [, days = "0", hours = "0", minutes, seconds] = match;
  return (((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
}

/** `ps -A -o pid=,ppid=,etime=,command=` as rows. */
export function parsePs(text) {
  return String(text)
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, ppid, etime, command]) => ({ pid: Number(pid), ppid: Number(ppid), elapsedMs: elapsedMs(etime), command }));
}

/**
 * The commands the builder ran: the outermost shells below `rootPid` reached only through the harness's own
 * processes. A shell below anything else, such as an MCP server started through npx, belongs to that helper.
 * Both harnesses run every command through a shell, so a command always has one. A direct child of the
 * harness that isn't a shell is one of its own helpers (an MCP or language server), never a command.
 */
export function commandShells(rows, rootPid) {
  const children = new Map();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const found = [];
  const visit = (pid) => {
    for (const child of children.get(pid) ?? []) {
      if (SHELL.test(child.command)) found.push(child);
      else if (HARNESS.test(child.command)) visit(child.pid);
    }
  };
  visit(rootPid);
  return found;
}

/**
 * What to do about a quiet builder: wait, stop its hung commands, or restart it.
 * `awaitingReview`: the wave's PR has waited on the reviewer bot for under 30 minutes. The builder is then waiting
 * too, in a long command or between short polls, so it's left alone either way. `longCommands` is
 * agentkit.config.json's build.longCommands.
 */
export function idleAction({ quietMs, shells, awaitingReview, longCommands = [] }) {
  if (quietMs < IDLE_MS || awaitingReview) return { kind: "wait" };
  const hung = shells.filter((shell) => shell.elapsedMs >= commandLimitMs(shell.command, longCommands));
  if (hung.length > 0) return { kind: "stop-commands", pids: hung.map((shell) => shell.pid) };
  if (shells.length > 0) return { kind: "wait" };
  return { kind: "restart" };
}
