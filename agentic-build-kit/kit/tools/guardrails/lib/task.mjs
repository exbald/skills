// The active spec task. specs/.current-task names a task file; the backticked paths in its
// "Files to Modify" and "Files to Create" sections, plus the bookkeeping files, are the only
// repository paths an agent may change while it works on that task (AGENTS.md, Work loop).
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, posix, resolve } from "node:path";
import { canonicalPath, globToRegExp, toRepoPath } from "./paths.mjs";
import { LEDGER_FILE, MARKER_FILE, STAMP_FILE } from "./state.mjs";

/** The task named by the marker, or null when there is no marker or the file it names is missing. */
export function activeTask(root) {
  const marker = join(root, MARKER_FILE);
  if (!existsSync(marker)) return null;
  const named = readFileSync(marker, "utf8").split(/\r?\n/)[0].trim();
  if (!named) return null;
  const abs = canonicalPath(isAbsolute(named) ? named : join(root, named));
  const path = toRepoPath(root, abs);
  if (!path || path === "." || !existsSync(abs) || !statSync(abs).isFile()) return null;
  const text = readFileSync(abs, "utf8");
  const specDir = posix.dirname(posix.dirname(path));
  const always = [path, `${specDir}/README.md`, `${specDir}/BLOCKED.md`, LEDGER_FILE, MARKER_FILE, STAMP_FILE];
  return { path, abs, specDir, text, entries: listedEntries(text, root), always: new Set(always) };
}

/** The body of a "## Title" section (up to the next "## " heading), or null. */
export function section(text, title) {
  const lines = text.split(/\r?\n/);
  const heading = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  const length = lines.slice(start + 1).findIndex((line) => /^##\s/.test(line));
  return lines.slice(start + 1, length === -1 ? undefined : start + 1 + length).join("\n");
}

/** The first non-empty line under "## Status", lower case, without Markdown emphasis. */
export function taskStatus(text) {
  const line = (section(text, "Status") ?? "").split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return line.replace(/[`*_]/g, "").trim().toLowerCase();
}

export function isComplete(status) {
  return /^completed?\b/.test(status);
}

/** Repository paths listed under one "## Title" section; directories end with "/". */
export function sectionEntries(text, title, root) {
  const quoted = [...(section(text, title) ?? "").matchAll(/`([^`\n]+)`/g)].map((match) => match[1].trim());
  return [...new Set(quoted.filter(looksLikePath).map((word) => normalizeEntry(word, root)).filter(Boolean))];
}

/** Repository paths listed under Files to Modify and Files to Create; directories end with "/". */
export function listedEntries(text, root) {
  return [...new Set(["Files to Modify", "Files to Create"].flatMap((title) => sectionEntries(text, title, root)))];
}

export function looksLikePath(word) {
  if (!word || /[\s$<>|;&]/.test(word) || /^[a-z][a-z0-9+.-]*:/i.test(word)) return false;
  return word.includes("/") || /\.[A-Za-z][A-Za-z0-9]*$/.test(word) || /^[A-Z][A-Za-z]*file$/.test(word);
}

export function normalizeEntry(word, root) {
  const directory = word.endsWith("/") || word.endsWith("/**");
  const bare = word.replace(/\/\*\*$/, "").replace(/\/+$/, "");
  const rel = bare === "" ? null : toRepoPath(root, resolve(root, bare));
  if (!rel || rel === ".") return null;
  return directory ? `${rel}/` : rel;
}

/** A listed entry is a glob only with `*` or `?`. Brackets are literal: `[botId]` is an Expo route's folder. */
export function isGlobEntry(entry) {
  return /[*?]/.test(entry);
}

/**
 * Whether `rel` is covered by `entry`: the same path, inside a listed directory ("dir/"), or
 * matching a glob. Directories don't count when `allowDirectories` is false (test files).
 */
export function matchesEntry(rel, entry, allowDirectories = true) {
  if (entry.endsWith("/")) return allowDirectories && (rel === entry.slice(0, -1) || rel.startsWith(entry));
  if (isGlobEntry(entry)) return globToRegExp(entry, { classes: false }).test(rel);
  return rel === entry;
}

export function isListed(rel, entries, allowDirectories = true) {
  return entries.some((entry) => matchesEntry(rel, entry, allowDirectories));
}
