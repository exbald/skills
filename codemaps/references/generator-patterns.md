# Generator patterns — scanner recipes per stack

How to adapt `assets/generate.ts` to a repo. The **core machinery** (ROOT-via-git, `walk`,
`read`, `rel`, `gitHead`, idempotent write, `banner`, `--check`) is stack-agnostic — keep it.
Only the **scanners** change. Each scanner returns a sorted array of plain objects; `render*`
turns them into token-lean markdown tables.

## Contents
- [Invariants (do not break)](#invariants)
- [Routes / pages](#routes)
- [API / route handlers + auth](#api)
- [Server actions](#actions)
- [DB schema (the high-value, high-fragility one)](#schema)
- [Components / lib modules](#modules)
- [Flows — the "why", auto-derived from JSDoc](#flows)
- [Env vars](#env)
- [Specs / migrations / integrations](#misc)
- [Non-TypeScript-loader projects (plain node + regex)](#plain-node)

<a name="invariants"></a>
## Invariants (do not break)

1. **Deterministic** — scan files only; no LLM, no network, no DB connection. Stable-sort
   every collection before render so ordering never flaps.
2. **Idempotent** — write a file only when its content differs from disk (string compare).
   No structural change → no write → no git churn. The `banner` carries `git <short HEAD>`
   as the freshness anchor (changes on commit; that's acceptable).
3. **Schema scan is fail-safe** — wrap it in try/catch. On failure (broken TS mid-edit, parse
   error), LEAVE `data.md` untouched rather than emit an empty/wrong map. A half-saved edit
   must never corrupt "the brain."
4. **`flows.md` is auto-derived, not hand-written** — it quotes each flow module's top-of-file
   JSDoc header verbatim (see [Flows](#flows)). Grounded: a stale header yields a stale quote,
   never an invented one. Nothing in `docs/codemaps/` is hand-authored.
5. **Token-lean** — tables and counts, never code dumps or prose (except `flows.md`, which *is*
   the quoted prose, scoped by header-length + `FLOW_EXCLUDE`).

<a name="routes"></a>
## Routes / pages

**Next.js App Router** (template default): walk `src/app`; a dir's `page.tsx` → a route with
`(group)` segments stripped and `[param]`/`[...slug]` kept; `"use client"` sniff in the first
~200 chars → server vs client. See `collectRoutes` in the template.

- **Next.js Pages Router**: walk `pages/`; the file path IS the route (`pages/blog/[id].tsx` →
  `/blog/[id]`); `_app`, `_document`, `api/` are special-cased.
- **Remix/React Router**: parse `app/routes/` (flat or nested) or the routes config.
- **SvelteKit**: walk `src/routes/**/+page.svelte` and `+server.ts`.
- **Express/Fastify/Hono**: grep router registrations
  (`app.(get|post|put|delete)\(["']([^"']+)`) across the routes dir; the URL is the string arg.

<a name="api"></a>
## API / route handlers + auth

Next.js: `route.ts` → exported HTTP verbs via
`/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g`. The **auth
flag** is a substring probe — adapt the regex to the repo's auth call
(`auth.api.getSession`, `getServerSession`, `requireAuth`, a middleware import, etc.). Confirm
the probe against 2-3 real handlers before trusting it.

Express-style: methods come from the registration verb, not exports.

<a name="actions"></a>
## Server actions

Files containing a top-of-file `"use server"` directive → exported `async function` names.
Only relevant to React Server Components / Next.js. Delete this scanner for other stacks.

<a name="schema"></a>
## DB schema — high value, high fragility

The FK graph + types are the most valuable part of the map and the easiest to get wrong.
Prefer **structured introspection over regex** wherever the ORM allows it.

### Drizzle (template default) — `getTableConfig`
Import the schema module and call `getTableConfig(table)` per exported `pgTable`. Gives
columns (`.name`, `.getSQLType()`, `.notNull`, `.primary`), `.foreignKeys` (each
`fk.reference()` → `{ columns, foreignTable, foreignColumns }` + `fk.onDelete`), and
`.indexes`. **Formatting-immune.** Requires a TS loader (tsx/ts-node) to import the TS schema.
Build a `Map<table, name>` first so FK targets resolve to table names. Suppress
`onDelete === "no action"` (it's the SQL default — noise). The schema module must have no
import-time side effects (no DB connect) — Drizzle table defs don't, so it's safe.

### Prisma — parse `schema.prisma`
No import needed. Parse `model X {\n ... \n}` blocks; each non-comment line is
`name type modifiers`. `@id` → PK, `@relation(fields: [...], references: [...])` → FK,
`?` suffix → nullable, `@default(...)` → default. A scoped block-by-block parser is robust
because `.prisma` syntax is regular.

### Raw SQL migrations — parse `CREATE TABLE`
When there's no ORM, parse the latest-state SQL (or fold all migrations): match
`CREATE TABLE (\w+) \(([\s\S]*?)\);`, split columns on top-level commas,
detect `PRIMARY KEY`, `REFERENCES table(col)`, `NOT NULL`, `DEFAULT`.

### TypeORM / Sequelize — entity decorators/models
Parse `@Entity`/`@Column`/`@ManyToOne` decorators (TypeORM) or `Model.init({...})`
(Sequelize). Decorator parsing is more fragile than Drizzle/Prisma introspection — wrap
defensively and prefer reading a generated schema dump if one exists.

<a name="modules"></a>
## Components / lib modules

Group top-level dirs under `src/components` and `src/lib`, with file counts. For single-file
lib modules, pull a one-line note from a **real JSDoc `/** */` header** only (first ~400 chars)
— never a stray `//` section comment, which reads as a misleading description.

<a name="flows"></a>
## Flows — the "why", auto-derived from JSDoc

A filesystem scan gives *shape* but not *intent* (why revenue uses `COALESCE(ship_date,
scheduled_ship_date)`, why a parent distributor is re-attributed by region). That intent already
lives in the codebase as **top-of-file JSDoc headers** — and crucially, the **coding agent**
writes and updates them next to the code (so it survives "I never write comments" / vibe-coding).
`flows.md` is built by quoting those headers verbatim.

How it works (`collectFlows` + `renderFlows` in the template):
- Walk a set of flow dirs (`src/lib`, `src/app/api`). For each `.ts`/`.tsx`, extract the **first
  `/** … */` block** if it sits near the top of the file (within ~1500 chars → a file header, not
  a function doc). Strip `*` prefixes and `@tags`.
- Include only **substantial** headers (≥4 non-empty lines) so utility one-liners don't flood it.
- First line → section title; the rest → body, quoted as-is.
- **`FLOW_EXCLUDE`** (regex) drops scoped scratch/discovery areas whose headers are real but
  aren't live flows (probes, fixtures, `*.test`, `__mocks__`, generated). Tune per repo — this is
  the main knob for signal-vs-noise.

Why auto-derive beats the two alternatives:
- vs **hand-written `flows.md`**: a hand file that nobody maintains rots into confidently-wrong
  docs — worse than nothing. Auto-derive needs zero hand-maintenance.
- vs **LLM-generated narrative**: an LLM *generates* fresh prose and can fabricate/drift; quoting
  *copies* prose a human/agent already wrote and can only ever be as wrong as the source comment
  (a visible, code-reviewed artifact). Auto-derive preserves the "can't hallucinate" guarantee.

The one dependency: headers must stay accurate. Enforce with an **AGENTS.md header-freshness
rule** (see `hook-and-wiring.md`): when you change a module's behavior, update its header in the
same edit. The header is co-located with the code, so this is low-friction. If a repo genuinely
has no headers and won't grow them, **drop `flows.md`** — agents read the structural maps + open
source for the "why" — rather than ship an empty or LLM-faked one.

<a name="env"></a>
## Env vars

**Zod schema** (template default): locate the `serverEnvSchema = z.object({ ... })` /
`clientEnvSchema` blocks by brace-matching, then per `KEY: z.<chain>` decide required
(`!optional && !default`), capture `.default(...)`. Slice key-to-next-key so multi-line chains
are captured whole.

**No Zod**: parse `.env.example` — every `KEY=` line is a var; a value after `=` is a sample/
default; required-ness usually isn't encoded (mark all "see .env.example").

<a name="misc"></a>
## Specs / migrations / integrations

- **Specs**: if the repo has `specs/*/STATUS.md`, link each and extract a status — first
  `**bold**` phrase, else `see file`. Always link the real file as authoritative; never assert
  a status the file doesn't state. Delete this scanner if there's no `specs/` convention.
- **Migrations**: list the migration filenames from the ORM's dir (`drizzle/`,
  `prisma/migrations/`, `db/migrate/`).
- **Integrations**: a small **presence-checked static list** — `{ name, via (a path), envKeys }`
  filtered by `existsSync`. Edit the `INTEGRATIONS` const to match the repo (Stripe, S3, Redis,
  an LLM provider, etc.). Presence-checking keeps it honest.

<a name="plain-node"></a>
## Non-TypeScript-loader projects (plain node `.mjs` + regex)

If the repo has **no** `tsx`/`ts-node` and you don't want to add one, write the generator as
plain `.mjs` run with `node scripts/codemaps/generate.mjs`. You then CANNOT import a TS schema
module, so introspect the schema by **regex** instead (Drizzle: match `pgTable("name", { ... }`,
brace-match the columns object, capture `^\s*(\w+)\s*:` names, and read `.references(() =>
table.col)` / `.notNull()` / `.primaryKey()` for FK/PK). Everything else (routes, components,
deps) is identical. The trade-off: regex captures less (often column names only) and is more
brittle than `getTableConfig` — acceptable only when adding a TS loader isn't wanted. For repos
that already run scripts through tsx/ts-node, prefer the TS template + `getTableConfig`.
