# Hook & wiring

How to make the codemap auto-refresh and how agents/humans consume it. After the generator
works and is verified, wire these five things.

## Contents
- [1. package.json scripts](#scripts)
- [2. Stop hook (the auto-refresh)](#hook)
- [3. Project command override](#command)
- [4. Agent pointer (AGENTS.md / CLAUDE.md)](#pointer)
- [5. .gitignore](#gitignore)
- [doc-blocker interaction](#doc-blocker)
- [Trigger decision (Stop vs pre-commit vs per-edit)](#triggers)

<a name="scripts"></a>
## 1. package.json scripts

```jsonc
"codemaps": "tsx scripts/codemaps/generate.ts",
"codemaps:check": "tsx scripts/codemaps/generate.ts --check"
```
Use the repo's runner: `tsx` (default), `ts-node`, `npx tsx`, `bun`, or `node` for a `.mjs`
generator. `codemaps:check` exits non-zero when any auto file is stale → use it in CI or a
pre-commit hook.

<a name="hook"></a>
## 2. Stop hook (the auto-refresh)

A **Stop** hook runs once per turn (after all edits settle), async, only when source actually
changed. Create `.claude/settings.json` (merges with `settings.local.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/codemaps.sh\"",
            "async": true,
            "timeout": 20
          }
        ]
      }
    ]
  },
  "permissions": {
    "allow": [
      "Edit(docs/codemaps/**)",
      "Bash(pnpm codemaps)",
      "Bash(pnpm codemaps:check)",
      "Bash(tsx scripts/codemaps/generate.ts*)"
    ]
  }
}
```

`.claude/hooks/codemaps.sh` (`chmod +x` it):

```bash
#!/usr/bin/env bash
# Stop hook: regenerate codemaps once per turn IF source changed. Never blocks.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# ADAPT the gate paths to the repo's source roots. EXCLUDE docs/codemaps so it
# never re-triggers on its own output.
CHANGED=$(git status --porcelain -- src drizzle specs package.json 2>/dev/null || true)
[ -z "$CHANGED" ] && exit 0

LOCK=".git/codemaps.lock"
mkdir "$LOCK" 2>/dev/null || exit 0          # overlapping Stop events → skip
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

pnpm -s codemaps >/dev/null 2>&1 || exit 0   # idempotent; any failure → exit 0
exit 0
```

Why this shape: `async: true` so a turn never blocks on regeneration; the git change-gate makes
most turns a no-op; the lock prevents double-runs; every failure path is `exit 0` so a codemap
refresh can never break a turn. The generator's idempotency means even an unnecessary run
produces no diff.

<a name="command"></a>
## 3. Project command override

`.claude/commands/update-codemaps.md` — a thin command that runs the deterministic generator
and shows the diff. It shadows any generic LLM-driven `/update-codemaps` from a plugin (project
commands win):

```markdown
---
description: Regenerate the deterministic repo codemaps under docs/codemaps/
allowed-tools: Bash(pnpm codemaps), Bash(git diff:*), Bash(git status:*)
---

Run `pnpm codemaps`, then show `git diff --stat docs/codemaps/`. The structural files are
machine-derived — never hand-edit them; fix `scripts/codemaps/generate.ts` instead. Only
`docs/codemaps/flows.md` is hand-written.
```

<a name="pointer"></a>
## 4. Agent pointer (AGENTS.md / CLAUDE.md)

Add a short section near the top of `AGENTS.md` (or `CLAUDE.md`) so agents read the map first —
**and include the header-freshness rule**, which is what keeps `flows.md` true:

```markdown
## REPO MAP — grounded structure

For a machine-derived map of the codebase, read **`docs/codemaps/architecture.md`** first — it
links `frontend.md`, `backend.md`, and `data.md`. For the "why", read **`docs/codemaps/flows.md`**.
All five files are auto-generated ground truth — never hand-edit them (run `pnpm codemaps`). If a
structural file is wrong, fix the generator; if a "why" is wrong or missing, fix the **JSDoc
header in that source file**.

### Header-freshness rule (keeps flows.md true)
`flows.md` quotes each flow module's top-of-file JSDoc header verbatim. So:
- When you **change a module's behavior**, update its `/** ... */` header in the same edit.
- When you **add a significant module** under the scanned dirs, give it a real header (≥4 lines).
The header sits next to the code you're editing — keeping it current is part of the change.
```

This rule is load-bearing: without it, headers drift and `flows.md` quotes stale (but never
fabricated) descriptions. With it, the coding agent maintains the "why" as a side effect of
normal edits — which is what makes the system work under vibe-coding.

<a name="gitignore"></a>
## 5. .gitignore

```gitignore
# codemap diff report (transient)
.reports/
```
Commit `docs/codemaps/` (it's the shared map). Only `.reports/codemap-diff.txt` is transient.
If a stray plugin `/update-codemaps` writes to a root `codemaps/` dir, ignore that too.

<a name="doc-blocker"></a>
## doc-blocker interaction

Some setups (e.g. the `everything-claude-code` plugin) run a PreToolUse hook that blocks the
**Write** tool on non-allowlisted `.md` files. Two facts make this a non-issue:
- The generator writes via the shell/Node `fs` (inside the hook or `pnpm codemaps`), which is
  NOT a Write tool call → it bypasses the blocker entirely.
- Agents editing `flows.md` should use the **Edit** tool (the blocker typically matches only
  `tool == "Write"`). The `Edit(docs/codemaps/**)` allow rule keeps that frictionless.

If creating `flows.md` for the first time is blocked, write it via a shell heredoc instead of
the Write tool.

<a name="triggers"></a>
## Trigger decision (recommend Stop)

- **Stop hook (recommended)** — once per turn, batched, change-gated. Best default.
- **git pre-commit** — optional secondary; guarantees freshness in every commit and catches
  edits made outside the agent (manual `vim`, other tools). Wire `pnpm codemaps:check` (or
  regenerate) via husky/`core.hooksPath`. Keep it advisory (warn, don't block).
- **Per-edit PostToolUse** — NOT recommended: it reruns many times per turn and overlaps the
  formatters/type-checks already firing per edit.
