// Readiness rules: before a spec starts, the files its pending tasks change must exist (or an earlier
// wave creates them), and the files they create must not exist yet. This catches drift when a spec
// was written well before it's built.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { isComplete, matchesEntry } from "../../guardrails/lib/task.mjs";

const GLOB = /[*?]/;

function exists(root, entry) {
  const path = join(root, entry);
  if (!existsSync(path)) return false;
  const isDirectory = statSync(path).isDirectory();
  return entry.endsWith("/") ? isDirectory : !isDirectory;
}

function createdEarlier(entry, task, pending) {
  const bare = entry.replace(/\/$/, "");
  return pending
    .filter((other) => other.wave < task.wave)
    .some((other) => other.create.some((created) => matchesEntry(bare, created)));
}

/** Problems for the pending tasks of one spec, in wave order. */
export function readinessProblems(root, spec) {
  const pending = spec.tasks
    .filter((task) => !isComplete(task.status))
    .sort((a, b) => (a.wave - b.wave || a.id.localeCompare(b.id)));
  const problems = [];
  for (const task of pending) {
    for (const entry of task.modify) {
      if (GLOB.test(entry) || exists(root, entry) || createdEarlier(entry, task, pending)) continue;
      problems.push({
        file: task.file,
        message: `${task.id}: Files to Modify lists \`${entry}\`, which doesn't exist and no earlier wave creates`,
      });
    }
    for (const entry of task.create) {
      if (GLOB.test(entry) || entry.endsWith("/") || !existsSync(join(root, entry))) continue;
      problems.push({ file: task.file, message: `${task.id}: Files to Create lists \`${entry}\`, which already exists` });
    }
  }
  return problems;
}
