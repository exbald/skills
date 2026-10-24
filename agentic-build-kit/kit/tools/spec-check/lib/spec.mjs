// Reads spec folders into plain data. This module only reads; format.mjs, overlap.mjs and ready.mjs
// decide what is wrong. File lists are parsed by the guardrails' task.mjs, so the guard and the
// checker read "Files to Modify" and "Files to Create" the same way.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sectionEntries, taskStatus } from "../../guardrails/lib/task.mjs";

const SPEC_DIR = /^\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
const TASK_FILE = /^task-(\d{2})-[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const FENCE = /^(```|~~~)/;

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** True when `name` is a valid task file name: task-NN-slug.md. */
export function isTaskFileName(name) {
  return TASK_FILE.test(name);
}

/** The repo-relative spec folders under specs/ (NN-name), sorted. */
export function specDirs(root) {
  const specs = join(root, "specs");
  if (!isDirectory(specs)) return [];
  return readdirSync(specs)
    .filter((name) => SPEC_DIR.test(name) && isDirectory(join(specs, name)))
    .sort()
    .map((name) => `specs/${name}`);
}

/** Every "## " section as { title, body }. A heading inside a fenced code block doesn't count. */
export function splitSections(text) {
  const sections = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1] ?? null;
    if (marker && (fence === null || fence === marker)) fence = fence === null ? marker : null;
    const heading = fence === null && !marker ? /^## (.*)$/.exec(line) : null;
    if (heading) sections.push({ title: heading[1].trim(), lines: [] });
    else if (sections.length > 0) sections.at(-1).lines.push(line);
  }
  return sections.map(({ title, lines }) => ({ title, body: lines.join("\n") }));
}

function bodyOf(sections, title) {
  return sections.find((section) => section.title === title)?.body ?? "";
}

function readTask(root, dir, name) {
  const file = `${dir}/tasks/${name}`;
  const text = readText(join(root, file)) ?? "";
  const sections = splitSections(text);
  const waveText = bodyOf(sections, "Wave").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return {
    file,
    id: `task-${TASK_FILE.exec(name)[1]}`,
    text,
    sections,
    status: taskStatus(text),
    waveText,
    wave: /^\d+$/.test(waveText) ? Number(waveText) : Number.NaN,
    modify: sectionEntries(text, "Files to Modify", root),
    create: sectionEntries(text, "Files to Create", root),
  };
}

/** A spec folder as data: its README, which files it has, and its parsed tasks. */
export function readSpec(root, dir) {
  const abs = join(root, dir);
  const tasksDir = join(abs, "tasks");
  const taskFiles = isDirectory(tasksDir)
    ? readdirSync(tasksDir).filter((name) => statSync(join(tasksDir, name)).isFile()).sort()
    : [];
  return {
    dir,
    readme: readText(join(abs, "README.md")),
    hasRequirements: existsSync(join(abs, "requirements.md")),
    hasActionRequired: existsSync(join(abs, "action-required.md")),
    taskFiles,
    tasks: taskFiles.filter(isTaskFileName).map((name) => readTask(root, dir, name)),
  };
}
