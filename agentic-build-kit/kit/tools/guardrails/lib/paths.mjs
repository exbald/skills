// Path helpers: resolve what a tool or shell word points at, canonically (macOS /var is
// /private/var), and express it relative to the repository root.
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** The absolute path with symlinks resolved, even when the file (or its folders) don't exist yet. */
export function canonicalPath(path) {
  const absolute = resolve(path);
  let existing = absolute;
  const missing = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return absolute;
    missing.unshift(basename(existing));
    existing = parent;
  }
  try {
    return join(realpathSync.native(existing), ...missing);
  } catch {
    return absolute;
  }
}

/** The path itself when it is an existing folder, otherwise its nearest existing parent folder. */
export function existingDirectory(path) {
  let current = resolve(path);
  while (!isDirectory(current) && dirname(current) !== current) current = dirname(current);
  return current;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `abs` relative to `root` with forward slashes, "." for the root itself, or null when outside it. */
export function toRepoPath(root, abs) {
  const rel = relative(root, abs);
  if (rel === "") return ".";
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** True when `child` is strictly inside `parent`. */
export function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Test files are the contract: foo.test.ts, foo.spec.tsx, foo.test.mjs and so on. */
export function isTestFile(rel) {
  return /\.(test|spec)\.[^/]+$/i.test(rel);
}

/**
 * A shell glob as an anchored RegExp: * and ? stay within a folder, ** crosses folders. With `classes: false`,
 * `[` and `]` are literal, as in a task's file list, where `[botId]` is an Expo route's folder.
 */
export function globToRegExp(glob, { classes = true } = {}) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      const slash = glob[index + 2] === "/";
      pattern += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") pattern += "[^/]*";
    else if (char === "?") pattern += "[^/]";
    else if (classes && char === "[" && glob.indexOf("]", index + 2) > index) {
      const end = glob.indexOf("]", index + 2);
      pattern += `[${glob.slice(index + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
      index = end;
    } else pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}
