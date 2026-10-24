import { existsSync } from "node:fs";
import { join } from "node:path";

// What each capture is compared with: the gallery's ids, their themes and the frozen design for each. `settings` is the
// screens settings (lib/settings.mjs): the link scheme and gallery path, the id pattern, the design file names, and
// the entries with no design folder of their own (comparedWith).
const ORDER = ["dark", "light"];

function checked(id, settings) {
  if (!new RegExp(settings.idPattern).test(id)) throw new Error(`"${id}" isn't an id: a design folder's name matches ${settings.idPattern}.`);
  return id;
}

/** The gallery link for one entry and theme. */
export function galleryLink(id, theme, settings) {
  return `${settings.linkScheme}://${settings.galleryPath}?screen=${checked(id, settings)}&theme=${theme}`;
}

/** The frozen design for an entry and theme: its own folder's, or comparedWith's, or null when there is none. */
export function designFor(designRoot, id, theme, settings) {
  const file = join(designRoot, settings.comparedWith[checked(id, settings)] ?? id, settings.designFiles[theme]);
  return existsSync(file) ? file : null;
}

/** One row per id and theme, id by id in ids order, and within each id dark before light. */
export function pairsFor(ids, themes, { designRoot, outDir, settings }) {
  const wanted = ORDER.filter((theme) => themes.includes(theme));
  return ids.flatMap((id) =>
    wanted.map((theme) => ({
      id,
      theme,
      link: galleryLink(id, theme, settings),
      capture: join(outDir, `${id}.${theme}.png`),
      design: designFor(designRoot, id, theme, settings),
      comparedWith: settings.comparedWith[id] ?? null,
    })),
  );
}
