// The screen check's settings: the `screens` section of agentkit.config.json, checked and filled in with defaults.
// Everything the capture knows about one app lives here (its package, its link scheme, the emulator image, where the
// gallery's ids and the frozen designs are), so the script and its helpers stay the same in every project. A missing
// section or key is an error that names it: a capture run against a guessed app would draw nothing, or the wrong app.

export const DEFAULTS = Object.freeze({
  galleryPath: "dev/gallery",
  appDir: "apps/mobile",
  readyFile: "files/gallery-ready",
  designRoot: "design/screens",
  designFiles: Object.freeze({ dark: "screen.png", light: "screen-light.png" }),
  comparedWith: Object.freeze({}),
  idPattern: "^S\\d{2}-[a-z0-9-]+$",
  metroPort: 8081,
  // The ready mark comes after layout, but a living avatar's canvas can paint late, and the dev client's own
  // "Refreshing..." banner can still be showing: at 400 ms, the worked example's second live run caught both (blank
  // avatars on its home screen, the banner over six headers); at 2.5 s, neither. 2 seconds a pair adds about 1.5
  // minutes to a full run of 46 pairs.
  settleMs: 2000,
});

const REQUIRED = ["appId", "linkScheme", "avd", "idsFile"];
const KNOWN = new Set([...REQUIRED, "devClientScheme", ...Object.keys(DEFAULTS)]);
// An id becomes a folder, a file name and part of a link, so a pattern that lets any of these through is refused.
const UNSAFE_IDS = ["", ".", "..", "../x", "a/b", "a b", "a&b"];

const isText = (value) => typeof value === "string" && value.trim() !== "";
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isRepoPath = (value) => isText(value) && !value.startsWith("/") && !value.split("/").includes("..") && !/\s/.test(value);
const isScheme = (value) => typeof value === "string" && /^[a-z][a-z0-9+.-]*$/i.test(value);
const where = (key) => `agentkit.config.json's screens.${key}`;

function idPatternOf(source) {
  let pattern;
  try {
    pattern = new RegExp(source);
  } catch (error) {
    throw new Error(`${where("idPattern")} isn't a regular expression: ${error.message}`);
  }
  if (!source.startsWith("^") || !source.endsWith("$")) throw new Error(`${where("idPattern")} must match the whole id: start it with ^ and end it with $.`);
  const unsafe = UNSAFE_IDS.find((id) => pattern.test(id));
  if (unsafe !== undefined) throw new Error(`${where("idPattern")} matches ${JSON.stringify(unsafe)}: an id names a folder and a file, so it can't be empty or hold a slash, a space or "..".`);
  return pattern;
}

function checkRequired(section) {
  const missing = REQUIRED.filter((key) => section[key] === undefined);
  if (missing.length > 0) throw new Error(`agentkit.config.json's screens section has no ${missing.join(", ")}. tools/screens/README.md lists each key.`);
  if (!/^[A-Za-z]\w*(\.[A-Za-z]\w*)+$/.test(String(section.appId))) throw new Error(`${where("appId")} must be the Android package, such as com.example.app.`);
  if (!isScheme(section.linkScheme)) throw new Error(`${where("linkScheme")} must be the app's link scheme, such as myapp.`);
  if (!isText(section.avd) || /\s/.test(section.avd)) throw new Error(`${where("avd")} must be the emulator image's name.`);
  if (!isRepoPath(section.idsFile)) throw new Error(`${where("idsFile")} must be the gallery's ids.json, as a path in the repository.`);
}

function checkOptional(settings) {
  if (!isScheme(settings.devClientScheme)) throw new Error(`${where("devClientScheme")} must be a link scheme, such as exp+myapp.`);
  for (const key of ["appDir", "designRoot"]) if (!isRepoPath(settings[key])) throw new Error(`${where(key)} must be a path in the repository.`);
  if (!/^[\w-]+(\/[\w-]+)*$/.test(String(settings.galleryPath))) throw new Error(`${where("galleryPath")} must be the gallery's path in a link, such as dev/gallery.`);
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(String(settings.readyFile)) || settings.readyFile.split("/").includes("..")) {
    throw new Error(`${where("readyFile")} must be a path in the app's own storage, such as files/gallery-ready.`);
  }
  const files = settings.designFiles;
  if (!isObject(files) || !["dark", "light"].every((theme) => isText(files[theme]) && !files[theme].includes("/"))) {
    throw new Error(`${where("designFiles")} must name the dark and light design files, such as { "dark": "screen.png", "light": "screen-light.png" }.`);
  }
  for (const key of ["metroPort", "settleMs"]) {
    if (!Number.isInteger(settings[key]) || settings[key] <= 0 || (key === "metroPort" && settings[key] > 65535)) throw new Error(`${where(key)} must be a positive whole number.`);
  }
}

function checkComparedWith(comparedWith, pattern) {
  if (!isObject(comparedWith)) throw new Error(`${where("comparedWith")} must map an entry's id to the design it's compared with.`);
  for (const [id, design] of Object.entries(comparedWith)) {
    if (!pattern.test(id) || typeof design !== "string" || !pattern.test(design)) throw new Error(`${where("comparedWith")}: "${id}" → "${design}" must name two ids.`);
  }
}

/** The `screens` section with its defaults filled in, frozen. Throws an Error that names the key at fault. */
export function screensSettings(section) {
  if (!isObject(section)) {
    throw new Error("agentkit.config.json has no screens section. Add one with appId, linkScheme, avd and idsFile (tools/screens/README.md).");
  }
  const unknown = Object.keys(section).filter((key) => !KNOWN.has(key) && !key.startsWith("$"));
  if (unknown.length > 0) throw new Error(`agentkit.config.json's screens section has unknown keys: ${unknown.join(", ")}.`);
  checkRequired(section);
  const settings = { ...DEFAULTS, devClientScheme: `exp+${section.linkScheme}`, ...section };
  checkOptional(settings);
  const pattern = idPatternOf(String(settings.idPattern));
  checkComparedWith(settings.comparedWith, pattern);
  return Object.freeze({ ...settings, designFiles: Object.freeze({ ...settings.designFiles }), comparedWith: Object.freeze({ ...settings.comparedWith }) });
}
