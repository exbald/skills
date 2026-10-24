// Format rules: whether a spec folder follows "Spec folder anatomy" in specs/README.md. Each rule
// returns { file, message } problems; the messages are part of the contract and tests match on them.
import { looksLikePath, normalizeEntry } from "../../guardrails/lib/task.mjs";
import { isTaskFileName, splitSections } from "./spec.mjs";

export const TASK_SECTIONS = Object.freeze([
  "Status",
  "Wave",
  "Description",
  "Dependencies",
  "Files to Modify",
  "Files to Create",
  "Technical Details",
  "Implementation Steps",
  "Verification",
  "Acceptance Criteria",
  "Notes",
]);

const TASK_LINE = /^- \[( |x)\] \[(task-\d{2})\]\((tasks\/task-\d{2}-[a-z0-9-]+\.md)\): .+ \((any|strong) model\)$/;
const LIST_LINE = /^- `([^`\n]+)`$/;
const NONE_LINE = /^(- )?None\.?$/;
const CODE_FENCE = /^(```|~~~)/m;

const bodyOf = (task, title) => task.sections.find((section) => section.title === title)?.body ?? "";
const nonBlankLines = (body) => body.split("\n").map((line) => line.trim()).filter(Boolean);

function structureProblems(spec) {
  const problems = [];
  const add = (file, message) => problems.push({ file, message });
  if (spec.readme === null) add(spec.dir, "missing README.md");
  if (!spec.hasRequirements) add(spec.dir, "missing requirements.md");
  if (!spec.hasActionRequired) add(spec.dir, "missing action-required.md");
  if (spec.tasks.length === 0) add(spec.dir, "no task files in tasks/");
  for (const name of spec.taskFiles) {
    if (!isTaskFileName(name)) add(`${spec.dir}/tasks/${name}`, `unexpected file in tasks/: ${name}`);
  }
  const seen = new Set();
  for (const task of spec.tasks) {
    if (seen.has(task.id)) add(task.file, `duplicate task id ${task.id}`);
    seen.add(task.id);
  }
  return problems;
}

function sectionsProblems(task) {
  const found = task.sections.map((section) => section.title);
  if (found.length === TASK_SECTIONS.length && found.every((title, index) => title === TASK_SECTIONS[index])) return [];
  return [{ file: task.file, message: `sections must be exactly: ${TASK_SECTIONS.join(", ")}; found: ${found.join(", ")}` }];
}

function statusAndWaveProblems(task) {
  const problems = [];
  if (task.status !== "pending" && task.status !== "complete") {
    problems.push({ file: task.file, message: `Status must be "pending" or "complete", found "${task.status}"` });
  }
  if (!Number.isInteger(task.wave) || task.wave < 1) {
    problems.push({ file: task.file, message: `Wave must be a whole number from 1, found "${task.waveText}"` });
  }
  return problems;
}

function listLineProblem(root, title, line) {
  const match = LIST_LINE.exec(line);
  if (!match) return `${title}: "${line}" isn't a "- \`path\`" line`;
  const path = match[1].trim();
  if (!looksLikePath(path)) return `${title}: \`${path}\` isn't a path`;
  if (!normalizeEntry(path, root)) return `${title}: \`${path}\` isn't inside the repository`;
  return null;
}

function fileListProblems(root, task) {
  const problems = [];
  for (const title of ["Files to Modify", "Files to Create"]) {
    const lines = nonBlankLines(bodyOf(task, title));
    if (lines.length === 0) {
      problems.push({ file: task.file, message: `${title} is empty: list its paths or write None` });
      continue;
    }
    if (lines.length === 1 && NONE_LINE.test(lines[0])) continue;
    for (const line of lines) {
      const message = listLineProblem(root, title, line);
      if (message) problems.push({ file: task.file, message });
    }
  }
  return problems;
}

/** A task that changes a package.json changes the repository's lockfile too (agentkit.config.json's lockfile; null skips this). */
function lockfileProblems(task, lockfile) {
  if (lockfile === null) return [];
  const entries = [...task.modify, ...task.create];
  const touchesPackage = entries.some((entry) => entry.endsWith("package.json"));
  if (!touchesPackage || entries.includes(lockfile)) return [];
  return [{ file: task.file, message: `lists a package.json but not ${lockfile}` }];
}

function dependencyProblems(task, spec) {
  const problems = [];
  const mentioned = [...new Set(bodyOf(task, "Dependencies").match(/\btask-\d{2}\b/g) ?? [])];
  for (const id of mentioned) {
    const other = spec.tasks.find((candidate) => candidate.id === id);
    if (!other) problems.push({ file: task.file, message: `Dependencies: ${id} isn't a task in this spec` });
    else if (!(other.wave < task.wave)) {
      problems.push({ file: task.file, message: `Dependencies: ${id} is in wave ${other.wave}, not before this task's wave ${task.wave}` });
    }
  }
  return problems;
}

function bodyProblems(task) {
  const problems = [];
  if (!CODE_FENCE.test(bodyOf(task, "Verification"))) problems.push({ file: task.file, message: "Verification has no code block" });
  if (!/^- /m.test(bodyOf(task, "Acceptance Criteria"))) {
    problems.push({ file: task.file, message: "Acceptance Criteria has no list items" });
  }
  return problems;
}

function taskProblems(root, task, spec, lockfile) {
  const shape = sectionsProblems(task);
  if (shape.length > 0) return shape;
  return [
    ...statusAndWaveProblems(task),
    ...fileListProblems(root, task),
    ...lockfileProblems(task, lockfile),
    ...dependencyProblems(task, spec),
    ...bodyProblems(task),
  ];
}

function readmeTaskRows(section, spec, add) {
  const lines = nonBlankLines(section.body);
  const rows = [];
  for (const line of lines) {
    const match = TASK_LINE.exec(line);
    if (!match) {
      add(`README.md: "${line}" isn't a task line like "- [ ] [task-01](tasks/task-01-slug.md): summary (any model)"`);
      continue;
    }
    const [, tick, text, path] = match;
    rows.push({ checked: tick === "x", text, path });
  }
  const names = new Set(spec.taskFiles);
  for (const row of rows) {
    const name = row.path.slice("tasks/".length);
    if (!names.has(name)) add(`README.md lists ${row.path}, which doesn't exist`);
    const fileId = /^task-\d{2}/.exec(name)?.[0];
    if (row.text !== fileId) add(`README.md: link text ${row.text} doesn't match ${row.path}`);
  }
  return rows;
}

function readmeTaskProblems(spec, section, add) {
  const rows = readmeTaskRows(section, spec, add);
  for (const task of spec.tasks) {
    const path = task.file.slice(`${spec.dir}/`.length);
    const mine = rows.filter((row) => row.path === path);
    if (mine.length === 0) add(`README.md doesn't list ${path}`);
    else if (mine.length > 1) add(`README.md lists ${task.id} more than once`);
    const checked = mine[0]?.checked;
    if (checked === undefined) continue;
    if (task.status === "complete" && !checked) add(`README.md: ${task.id} is complete but its box isn't ticked`);
    if (task.status === "pending" && checked) add(`README.md: ${task.id} is pending but its box is ticked`);
  }
}

function readmeProblems(spec) {
  if (spec.readme === null) return [];
  const problems = [];
  const add = (message) => problems.push({ file: `${spec.dir}/README.md`, message });
  if (!/^```mermaid/m.test(spec.readme)) add("README.md has no mermaid graph");
  if (!spec.readme.includes("**Written against:**")) add("README.md has no Written against line");
  const sections = splitSections(spec.readme);
  for (const name of ["Waves", "Tasks"]) {
    if (!sections.some((section) => section.title === name)) add(`README.md has no ${name} section`);
  }
  const tasks = sections.find((section) => section.title === "Tasks");
  if (tasks) readmeTaskProblems(spec, tasks, add);
  return problems;
}

/** Every format problem in one spec: [{ file, message }]. `lockfile` is the config's, package-lock.json by default. */
export function formatProblems(root, spec, { lockfile = "package-lock.json" } = {}) {
  return [
    ...structureProblems(spec),
    ...spec.tasks.flatMap((task) => taskProblems(root, task, spec, lockfile)),
    ...readmeProblems(spec),
  ];
}
