// The files a shell command writes or deletes, as words relative to the command's directory:
// redirections (>, >>, >|, &>, <>), tee, sed -i, cp and mv destinations (mv also removes its
// sources), rm, touch, git rm and git mv. Best effort: a script that writes files itself is not seen.
import { statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { gitInvocation, splitOptions, valuesOf } from "./args.mjs";

const WRITE_OPS = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);
const DEVICES = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/;
const NONE = new Set();
const COPY_VALUES = new Set(["-t", "-S", "--target-directory", "--suffix"]);
const TOUCH_VALUES = new Set(["-r", "-t", "-d", "--reference", "--date"]);

const EXTRACTORS = new Map([
  ["tee", ({ args }) => splitOptions(args, NONE).operands],
  ["sed", ({ args }) => sedTargets(args)],
  ["cp", ({ args, dir }) => copyTargets(args, dir, false)],
  ["mv", ({ args, dir }) => copyTargets(args, dir, true)],
  ["rm", ({ args }) => splitOptions(args, NONE).operands],
  ["touch", ({ args }) => splitOptions(args, TOUCH_VALUES).operands],
  ["git", gitTargets],
]);

/** Words naming files the command writes or deletes (devices such as /dev/null left out). */
export function writeTargets(command) {
  const redirected = command.redirects.filter(isFileWrite).map(({ target }) => target);
  const extract = EXTRACTORS.get(command.program);
  const named = extract ? extract(command) : [];
  return [...redirected, ...named].filter((word) => word !== "" && word !== "-" && !DEVICES.test(word));
}

function isFileWrite({ op, target }) {
  return op === ">&" ? !/^(\d+|-)$/.test(target) : WRITE_OPS.has(op);
}

/** sed edits files in place only with -i (GNU -i[SUFFIX], BSD -i SUFFIX, or --in-place). */
function sedTargets(args) {
  let inPlace = false;
  let scriptGiven = false;
  const operands = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (arg === "-i" || arg === "-I") {
      inPlace = true;
      if (/^(|\.[\w.-]*)$/.test(args[index + 1] ?? "x")) index += 1;
    } else if (arg.startsWith("--in-place")) inPlace = true;
    else if (["-e", "-f", "--expression", "--file"].includes(arg)) {
      scriptGiven = true;
      index += 1;
    } else if (arg.startsWith("--expression=") || arg.startsWith("--file=")) scriptGiven = true;
    else if (arg === "-l" || arg === "--line-length") index += 1;
    else if (/^-[A-Za-z]/.test(arg)) {
      const flags = sedCluster(arg);
      inPlace ||= flags.inPlace;
      scriptGiven ||= flags.script;
      if (flags.takesNext) index += 1;
    } else operands.push(arg);
  }
  if (!inPlace) return [];
  return scriptGiven ? operands : operands.slice(1);
}

/** A short option cluster such as -Ei.bak or -ne: which flags it sets, and whether it eats the next word. */
function sedCluster(cluster) {
  const letters = cluster.slice(1);
  for (let index = 0; index < letters.length; index += 1) {
    const letter = letters[index];
    const attached = index < letters.length - 1;
    if (letter === "i" || letter === "I") return { inPlace: true, script: false, takesNext: false };
    if (letter === "e" || letter === "f") return { inPlace: letters.slice(0, index).includes("i"), script: true, takesNext: !attached };
    if (letter === "l") return { inPlace: false, script: false, takesNext: !attached };
  }
  return { inPlace: false, script: false, takesNext: false };
}

/** cp and mv write their destination (inside it when it is a folder); mv also removes its sources. */
function copyTargets(args, dir, isMove) {
  const parsed = splitOptions(args, COPY_VALUES);
  const targetDir = valuesOf(parsed, "-t", "--target-directory").at(-1);
  const sources = targetDir === undefined ? parsed.operands.slice(0, -1) : parsed.operands;
  const destination = targetDir ?? parsed.operands.at(-1);
  if (destination === undefined || sources.length === 0) return [];
  const intoFolder = targetDir !== undefined || destination.endsWith("/") || isDirectory(resolve(dir, destination));
  const written = intoFolder ? sources.map((source) => join(destination, basename(source))) : [destination];
  return isMove ? [...written, ...sources] : written;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function gitTargets({ args, dir }) {
  const { sub, rest } = gitInvocation(args);
  if (sub !== "rm" && sub !== "mv") return [];
  const parsed = splitOptions(rest, new Set(["--pathspec-from-file"]));
  if (parsed.options.some((option) => option === "-n" || option === "--dry-run")) return [];
  return sub === "rm" ? parsed.operands : copyTargets(rest, dir, true);
}
