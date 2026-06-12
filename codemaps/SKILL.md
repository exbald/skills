---
name: codemaps
description: Set up "codemaps" — a deterministic, auto-updating map of a whole repo (routes, API, data model with FK edges, components, env, specs) that agents read first as grounded ground truth so they never get confused or hallucinate structure. Use when the user asks to create/install codemaps, a "repo map", "codebase map", "project map", "the brain of the repo", "architecture docs that auto-update", "grounded project context for agents", or wants a hook that regenerates structure docs when code changes. Builds a project-tailored generator + Stop hook; works on any project (Next.js/Drizzle reference impl included, recipes for Prisma/SQL/Express/etc.).
---

# Codemaps

A codemaps system gives AI agents a **grounded, always-current map of the repo** so they stop
re-deriving structure (burning context) or guessing at routes/tables/services that don't exist.

**Core idea:** the map's structural facts are **derived mechanically from the real files** by a
fast deterministic generator (no LLM, no network) — they *cannot* hallucinate. A single
hand-written `flows.md` carries the "why". A Stop hook keeps it fresh on every change.

Output lives in `docs/codemaps/`:
- `architecture.md` — entry point: stack, counts, links, spec status (AUTO)
- `frontend.md` — pages/routes + component groups (AUTO)
- `backend.md` — server actions, API handlers + auth, lib modules, integrations (AUTO)
- `data.md` — DB tables with **FK edges + types**, migrations, env (AUTO)
- `flows.md` — the "why": key flows, business rules, per-screen intent (HAND-WRITTEN)

The four AUTO files are pure renders of a filesystem scan; the generator never touches
`flows.md`. This split is what keeps idempotency trivial (string compare) and truth grounded.

## Bundled resources

- `assets/generate.ts` — a complete, working reference generator (Next.js App Router + Drizzle).
  **Copy it to the target repo and adapt** the scanners + CONFIG block. Sections to change are
  marked `// ADAPT:`. Keep the core machinery and the invariants intact.
- `references/generator-patterns.md` — scanner recipes per stack (Next.js/Remix/SvelteKit/
  Express routes; Drizzle `getTableConfig` / Prisma / raw SQL schema; env; specs; the plain-node
  regex fallback) and the non-negotiable invariants. **Read before adapting scanners.**
- `references/hook-and-wiring.md` — the exact Stop-hook `settings.json` + `codemaps.sh`, the
  `/update-codemaps` command, the AGENTS.md pointer, `.gitignore`, and the doc-blocker note.
  **Read at the wiring step.**

## Workflow

Follow these steps in order. Act as the builder: scan the repo, adapt the template, verify
against reality, then wire the hook. Do NOT hand-write the structural files — the generator
produces them.

### 1. Inventory the repo
Determine what to map and how. Identify: framework + router (App/Pages Router, Remix, Express…),
ORM + schema location (Drizzle `schema.ts`, `schema.prisma`, SQL migrations), source roots
(`src/`? `app/`?), env mechanism (Zod schema vs `.env.example`), whether a `specs/*/STATUS.md`
convention exists, and the script runner (`tsx`/`ts-node`/`bun`/plain `node`). Read
`references/generator-patterns.md` for how each maps to a scanner.

### 2. Build the generator
Copy `assets/generate.ts` to `scripts/codemaps/generate.ts` (or `.mjs` for a plain-node repo —
see the fallback in the patterns ref). Adapt each `// ADAPT:` site: schema import path + ORM
introspection, source roots, auth probe, env path, the `INTEGRATIONS` list, migrations dir, and
the specs scanner (delete it if there's no specs convention). **Preserve the invariants**
(deterministic, idempotent write, fail-safe schema try/catch, never write `flows.md`).

### 3. Run and verify against reality
Add the `package.json` scripts, then `pnpm codemaps` (or the repo's runner). Verify the output
is TRUE:
- Spot-check counts/rows against `find`/`grep` (pages, API handlers, tables, FK edges).
- **Idempotency:** run it twice → `git status docs/codemaps` shows no modifications on the 2nd.
- **Source propagation:** make a throwaway schema/route change → confirm it appears in the map →
  revert.
- Run the repo's typecheck/lint on the new generator file; fix any errors.
Iterate on the scanners until the map matches the codebase exactly.

### 4. Seed flows.md (hand-written)
Write `docs/codemaps/flows.md` — the cross-cutting "why" a scan can't infer: key data flows,
business rules, auth lifecycle, and one line per main screen/surface. Ground it in real source
(read the relevant files; don't invent). Mark it clearly as hand-written with a `Last verified`
date. Keep it lean.

### 5. Wire the auto-refresh and consumption
From `references/hook-and-wiring.md`: create `.claude/settings.json` (Stop hook + allow rules)
and `.claude/hooks/codemaps.sh` (`chmod +x`, and ADAPT its git-status gate paths to the repo's
source roots), the `/update-codemaps` command, the AGENTS.md/CLAUDE.md pointer, and the
`.gitignore` entry.

### 6. Final verification
`pnpm codemaps:check` exits 0 (up to date). Simulate the hook: `bash .claude/hooks/codemaps.sh`
with a dirty source file regenerates; with only a `docs/codemaps` change it exits 0 (no regen).
Confirm the lock dir is cleaned up. Run the repo's full check (lint + typecheck) once more.

## Key invariants (never violate)
1. Structural files are machine-derived only — if one looks wrong, fix the generator, not the file.
2. Idempotent writes — no structural change means no write means no git churn.
3. The schema scan is fail-safe (try/catch leaves `data.md` untouched on parse failure).
4. The hook is async, change-gated, and never blocks a turn; every failure path exits 0.
5. Only `flows.md` is hand-written.
