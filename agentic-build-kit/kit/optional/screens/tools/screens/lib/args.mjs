import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

// The default image and settle time come from the screens settings (lib/settings.mjs).
export const THEMES = ["dark", "light"];
export const USAGE =
  "Usage: node tools/screens/capture.mjs [--only S03-thread,S08-approval] [--themes dark,light] [--avd <image>] [--serial <serial>] [--out <dir>] [--settle-ms <ms>]";

const pad = (value) => String(value).padStart(2, "0");

/** "2026-10-23-140509": the run's folder name, in the machine's own time. */
function stamp(now) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${date}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** The value after `flag`, taken from `--flag value` or `--flag=value`; the index to go on from comes back with it. */
function valueOf(argv, index) {
  const [flag, ...inline] = argv[index].split("=");
  if (inline.length > 0) return { flag, value: inline.join("="), next: index + 1 };
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
  return { flag, value, next: index + 2 };
}

function insideRepo(repoRoot, path) {
  const from = relative(repoRoot, path);
  return from === "" || (!from.startsWith("..") && !isAbsolute(from));
}

/**
 * The builds folder, `<project>-builds` beside the repository, where the wave runner puts its clones. A build clone
 * sits in that folder itself, so its captures land there, not in a folder of the same name nested under it.
 */
function buildsRoot(repoRoot, project) {
  const folder = `${project}-builds`;
  const parent = dirname(repoRoot);
  return basename(parent) === folder ? parent : resolve(parent, folder);
}

/**
 * The options, or throws an Error whose message is the reason (for exit 2). `settings` is the screens settings
 * (lib/settings.mjs), for the default image and settle time; `project` is agentkit.config.json's project name.
 */
export function parseArgs(argv, { repoRoot, ids, settings, project, env = {}, now = new Date() }) {
  const given = {};
  for (let index = 0; index < argv.length; ) {
    if (!argv[index].startsWith("--")) throw new Error(`Unexpected argument ${argv[index]}.`);
    const { flag, value, next } = valueOf(argv, index);
    if (!["--only", "--themes", "--avd", "--serial", "--out", "--settle-ms"].includes(flag)) throw new Error(`Unknown option ${flag}.`);
    given[flag] = value;
    index = next;
  }

  const themes = given["--themes"] === undefined ? [...THEMES] : given["--themes"].split(",").map((theme) => theme.trim());
  for (const theme of themes) if (!THEMES.includes(theme)) throw new Error(`Unknown theme "${theme}": use dark, light or both.`);

  const listed = given["--only"] === undefined ? null : given["--only"].split(",").map((id) => id.trim()).filter((id) => id !== "");
  if (listed?.length === 0) throw new Error("--only needs at least one id.");
  for (const id of listed ?? []) if (!ids.includes(id)) throw new Error(`Unknown id ${id}: it isn't in the gallery's ids.json.`);
  // Captured id by id in the gallery's order, each once, however the ids were typed.
  const only = listed === null ? null : ids.filter((id) => listed.includes(id));

  const settle = given["--settle-ms"] === undefined ? settings.settleMs : Number(given["--settle-ms"]);
  if (!Number.isInteger(settle) || settle <= 0) throw new Error(`--settle-ms takes a positive whole number, not "${given["--settle-ms"]}".`);

  // The serial the run is told to use: the flag wins over the environment. Null when neither is given.
  const serial =
    given["--serial"] !== undefined
      ? { value: given["--serial"], from: "--serial" }
      : env.ANDROID_SERIAL
        ? { value: env.ANDROID_SERIAL, from: "ANDROID_SERIAL" }
        : null;

  const out = given["--out"] === undefined ? resolve(buildsRoot(repoRoot, project), "screens", stamp(now)) : resolve(given["--out"]);
  if (insideRepo(repoRoot, out)) throw new Error(`--out ${out} is inside the repository: captures go beside it, never in it.`);

  return { only, themes, avd: given["--avd"] ?? settings.avd, serial, out, settleMs: settle };
}
