# Codemaps Skill

Set up a deterministic, auto-updating map of a whole repo — routes, API, data model (with FK edges), components, env, and specs — that AI agents read first as grounded ground truth, so they stop re-deriving structure or hallucinating routes/tables/services that don't exist. "The brain of the repo."

## Overview

This skill builds a project-tailored codemaps system in any repo:

- **Deterministic generator** — scans the real files (no LLM, no network) and renders structural maps that *cannot* hallucinate.
- **`docs/codemaps/`** output — `architecture.md` (entry point), `frontend.md`, `backend.md`, `data.md` (all auto-generated), plus a single hand-written `flows.md` for the "why".
- **Stop hook** — regenerates the map once per turn when source changes (async, change-gated, idempotent → no git churn).
- **Agent wiring** — `/update-codemaps` command, an `AGENTS.md`/`CLAUDE.md` pointer, and `.gitignore` entry.

Works on any stack: a complete Next.js App Router + Drizzle reference generator is included, with scanner recipes for Pages Router / Remix / SvelteKit / Express routes and Drizzle / Prisma / raw SQL / TypeORM schemas.

## Skill Structure

### SKILL.md

The 6-step workflow (inventory the repo → build the generator → verify against reality → seed `flows.md` → wire the hook → final verification) plus the non-negotiable invariants that keep the map grounded and idempotent.

### assets/

- `generate.ts` — a complete, working reference generator (Next.js App Router + Drizzle). Copy it into the target repo and adapt the scanners + `CONFIG` block; sections to change are marked `// ADAPT:`. Uses Drizzle `getTableConfig` for formatting-immune schema introspection (real FK edges + types).

### references/

- `generator-patterns.md` — scanner recipes per stack (routes, API + auth, server actions, DB schema across ORMs, env, specs) and the core invariants. Includes a plain-node `.mjs` + regex fallback for repos without a TypeScript loader.
- `hook-and-wiring.md` — the exact Stop-hook `settings.json` + `codemaps.sh`, the `/update-codemaps` command, the agent pointer, `.gitignore`, the doc-blocker interaction, and the trigger decision (Stop vs pre-commit vs per-edit).
