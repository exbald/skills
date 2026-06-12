#!/usr/bin/env npx tsx
/**
 * Deterministic codemap generator — ADAPTABLE TEMPLATE.
 *
 * Copy to `scripts/codemaps/generate.ts` in the target repo, then KEEP the core
 * machinery (ROOT/walk/read/idempotent write/banner/--check) and ADAPT the
 * scanners + CONFIG block to the repo's stack. See the skill's
 * references/generator-patterns.md for scanner recipes per framework/ORM.
 *
 * This reference implementation targets **Next.js App Router + Drizzle ORM**.
 * Sections you will likely edit are marked `// ADAPT:`.
 *
 * Invariants to preserve (these give the guarantees — do not break them):
 *   - Deterministic: scan real files only. No LLM, no network. Sort everything.
 *   - Idempotent: write a file only when its content changed → no git churn.
 *   - The schema scan is wrapped in try/catch: on failure, LEAVE data.md
 *     untouched rather than emit a broken/empty map.
 *   - One hand-written file (docs/codemaps/flows.md) is NEVER written here.
 *
 * Run: pnpm codemaps    Flags: --check (exit 1 if any auto file is stale)
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, relative, basename, dirname } from "node:path";
import { execSync } from "node:child_process";
// ADAPT: Drizzle introspection imports — drop if the repo uses another ORM.
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../../src/lib/schema"; // ADAPT: path to schema module

// ── Core machinery (keep as-is) ──────────────────────────────────────────────
const ROOT = (() => {
  try {
    return execSync("git rev-parse --show-toplevel").toString().trim();
  } catch {
    return process.cwd();
  }
})();
const SRC = join(ROOT, "src"); // ADAPT if source root differs
const APP = join(SRC, "app");
const OUT = join(ROOT, "docs", "codemaps");
const REPORTS = join(ROOT, ".reports");
const CHECK = process.argv.includes("--check");

const read = (p: string): string => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};
const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
const rel = (p: string): string => relative(ROOT, p).split("\\").join("/");
function gitHead(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

// ── CONFIG (ADAPT to the repo) ───────────────────────────────────────────────
const PROJECT =
  (JSON.parse(read(join(ROOT, "package.json")) || "{}").name as string) ||
  "this repo";
// Presence-checked external systems. Edit to match the repo's integrations.
const INTEGRATIONS = [
  { name: "Postgres (Drizzle)", via: "src/lib/db.ts", envKeys: ["DATABASE_URL"] },
];

// ── Scanners (ADAPT per stack — see references/generator-patterns.md) ─────────
function urlFor(relDir: string): string {
  const segs = relDir.split(/[\\/]/).filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}
const isClient = (file: string): boolean =>
  /^["']use client["']/m.test(read(file).slice(0, 200));

interface Page { url: string; file: string; client: boolean; group: string }
interface Api { url: string; file: string; methods: string[]; auth: boolean }

function collectRoutes(): { pages: Page[]; apis: Api[] } {
  const pages: Page[] = [];
  const apis: Api[] = [];
  for (const file of walk(APP)) {
    const name = basename(file);
    const relDir = relative(APP, dirname(file));
    const g = relDir.match(/\(([^)]+)\)/);
    const group = g ? `(${g[1]})` : "—";
    if (name === "page.tsx" || name === "page.ts") {
      pages.push({ url: urlFor(relDir) || "/", file: rel(file), client: isClient(file), group });
    } else if (name === "route.ts" || name === "route.tsx") {
      const src = read(file);
      const methods = [
        ...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g),
      ].map((m) => m[1]!);
      apis.push({
        url: urlFor(relDir) || "/",
        file: rel(file),
        methods: [...new Set(methods)],
        auth: /auth\.api\.getSession|getServerSession|requireAuth/.test(src), // ADAPT auth probe
      });
    }
  }
  const by = (a: { url: string }, b: { url: string }) => a.url.localeCompare(b.url);
  return { pages: pages.sort(by), apis: apis.sort(by) };
}

interface Action { file: string; fns: string[] }
function collectActions(): Action[] {
  const out: Action[] = [];
  for (const file of walk(SRC).filter((f) => /\.tsx?$/.test(f))) {
    const src = read(file);
    if (!/^\s*["']use server["']/m.test(src)) continue;
    const fns = [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]!);
    if (fns.length) out.push({ file: rel(file), fns });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// ADAPT: Drizzle schema scan. For Prisma/SQL/other ORMs, replace this whole
// block per references/generator-patterns.md (keep the Table shape + sort).
interface Column { name: string; type: string; notNull: boolean; pk: boolean; ref: string | null }
interface Table { name: string; constName: string; columns: Column[]; indexes: number }
function tableNameMap(): Map<unknown, string> {
  const map = new Map<unknown, string>();
  for (const v of Object.values(schema)) if (is(v, PgTable)) map.set(v, getTableConfig(v).name);
  return map;
}
function collectSchema(): Table[] {
  const names = tableNameMap();
  const tables: Table[] = [];
  for (const [constName, v] of Object.entries(schema)) {
    if (!is(v, PgTable)) continue;
    const cfg = getTableConfig(v);
    const fkByCol = new Map<string, string>();
    for (const fk of cfg.foreignKeys) {
      const r = fk.reference();
      const ft = names.get(r.foreignTable) ?? "?";
      const onDelete = fk.onDelete && fk.onDelete !== "no action" ? ` (${fk.onDelete})` : "";
      r.columns.forEach((c, i) => {
        const fcol = r.foreignColumns[i]?.name ?? r.foreignColumns[0]?.name;
        fkByCol.set(c.name, `${ft}.${fcol}${onDelete}`);
      });
    }
    const columns: Column[] = cfg.columns.map((c) => ({
      name: c.name,
      type: c.getSQLType(),
      notNull: c.notNull,
      pk: c.primary,
      ref: fkByCol.get(c.name) ?? null,
    }));
    tables.push({ name: cfg.name, constName, columns, indexes: cfg.indexes.length });
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

interface Group { name: string; count: number; note?: string }
function collectComponents(): Group[] {
  const dir = join(SRC, "components");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .map((e) =>
      e.isDirectory()
        ? { name: e.name + "/", count: walk(join(dir, e.name)).filter((f) => /\.tsx?$/.test(f)).length }
        : { name: e.name, count: 1 }
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
function firstComment(file: string): string {
  const head = read(file).slice(0, 400);
  const m = head.match(/\/\*\*\s*\n?\s*\*?\s*([^\n*]+)/);
  return m ? m[1]!.trim().slice(0, 90) : "";
}
function collectLibs(): Group[] {
  const dir = join(SRC, "lib");
  const out: Group[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push({ name: e.name + "/", count: walk(full).filter((f) => f.endsWith(".ts")).length });
    else if (e.name.endsWith(".ts")) out.push({ name: e.name, count: 1, note: firstComment(full) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function collectIntegrations() {
  return INTEGRATIONS.filter((c) => existsSync(join(ROOT, c.via)));
}
function collectMigrations(): string[] {
  const dir = join(ROOT, "drizzle"); // ADAPT: prisma/migrations, db/migrate, etc.
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

interface Spec { name: string; status: string; statusFile: string | null }
function collectSpecs(): Spec[] {
  const dir = join(ROOT, "specs"); // ADAPT or delete if the repo has no specs/
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const sp = join(dir, e.name, "STATUS.md");
      if (!existsSync(sp)) return { name: e.name, status: "—", statusFile: null };
      const m = read(sp).match(/\*\*(.+?)\*\*/);
      return { name: e.name, status: m ? m[1]!.replace(/\s+/g, " ").trim() : "see file", statusFile: rel(sp) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface EnvVar { key: string; required: boolean; default: string | null }
function parseZodObject(body: string): EnvVar[] {
  const keyRe = /^\s*([A-Z][A-Z0-9_]*)\s*:/gm;
  const keys: { key: string; idx: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(body))) keys.push({ key: m[1]!, idx: m.index, end: m.index + m[0].length });
  return keys.map((k, i) => {
    const slice = body.slice(k.end, keys[i + 1]?.idx ?? body.length);
    const def =
      slice.match(/\.default\((["'`])(.*?)\1\)/)?.[2] ??
      slice.match(/\.default\(([^)]+)\)/)?.[1] ??
      null;
    return { key: k.key, required: !/\.optional\(\)/.test(slice) && def === null, default: def };
  });
}
function collectEnv(): { server: EnvVar[]; client: EnvVar[] } {
  const src = read(join(SRC, "lib", "env.ts")); // ADAPT path, or parse .env.example
  const grab = (name: string): EnvVar[] => {
    const start = src.indexOf(`${name} = z.object({`);
    if (start === -1) return [];
    const open = src.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    return parseZodObject(src.slice(open + 1, end));
  };
  return { server: grab("serverEnvSchema"), client: grab("clientEnvSchema") };
}

// ── Flows (auto-derived from file-header JSDoc — NOT hand-written) ────────────
// The "why" lives in each module's top-of-file JSDoc, maintained by whoever edits
// the code (enforce via the header-freshness rule in AGENTS.md — see the skill's
// references/hook-and-wiring.md). Quote those headers verbatim → grounded, never
// fabricated. A stale header yields a stale quote, never an invented one. This is
// what lets the "why" survive vibe-coding: the coding agent writes the headers.
interface Flow { title: string; file: string; body: string }
function leadingJsDoc(file: string): string[] {
  const src = read(file);
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!m || (m.index ?? 0) > 1500) return []; // must be a top-of-file header
  const lines = m[1]!
    .split("\n")
    .map((l) => l.replace(/^\s*\*?\s?/, "").replace(/\s+$/, ""))
    .filter((l) => !/^@\w/.test(l.trim()));
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines;
}
// ADAPT: skip scoped scratch/discovery areas with real-but-non-flow headers.
const FLOW_EXCLUDE = /inventory-probes\/|\.test\.|__mocks__\//;
function collectFlows(): Flow[] {
  const dirs = [join(SRC, "lib"), join(SRC, "app", "api")]; // ADAPT dirs to scan
  const flows: Flow[] = [];
  for (const dir of dirs) {
    for (const file of walk(dir).filter((f) => /\.tsx?$/.test(f))) {
      if (FLOW_EXCLUDE.test(rel(file))) continue;
      const lines = leadingJsDoc(file);
      if (lines.filter((l) => l.trim()).length < 4) continue; // substantial headers only
      flows.push({
        title: lines[0]!.replace(/[.,:(]\s*$/, "").trim(),
        file: rel(file),
        body: lines.slice(1).join("\n").trim(),
      });
    }
  }
  return flows.sort((a, b) => a.file.localeCompare(b.file));
}

// ── Render ───────────────────────────────────────────────────────────────────
function banner(title: string): string {
  return (
    `# ${title}\n\n` +
    "> AUTO-GENERATED by `scripts/codemaps/generate.ts` — do not edit by hand.\n" +
    "> Regenerated when source changes (Stop hook in `.claude/settings.json`).\n" +
    `> Freshness: git \`${gitHead()}\`. The "why" lives in [flows.md](./flows.md).\n`
  );
}
function pkgStack(): string {
  const pkg = JSON.parse(read(join(ROOT, "package.json")) || "{}");
  const d = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  const has = (n: string) => Boolean(d[n]);
  const bits: string[] = [];
  if (has("next")) bits.push(`Next.js ${d["next"]} (App Router)`);
  if (has("react")) bits.push(`React ${d["react"]}`);
  if (has("typescript")) bits.push("TypeScript");
  if (has("drizzle-orm")) bits.push("Drizzle ORM");
  if (has("@prisma/client")) bits.push("Prisma");
  if (has("tailwindcss")) bits.push("Tailwind CSS");
  return bits.join(" · ");
}

function renderFlows(d: Data): string {
  const head =
    `# Flows — the "why" (auto-derived)\n\n` +
    "> AUTO-GENERATED by `scripts/codemaps/generate.ts` — do not edit by hand.\n" +
    "> Each section is a flow module's top-of-file JSDoc, quoted verbatim from source —\n" +
    "> grounded, never fabricated. To change a description, edit the header in that file\n" +
    "> (see the header-freshness rule in AGENTS.md).\n" +
    `> Freshness: git \`${gitHead()}\`.\n\n` +
    `${d.flows.length} flow module(s) with a substantial header.\n`;
  const body = d.flows.map((f) => `\n## ${f.title}\n\n\`${f.file}\`\n\n${f.body}`).join("\n");
  return head + body + "\n";
}

interface Data {
  pages: Page[]; apis: Api[]; actions: Action[]; tables: Table[];
  components: Group[]; libs: Group[]; integrations: { name: string; via: string; envKeys: string[] }[];
  migrations: string[]; specs: Spec[]; env: { server: EnvVar[]; client: EnvVar[] }; flows: Flow[];
}

function renderArchitecture(d: Data): string {
  const actionFns = d.actions.reduce((n, a) => n + a.fns.length, 0);
  const specRows = d.specs.length
    ? `\n\n## Spec status (\`specs/*/STATUS.md\`)\n| Spec | Status |\n|------|--------|\n` +
      d.specs.map((s) => `| ${s.statusFile ? `[${s.name}](../../${s.statusFile})` : s.name} | ${s.status} |`).join("\n")
    : "";
  return (
    banner(`Architecture — ${PROJECT}`) +
    `\n**Stack:** ${pkgStack() || "—"}.\n\n` +
    `**Subsystem maps:** [frontend.md](./frontend.md) · [backend.md](./backend.md) · [data.md](./data.md) · [flows.md](./flows.md) (the "why").\n\n` +
    `**Counts:** ${d.pages.length} pages · ${d.apis.length} API handlers · ${actionFns} server action(s) · ${d.tables.length} tables · ${d.migrations.length} migrations · ${d.components.length} component groups · ${d.specs.length} specs.` +
    specRows + "\n"
  );
}
function renderFrontend(d: Data): string {
  return (
    banner("Frontend — routes & components") +
    `\n## Pages (${d.pages.length})\n| URL | Group | File | Rendering |\n|-----|-------|------|-----------|\n` +
    d.pages.map((p) => `| \`${p.url}\` | ${p.group} | ${p.file} | ${p.client ? "client" : "server"} |`).join("\n") +
    `\n\n## Component groups (\`src/components/\`)\n` +
    d.components.map((c) => `- \`${c.name}\` — ${c.count} file(s)`).join("\n") + "\n"
  );
}
function renderBackend(d: Data): string {
  return (
    banner("Backend — actions, handlers, libs") +
    `\n## Server actions (\`"use server"\`)\n` +
    (d.actions.length
      ? d.actions.map((a) => `- \`${a.file}\` → ${a.fns.map((f) => "`" + f + "()`").join(", ")}`).join("\n")
      : "_(none)_") +
    `\n\n## Route handlers / API (${d.apis.length})\n| URL | Methods | Auth | File |\n|-----|---------|------|------|\n` +
    d.apis.map((a) => `| \`${a.url}\` | ${a.methods.join(", ") || "—"} | ${a.auth ? "yes" : "—"} | ${a.file} |`).join("\n") +
    `\n\n## Lib (\`src/lib/\`)\n` +
    d.libs.map((l) => (l.note ? `- \`${l.name}\` — ${l.note}` : `- \`${l.name}\`${l.count > 1 ? ` — ${l.count} file(s)` : ""}`)).join("\n") +
    `\n\n## Integrations\n` +
    d.integrations.map((i) => `- **${i.name}** — \`${i.via}\` · env: ${i.envKeys.map((k) => "`" + k + "`").join(", ")}`).join("\n") + "\n"
  );
}
function renderData(d: Data): string {
  const tableBlock = (t: Table): string => {
    const pk = t.columns.filter((c) => c.pk).map((c) => c.name);
    const head = `### \`${t.name}\`${pk.length ? ` (PK \`${pk.join(", ")}\`)` : ""} — ${t.indexes} index(es)`;
    const rows = t.columns
      .map((c) => `| \`${c.name}\` | ${c.type} | ${c.notNull ? "not null" : ""} | ${c.ref ? `→ ${c.ref}` : ""} |`)
      .join("\n");
    return `${head}\n\n| column | type | null | ref |\n|---|---|---|---|\n${rows}`;
  };
  const envRow = (e: EnvVar) =>
    `| \`${e.key}\` | ${e.required ? "**required**" : "optional"} | ${e.default !== null ? "`" + e.default + "`" : ""} |`;
  return (
    banner("Data — schema, migrations, env") +
    `\n## Tables (${d.tables.length})\n` +
    d.tables.map(tableBlock).join("\n\n") +
    `\n\n## Migrations (${d.migrations.length})\n` +
    (d.migrations.map((m) => "`" + m + "`").join(" · ") || "_(none)_") +
    `\n\n## Environment\n### Server (${d.env.server.length})\n| key | required | default |\n|-----|----------|---------|\n` +
    d.env.server.map(envRow).join("\n") +
    `\n\n### Client (${d.env.client.length})\n| key | required | default |\n|-----|----------|---------|\n` +
    d.env.client.map(envRow).join("\n") + "\n"
  );
}

// ── Collect + idempotent write ───────────────────────────────────────────────
function main(): void {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });

  const { pages, apis } = collectRoutes();

  let tables: Table[] | null = null;
  try {
    tables = collectSchema();
  } catch (err) {
    console.warn(`[codemap] schema scan failed, leaving data.md untouched: ${(err as Error).message}`);
  }

  const data: Data = {
    pages, apis,
    actions: collectActions(),
    tables: tables ?? [],
    components: collectComponents(),
    libs: collectLibs(),
    integrations: collectIntegrations(),
    migrations: collectMigrations(),
    specs: collectSpecs(),
    env: collectEnv(),
    flows: collectFlows(),
  };

  const files: Record<string, string> = {
    "architecture.md": renderArchitecture(data),
    "frontend.md": renderFrontend(data),
    "backend.md": renderBackend(data),
    "flows.md": renderFlows(data),
  };
  if (tables !== null) files["data.md"] = renderData(data);

  const report: string[] = [];
  let wrote = 0;
  let stale = 0;
  for (const [name, content] of Object.entries(files)) {
    const path = join(OUT, name);
    const prev = read(path);
    if (content === prev) { report.push(`${name}: unchanged`); continue; }
    stale++;
    if (!CHECK) { writeFileSync(path, content); wrote++; }
    report.push(`${name}: ${prev ? "changed" : "created"}`);
  }
  if (tables === null) report.push("data.md: SKIPPED (schema scan failed)");

  if (!CHECK) writeFileSync(join(REPORTS, "codemap-diff.txt"), `git ${gitHead()}\n${report.join("\n")}\n`);

  if (CHECK) {
    if (stale > 0) { console.error(`[codemap] STALE — ${stale} file(s) would change. Run \`pnpm codemaps\`.`); process.exit(1); }
    console.log("[codemap] up to date.");
    return;
  }
  console.log(wrote ? `[codemap] regenerated ${wrote} file(s): ${report.join("; ")}` : "[codemap] up to date (no changes).");
}

main();
