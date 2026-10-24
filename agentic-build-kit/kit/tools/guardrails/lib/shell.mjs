// Reads a Bash command line the way the shell splits it, without running anything: simple commands
// with their words (quotes removed) and redirections. Commands inside $(...), `...`, <(...) and
// >(...) are returned too, in the group (pipeline) of the command they appear in, so both
// `kill $(lsof -ti:3000)` and `lsof -ti:3000 | xargs kill` put lsof and kill in one group. Heredoc
// bodies and comments are skipped. Expansions that can't be known statically become DYNAMIC, except
// a leading ~, $HOME and $PWD, which take the values passed in.

export const DYNAMIC = "\u0000";

const BREAKS = new Set([" ", "\t", "\r", "\n", ";", "&", "|", "(", ")", "<", ">"]);
const OPERATORS = ["&&", "||", "|&", ";;", ";", "|", "&", "(", ")", "\n"];
const REDIRECT = /^(\d*)(&>>|&>|>>|>\||>&|>|<<<|<<-|<<|<>|<&|<)/;
const ANSI_ESCAPES = new Map([
  ["n", "\n"],
  ["t", "\t"],
  ["r", "\r"],
]);

/** The simple commands in `source`: { words, redirects: [{ fd, op, target }], group }. */
export function parseShell(source, vars = {}, group = null) {
  const state = { src: String(source), i: 0, vars, nextGroup: 0, heredocs: [], out: [] };
  readSequence(state, false, group);
  return state.out;
}

function readSequence(st, nested, inherited) {
  const nextGroup = () => inherited ?? st.nextGroup++;
  let group = nextGroup();
  let words = [];
  let redirects = [];
  let depth = 0;
  const flush = () => {
    if (words.length > 0 || redirects.length > 0) st.out.push({ words, redirects, group });
    words = [];
    redirects = [];
  };
  while (st.i < st.src.length) {
    if (skipBlank(st)) continue;
    const op = readOperator(st);
    if (op !== null) {
      flush();
      if (op === ")" && nested && depth === 0) return;
      if (op === "(") depth += 1;
      else if (op === ")") depth = Math.max(0, depth - 1);
      else if (op !== "|" && op !== "|&") group = nextGroup();
      if (op === "\n") readHeredocs(st);
      continue;
    }
    const redirect = readRedirect(st, group);
    const word = redirect ? null : readWord(st, group);
    if (redirect) redirects = [...redirects, redirect];
    else if (word !== null) words = [...words, word];
    else st.i += 1;
  }
  flush();
}

function skipBlank(st) {
  const char = st.src[st.i];
  if (char === " " || char === "\t" || char === "\r") {
    st.i += 1;
    return true;
  }
  if (char === "\\" && st.src[st.i + 1] === "\n") {
    st.i += 2;
    return true;
  }
  if (char !== "#") return false;
  const end = st.src.indexOf("\n", st.i);
  st.i = end === -1 ? st.src.length : end;
  return true;
}

function readOperator(st) {
  const op = OPERATORS.find((candidate) => st.src.startsWith(candidate, st.i));
  if (op === undefined || (op === "&" && st.src[st.i + 1] === ">")) return null;
  st.i += op.length;
  return op;
}

function readRedirect(st, group) {
  const char = st.src[st.i];
  if ((char === "<" || char === ">") && st.src[st.i + 1] === "(") return null;
  const match = REDIRECT.exec(st.src.slice(st.i, st.i + 24));
  if (!match) return null;
  st.i += match[0].length;
  while (st.src[st.i] === " " || st.src[st.i] === "\t") st.i += 1;
  const target = readWord(st, group) ?? "";
  if (match[2] === "<<" || match[2] === "<<-") st.heredocs.push({ delimiter: target, strip: match[2] === "<<-" });
  return { fd: match[1], op: match[2], target };
}

function readHeredocs(st) {
  for (const { delimiter, strip } of st.heredocs) {
    while (st.i < st.src.length) {
      const end = st.src.indexOf("\n", st.i);
      const line = st.src.slice(st.i, end === -1 ? st.src.length : end).replace(/\r$/, "");
      st.i = end === -1 ? st.src.length : end + 1;
      if ((strip ? line.replace(/^\t+/, "") : line) === delimiter) break;
    }
  }
  st.heredocs = [];
}

function readWord(st, group) {
  let value = "";
  let started = false;
  while (st.i < st.src.length) {
    const char = st.src[st.i];
    if (BREAKS.has(char)) {
      const substitution = !started && (char === "<" || char === ">") && st.src[st.i + 1] === "(";
      if (!substitution) break;
      st.i += 2;
      readSequence(st, true, group);
      value += DYNAMIC;
    } else if (!started && char === "~" && isTildeEnd(st.src[st.i + 1])) {
      st.i += 1;
      value += typeof st.vars.HOME === "string" ? st.vars.HOME : "~";
    } else value += readPart(st, group);
    started = true;
  }
  return started ? value : null;
}

function isTildeEnd(next) {
  return next === undefined || next === "/" || BREAKS.has(next);
}

function readPart(st, group) {
  const char = st.src[st.i];
  if (char === "'") return readSingleQuoted(st);
  if (char === '"') return readDoubleQuoted(st, group);
  if (char === "\\") return readEscape(st);
  if (char === "$") return readDollar(st, group, false);
  if (char === "`") return readBackticks(st, group);
  st.i += 1;
  return char;
}

function readSingleQuoted(st) {
  const end = st.src.indexOf("'", st.i + 1);
  const stop = end === -1 ? st.src.length : end;
  const text = st.src.slice(st.i + 1, stop);
  st.i = stop + 1;
  return text;
}

function readEscape(st) {
  const next = st.src[st.i + 1];
  st.i += 2;
  return next === undefined || next === "\n" ? "" : next;
}

function readDoubleQuoted(st, group) {
  let text = "";
  st.i += 1;
  while (st.i < st.src.length && st.src[st.i] !== '"') {
    const char = st.src[st.i];
    if (char === "\\") text += readQuotedEscape(st);
    else if (char === "$") text += readDollar(st, group, true);
    else if (char === "`") text += readBackticks(st, group);
    else {
      text += char;
      st.i += 1;
    }
  }
  st.i += 1;
  return text;
}

function readQuotedEscape(st) {
  const next = st.src[st.i + 1] ?? "";
  st.i += 2;
  if (next === "\n") return "";
  return next !== "" && '$`"\\'.includes(next) ? next : `\\${next}`;
}

function readDollar(st, group, quoted) {
  const next = st.src[st.i + 1];
  if (next === "(") {
    st.i += 2;
    readSequence(st, true, group);
    return DYNAMIC;
  }
  if (next === "{") return readBraced(st);
  if (next === "'" && !quoted) {
    st.i += 1;
    return readAnsiQuoted(st);
  }
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(st.src.slice(st.i + 1, st.i + 200))?.[0];
  if (name) {
    st.i += 1 + name.length;
    return variable(st, name);
  }
  if (next !== undefined && /[@*#?$!0-9-]/.test(next)) {
    st.i += 2;
    return DYNAMIC;
  }
  st.i += 1;
  return "$";
}

function variable(st, name) {
  return Object.hasOwn(st.vars, name) && typeof st.vars[name] === "string" ? st.vars[name] : DYNAMIC;
}

function readBraced(st) {
  let depth = 0;
  let end = st.i + 1;
  for (; end < st.src.length; end += 1) {
    if (st.src[end] === "{") depth += 1;
    else if (st.src[end] === "}" && --depth === 0) break;
  }
  const inner = st.src.slice(st.i + 2, end);
  st.i = end + 1;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(inner) ? variable(st, inner) : DYNAMIC;
}

function readAnsiQuoted(st) {
  let text = "";
  st.i += 1;
  while (st.i < st.src.length && st.src[st.i] !== "'") {
    if (st.src[st.i] === "\\") {
      const next = st.src[st.i + 1] ?? "";
      text += ANSI_ESCAPES.get(next) ?? next;
      st.i += 2;
    } else {
      text += st.src[st.i];
      st.i += 1;
    }
  }
  st.i += 1;
  return text;
}

function readBackticks(st, group) {
  let inner = "";
  st.i += 1;
  while (st.i < st.src.length && st.src[st.i] !== "`") {
    const next = st.src[st.i + 1] ?? "";
    if (st.src[st.i] === "\\" && next !== "" && "`$\\".includes(next)) {
      inner += next;
      st.i += 2;
    } else {
      inner += st.src[st.i];
      st.i += 1;
    }
  }
  st.i += 1;
  st.out.push(...parseShell(inner, st.vars, group));
  return DYNAMIC;
}
