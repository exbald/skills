import { relative, sep } from "node:path";

// The comparison page: each capture beside its frozen design, for the lead to compare by eye. Plain HTML and
// CSS, no script. Both images are 390 px wide, which is each one's width in points, so they line up.
const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

/** A file's address for an <img>, relative to the page's folder, one path segment at a time. */
const src = (outDir, file) => escapeHtml(relative(outDir, file).split(sep).map(encodeURIComponent).join("/"));

const CSS = `
body { margin: 0; padding: 24px; background: #111; color: #eee; font: 14px/1.4 system-ui, sans-serif; }
h1 { font-size: 18px; }
article { margin: 0 0 40px; }
h2 { font-size: 16px; border-bottom: 1px solid #333; padding-bottom: 4px; }
h3 { font-size: 13px; font-weight: 600; color: #aaa; margin: 16px 0 8px; }
.pair { display: flex; gap: 16px; align-items: flex-start; }
figure { margin: 0; width: 390px; }
figcaption { color: #888; font-size: 12px; margin-bottom: 4px; }
img { width: 390px; height: auto; display: block; background: #222; }
.missing { width: 390px; padding: 48px 0; text-align: center; color: #c66; border: 1px dashed #644; }
`;

function figure(caption, image, missing) {
  const body = image === null ? `<p class="missing">${missing}</p>` : `<img src="${image}" alt="${escapeHtml(caption)}">`;
  return `<figure><figcaption>${escapeHtml(caption)}</figcaption>${body}</figure>`;
}

function row(pair, { outDir, captured }) {
  const shot = captured.has(`${pair.id}.${pair.theme}`) ? src(outDir, pair.capture) : null;
  const design = pair.design === null ? null : src(outDir, pair.design);
  // The heading sits above the flex row, not in it, so it isn't squeezed in beside the two figures.
  return `<section><h3>${escapeHtml(pair.id)} ${escapeHtml(pair.theme)}</h3>
<div class="pair">${figure("capture", shot, "no capture")}${figure("frozen design", design, "no frozen design")}</div></section>`;
}

/** The comparison page: one section per pair, capture on the left, design on the right. `project` names it. */
export function comparisonPage(pairs, { outDir, captured, project }) {
  const ids = [...new Set(pairs.map((pair) => pair.id))];
  const articles = ids.map((id) => {
    const rows = pairs.filter((pair) => pair.id === id);
    const borrowed = rows[0].comparedWith;
    const heading = borrowed === null ? id : `${id} (compared with ${borrowed})`;
    return `<article><h2>${escapeHtml(heading)}</h2>\n${rows.map((pair) => row(pair, { outDir, captured })).join("\n")}</article>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(project)}: the screen check</title><style>${CSS}</style></head>
<body><h1>The screen check: each capture beside its frozen design</h1>
${articles.join("\n")}
</body></html>
`;
}
