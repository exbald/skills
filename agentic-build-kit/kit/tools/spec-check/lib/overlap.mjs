// Overlap rules: tasks that can run at the same time must not touch the same file. Entries are a
// file path, a folder ending in "/", or a glob (`*` or `?`; brackets are literal).
import { globToRegExp } from "../../guardrails/lib/paths.mjs";
import { isComplete } from "../../guardrails/lib/task.mjs";

const GLOB = /[*?]/; // isGlobEntry's test: brackets are literal
const isFolder = (entry) => entry.endsWith("/");
const meet = (p, q) => p.startsWith(q) || q.startsWith(p);
const withSlash = (entry) => (entry.endsWith("/") ? entry : `${entry}/`);

// The part of a glob before its first wildcard, cut back to the last "/": "apps/agent/test/**/*.ts" → "apps/agent/test/".
function staticPrefix(glob) {
  const head = glob.slice(0, glob.search(GLOB));
  return head.slice(0, head.lastIndexOf("/") + 1);
}

/** Whether one file could be named by both entries. Two globs that could overlap count as overlapping. */
export function entriesOverlap(a, b) {
  const globA = GLOB.test(a);
  const globB = GLOB.test(b);
  if (globA && globB) return meet(staticPrefix(a), staticPrefix(b));
  if (globA || globB) {
    const [glob, other] = globA ? [a, b] : [b, a];
    if (isFolder(other)) return meet(staticPrefix(glob), other);
    return globToRegExp(glob, { classes: false }).test(other);
  }
  if (isFolder(a) || isFolder(b)) return meet(withSlash(a), withSlash(b));
  return a === b;
}

const entriesOf = (task) => [...new Set([...task.modify, ...task.create])];

/** The first pair of entries, one from each task, that overlap, or null. */
function firstOverlap(taskA, taskB) {
  for (const entryA of entriesOf(taskA)) {
    for (const entryB of entriesOf(taskB)) {
      if (entriesOverlap(entryA, entryB)) return { entryA, entryB };
    }
  }
  return null;
}

/** Problems for every pair of tasks in one spec that share a wave, whatever their status. */
export function waveOverlaps(spec) {
  const problems = [];
  spec.tasks.forEach((a, index) => {
    for (const b of spec.tasks.slice(index + 1)) {
      if (a.wave !== b.wave) continue;
      const found = firstOverlap(a, b);
      if (!found) continue;
      problems.push({
        file: a.file,
        message: `${a.id} and ${b.id} are both in wave ${a.wave} and both cover \`${found.entryA}\` / \`${found.entryB}\``,
      });
    }
  });
  return problems;
}

/** Problems for every pair of pending tasks, one from each of two specs run in parallel. */
export function acrossOverlaps(specA, specB) {
  const problems = [];
  const pending = (spec) => spec.tasks.filter((task) => !isComplete(task.status));
  for (const a of pending(specA)) {
    for (const b of pending(specB)) {
      const found = firstOverlap(a, b);
      if (!found) continue;
      problems.push({
        file: a.file,
        message: `${specB.dir} ${b.id} also covers \`${found.entryA}\` / \`${found.entryB}\` (specs run in parallel must not share files)`,
      });
    }
  }
  return problems;
}
