# Adapting the kit

What to change for another project, stack, deploy target, reviewer bot or harness. Everything project-specific lives in `agentkit.config.json` at the repository root, or in the `{{PLACEHOLDERS}}` that `init.mjs` fills once. The tools' code is meant to stay the same in every repository; where it doesn't, this says what to edit.

## agentkit.config.json

Read by `tools/guardrails/lib/config.mjs`: the file over the defaults, one section deep (`verify`, `reviewer`, `ci`, `deploy`, `build`; `deploy.fly` one level more), every other key replacing its default whole. Keys starting with `$` are comments. An unknown key is refused, so a typo can't pass for a setting.

- **Strict readers** stop on a broken file: `verify.mjs`, `merge-approved.mjs`, `deploy-approved.mjs`, `run-wave.mjs`, `tools/screens/capture.mjs`, and the spec checker (which reports it as a problem, so `npm run verify` and CI fail).
- **Lenient readers** are the hooks: on a broken file they use the defaults, so the rules that need no config still hold, and the session-start hook warns first thing. A broken config must never switch the guard off.

| Key | Default | Read by | What it does |
|---|---|---|---|
| `project` | the repository folder's name | run-wave (the brief), deploy-approved (temp folder name), screens (page title, `<project>-builds`) | The project's name. Set it: a build clone's folder name isn't the project's. |
| `owner` | `"the project owner"` | the guard's reasons | Who the agent leaves things to: "Fly secrets are managed by Alex". |
| `repo` | `null` | run-wave (required) | `owner/name` on GitHub, for every `gh` call the runner makes. `merge-approved.mjs` uses gh's `{owner}/{repo}` from the checkout instead. |
| `defaultBranch` | `"main"` | the guard and session-start (release branches, with `main` and `master`), ci.mjs, deploy-approved, run-wave | The branch PRs merge into and deploys come from. |
| `lockfile` | `"package-lock.json"` | spec-check | A task listing a `package.json` must list this too. `null` turns the rule off. |
| `verify.command` | `null` | verify.mjs | The verification command as a list of words. `null`: `npm run verify` when `package.json` has it, else `npx tsc --noEmit -p .`. |
| `protectedPaths` | `[]` | the guard, session-start | `[{ path, reason? }]`: paths no agent writes, ever. A folder ends with `/`. Matched case-insensitively from the repository root. |
| `deniedCommands` | `[]` | the guard | `[{ command, reason? }]`: a program and the operands it starts with (`"eve deploy"` denies `npx eve deploy --prod`, not `eve dev`). Options between the program and its operands may hide one: there's no per-program list of options that take values. |
| `reviewer.login` | `null` | merge-approved, run-wave (both require it) | The bot's GitHub login; `[bot]` is ignored on either side. |
| `reviewer.name` | `"the reviewer bot"` | run-wave (brief, log, nudges) | How the bot is named in prose. |
| `reviewer.trigger` | `"/review"` | run-wave (a comment line that is exactly this asks for a review), merge-approved's messages | What a comment says to ask for a review. |
| `ci.workflowFile` | `".github/workflows/verify.yml"` | ci.mjs | Once the default branch has this file, its jobs are required. |
| `ci.requiredJobs` | `[{ "workflow": "verify", "job": "verify" }]` | merge-approved, run-wave | Workflow-and-job pairs that must succeed on the head; skipped doesn't count. GitHub names a check run after its job id. |
| `deploy.adapter` | `"none"` | deploy-approved | `"none"` (prints "Nothing to deploy") or `"fly"`. |
| `deploy.healthUrl` | `null` | deploy-approved | Polled for a 200 for two minutes after a deploy. Required with a target: the rollback depends on it. |
| `deploy.notShipped` | `docs/`, `specs/`, `tools/`, `.claude/`, `.github/`, `.opencode/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `agentkit.config.json` | deploy-approved | Paths that never change what runs. If only these changed since the live release's commit, nothing deploys. An unlisted folder costs at most an unneeded deploy. |
| `deploy.fly.app` | `null` | the Fly adapter | The Fly app. Required with `"fly"`. |
| `builders` | `{}` | run-wave | `{ name: { harness, model, label?, effort?, budgetUsd? } }`. `harness` is `opencode` or `claude`; `model` is the id in that CLI's own form, pinned; `budgetUsd` is a Claude Code wave's cap ($10 when absent). |
| `build.install` | `null` | run-wave | The install a clone gets, as a list of words. `null`: `npm ci --no-audit --no-fund` when there's a `package-lock.json`, else none. |
| `build.installEnv` | `{}` | run-wave | Extra environment for the install, such as `{ "npm_config_userconfig": "/dev/null" }` where a global npmrc breaks installs. |
| `build.longCommands` | `[]` | run-wave's watchdog | The project's commands that may run 30 minutes instead of 10 (`"eve build"`, `"expo export"`), matched as whole words anywhere in the command line. |
| `screens` | `null` | tools/screens | The optional screen check's settings; see [screen-check.md](screen-check.md). |

### A fresh project, in short (init writes every key; these are the ones that matter)

```json
{
  "project": "acme",
  "owner": "Alex",
  "repo": "acme-org/acme",
  "defaultBranch": "main",
  "reviewer": { "login": "acme-review-bot", "name": "the review bot", "trigger": "/review" },
  "deploy": { "adapter": "none" },
  "builders": {
    "glm": { "harness": "opencode", "model": "zai-coding-plan/glm-5.3#max", "label": "GLM 5.3 (max)" },
    "sonnet": { "harness": "claude", "model": "claude-sonnet-5-5", "effort": "high", "label": "Sonnet 5.5 (high)", "budgetUsd": 10 }
  }
}
```

### A worked example, written as config

```json
{
  "project": "acme",
  "owner": "Alex",
  "repo": "acme-co/acme",
  "protectedPaths": [
    { "path": "design/screens/", "reason": "design/screens/ holds the frozen, approved designs, and coding agents never change them. Build from them; if a screen looks wrong, stop and write BLOCKED.md." }
  ],
  "deniedCommands": [{ "command": "eve deploy", "reason": "Deploy with node tools/guardrails/deploy-approved.mjs." }],
  "reviewer": { "login": "acme-review-bot", "name": "Muse", "trigger": "/muse" },
  "ci": { "requiredJobs": [{ "workflow": "verify", "job": "verify" }, { "workflow": "verify", "job": "image" }] },
  "deploy": {
    "adapter": "fly",
    "healthUrl": "https://acme.fly.dev/health",
    "notShipped": ["docs/", "design/", "specs/", "tools/", "scripts/", "site/", ".claude/", ".github/", ".opencode/", "AGENTS.md", "CLAUDE.md", "DESIGN.md", "README.md", "agentkit.config.json"],
    "fly": { "app": "acme" }
  },
  "builders": {
    "glm": { "harness": "opencode", "model": "zai-coding-plan/glm-5.3#max", "label": "GLM 5.3 (max)" },
    "sonnet": { "harness": "claude", "model": "claude-sonnet-5-5", "effort": "high", "label": "Sonnet 5.5 (high)", "budgetUsd": 10 }
  },
  "build": { "installEnv": { "npm_config_userconfig": "/dev/null" }, "longCommands": ["eve build", "expo export"] },
  "screens": { "appId": "com.acme.app", "linkScheme": "acme", "avd": "acme-pixel8-api35", "idsFile": "apps/mobile/src/dev/gallery/ids.json", "comparedWith": { "S03-thread-login": "S03-thread" } }
}
```

(`site/` is in `notShipped` because the marketing site deploys elsewhere; `design/` and `scripts/` because nothing in the image reads them.)

## The placeholders

`init.mjs` fills these in every `*.tmpl` file it copies, and drops the suffix: `AGENTS.md`, `specs/README.md`, the `docs/` skeletons and the first decision record, the ZCode plugin manifests and marketplace.

| Placeholder | From | Default |
|---|---|---|
| `{{PROJECT}}` | `--project` | the target folder's name |
| `{{OWNER}}` | `--owner` | `git config user.name` |
| `{{REPO}}` | `--repo` | parsed from origin's GitHub URL |
| `{{DEFAULT_BRANCH}}` | `--default-branch` | origin/HEAD's branch, else the current branch, else `main` |
| `{{REVIEWER_LOGIN}}` | `--reviewer-login` | none: set it before the first merge |
| `{{REVIEWER_NAME}}` | `--reviewer-name` | `the reviewer bot` |
| `{{REVIEWER_TRIGGER}}` | `--reviewer-trigger` | `/review` |
| `{{DATE}}` | the day init runs | |

On a terminal it prompts for missing values unless `--yes`. It refuses, writing nothing, when any kit file already exists, unless `--force`; `.gitignore`, `CLAUDE.md`, `package.json` and `.claude/settings.json` are merged additively (it only adds lines, keys and the three hooks, never changes what's there), so a second run (with `--force`) adds nothing to them. `--dry-run` prints the plan. The placeholders are filled once: after init, the config is the source of truth, and prose that names the bot or the branch is edited by hand if they change.

## Another stack

- **Verification.** Point `verify.command` at the project's own check (`["make", "verify"]`, `["pnpm", "verify"]`), or keep `npm run verify`. Whatever it is must run the project's typecheck, lint and tests **and** `node tools/spec-check/check.mjs` and the tools' tests (`test:tools`), because CI and the stamp rely on one command meaning "everything".
- **CI.** Edit `.github/workflows/verify.yml` to install the stack and run that command; keep the workflow and job names in `ci.requiredJobs` in step. Keep `concurrency` with `cancel-in-progress`, since superseded runs burn minutes. Add jobs (an image build, a smoke test) and list the ones a merge must wait for.
- **The lockfile.** Set `lockfile` (`pnpm-lock.yaml`, `yarn.lock`) or `null` for a stack without one.
- **The wave's install.** Set `build.install` (`["pnpm", "install", "--frozen-lockfile"]`, `["uv", "sync"]`) and `build.installEnv`.
- **Slow commands.** List them in `build.longCommands` (`"cargo build"`, `"gradle assembleRelease"`), or the watchdog stops them after 10 minutes.
- **Lint and formatting.** The kit adds none. Whatever the project uses (Biome, ESLint, Ruff) goes in its verify command. Keep the tools' `.mjs` files out of a strict formatter or linter scope, or adopt its rules for them deliberately; their style is long lines and plain comments.
- **The tools need Node 24 and git** whatever the product's stack is.
- **The guard's dependency rule is npm's.** `npm install <pkg>` needs the `package.json` it changes in the task's lists; `pnpm add` or `cargo add` aren't checked. The spec gate (the diff against the task's lists) still catches the changed manifest.

## Another deploy target

The deploy is an adapter. `deploy-approved.mjs` does the target-independent work: read the config, fetch the default branch, export its committed tree with `git archive`, skip when nothing that ships changed since the live release's commit, tag the release with `imageLabel` (`<branch>-<40-hex sha>-<yyyymmdd-hhmmss>`), poll `deploy.healthUrl`, and roll back to what was live, with the settings of the commit that release names.

An adapter is a module exporting a function `(config, run) => adapter`, where `run(command, args)` returns stdout and throws on failure, and `adapter` has six members:

| Member | Returns | Contract |
|---|---|---|
| `target` | text | How messages name the target: "the Fly app acme". |
| `live()` | text | What runs now (an image ref, a release id). Throw when it can't be read or differs between machines: without it there's no rollback, so nothing deploys. |
| `commitOf(live)` | sha or `null` | The commit a release names; `commitOfImage` from `lib/deploy.mjs` reads `imageLabel` tags. `null` means "deploy anyway, roll back with the default branch's settings". |
| `build(source, label)` | boolean | `--dry-run`: build the exported tree at `source` on the target's builder, without releasing. |
| `release(source, label)` | boolean | Build and release `source`, tagged `label`. Work only from `source`, never the checkout, so nothing unmerged or untracked ships. |
| `rollback(before, source)` | boolean | Release `before` again, with the settings files from `source` (the export of the commit `before` names, or of the default branch). |

To add one:

1. Write `tools/guardrails/lib/deploy-<name>.mjs` in the shape of `lib/deploy-fly.mjs`. Keep its decisions pure and exported (Fly's is `liveImage`, which reads `flyctl image show --json`), and test them in `test/deploy.test.mjs`; the side effects stay thin.
2. Add one line to `ADAPTERS` in `deploy-approved.mjs`.
3. Add its name to `ADAPTERS` in `lib/config.mjs`, and a check of its settings in `deployProblems` (as `deploy.fly.app` is checked). Its settings go under `deploy.<name>`.
4. Deny the target's own deploy command in `deniedCommands` (`"vercel deploy"`, `"wrangler deploy"`), so agents can't go around the script.

**A sketch, not shipped,** for a target driven by the project's own scripts (a container registry plus a host, a Coolify or Vercel project). It shows the shape only; nothing in the kit implements or tests it:

```js
// tools/guardrails/lib/deploy-script.mjs — guidance only.
import { spawnSync } from "node:child_process";
import { commitOfImage } from "./deploy.mjs";

export function scriptAdapter(config, run) {
  const step = (script, source, args) => spawnSync(script, args, { cwd: source, stdio: "inherit" }).status === 0;
  return {
    target: `the ${config.project} service`,
    live: () => run("scripts/deploy/live-tag.sh", []), // prints the tag of what runs; fails when it can't tell
    commitOf: commitOfImage,
    build: (source, label) => step("./scripts/deploy/build.sh", source, [label]),
    release: (source, label) => step("./scripts/deploy/release.sh", source, [label]),
    rollback: (before, source) => step("./scripts/deploy/release-existing.sh", source, [before]),
  };
}
```

The guard's Fly rules (a read-only allow-list for `fly`) stay on whatever the target; on a project without Fly they cost nothing.

## Another reviewer bot

Set `reviewer.login`, `reviewer.name` and `reviewer.trigger`, and confirm on a probe pull request what the bot actually does, because `merge-approved.mjs` and the runner assume:

- it submits GitHub reviews, and its **latest** review's state is `APPROVED` for the PR's **current head commit** when it's satisfied;
- it approves only once its comments have answers, so the approval stands for "every comment answered" (merge-approved doesn't check threads);
- a comment whose line is exactly the trigger asks it to review the latest commit.

Examples, to check rather than trust:

- **CodeRabbit:** login `coderabbitai` (the `[bot]` suffix is ignored), trigger `@coderabbitai review`. Check that it submits APPROVED reviews at all; it may need its request-changes workflow turned on, and a bot whose reviews are only ever COMMENTED never lets anything merge.
- **Codex (the `chatgpt-codex-connector` app):** trigger `@codex review`. Its clean result is a thumbs-up or a "no new findings" response rather than an APPROVED review ([review-loops.md](review-loops.md#when-codex-is-the-pr-reviewer-bot)), so merge-approved's check doesn't fit it. Either keep a reviewing bot that approves, or extend `lib/merge.mjs` with that signal (a code change, with tests in `merge.test.mjs` and `github.test.mjs`).
- **A human reviewer** works too: their login, their name, and a trigger they watch for.

Whatever the bot, a review by a different model family than the builders is the point; a bot running the builder's own model shares its blind spots.

## Another harness

- **Claude Code:** `.claude/settings.json` runs the three hooks through `$CLAUDE_PROJECT_DIR`. Don't also install the plugin, or every hook runs twice.
- **OpenCode 2:** `.opencode/plugins/guardrails.js` loads from the checkout it runs in and runs the same guard before each tool call, failing closed. No stop or session-start hook: `run-wave.mjs` does their job in wave runs. Recheck after an OpenCode upgrade (ask a session to write into a protected path; it must be refused).
- **ZCode:** it runs plugin-level hooks only, not project-level ones. Add the marketplace (Settings → Plugin Management → Discover → `+`) pointing at the repository's `tools/` folder, install `guardrails`, and start a new session (plugins don't hot-reload). Check it by asking the agent to read `.env`.
- **Harnesses without hooks** (others that read `AGENTS.md`): they get the contract and nothing enforcing it while they work. The backstops are the spec checker, the runner's whole-branch file-list check, CI, the reviewer bot and the lead's audit. Don't run them unattended.
- **As a wave builder,** `run-wave.mjs` knows two harnesses, `opencode` and `claude`. Another needs a branch in `builderCommand` (`lib/builders.mjs`), reading its output for a session id and a cost, a proof that its guard is on before it works, and tests like `run.test.mjs`'s stand-ins.

## What was generalized, and how

| In the source project | In the kit |
|---|---|
| the project's name in the brief, plugin manifests, temp folders | `project`, `{{PROJECT}}` |
| the owner's name in the guard's reasons and the contract | `owner`, `{{OWNER}}` |
| the repository's name in the runner's `gh` calls | `repo`, `{{REPO}}` |
| `main` in fetches, checkouts, the brief, image tags | `defaultBranch` (main and master stay release branches) |
| `design/screens/` write-protected | `protectedPaths` |
| `eve deploy` denied | `deniedCommands` |
| the reviewer bot's login, "Muse", `/muse` | `reviewer.login`, `.name`, `.trigger`, `{{REVIEWER_*}}` |
| required jobs `verify` and `image` | `ci.workflowFile`, `ci.requiredJobs` |
| Fly app, health URL and `NOT_SHIPPED` hard-coded in `deploy-approved.mjs` | the adapter (`lib/deploy.mjs` + `lib/deploy-fly.mjs`), `deploy.*` |
| "Fly secrets" in the `.env` reason | "the deploy platform's secret store" |
| GLM and Sonnet constants, `--builder glm|sonnet`, $10 | `builders`, any name, any of two harnesses |
| `npm ci` with `npm_config_userconfig=/dev/null` | `build.install`, `build.installEnv` |
| `eve build`, `expo export` as long commands | `build.longCommands` |
| the `package-lock.json` pairing rule | `lockfile` |
| `npm run verify`, else `tsc` | `verify.command` first |
| plugin id `<project>-guardrails` | `agentkit-guardrails` |
| the screen tool's app id, schemes, AVD, paths | the `screens` section |

## What isn't generalized

- **The builds folder.** `run-wave.mjs` puts clones in `<repository folder>-builds/` beside the repository; `tools/screens` writes to `<project>-builds/`. Name the main checkout's folder after `project` and they agree.
- **The screen check is Expo on Android:** Metro, the Expo dev client's link and flags, adb and demo mode. Another stack replaces `lib/device.mjs` and the Metro step.
- **The guard's built-in rules** include Fly's allow-list, `eas submit`, `npm publish`, `stripe --live` and live Stripe keys, always on. They're harmless where unused; extend them through `deniedCommands`, not by editing the rules, unless a rule needs real parsing.
- **GitHub only:** `gh`, Actions check runs, PR reviews, `--match-head-commit`.
- **The watchdog reads `ps -A -o pid=,ppid=,etime=,command=`**, checked on macOS; it stops itself at start if it can't read its own line.
- **Process steps have no tooling:** the adversarial spec review, the lead's audit, the pre-approval records. They live in the contract and these references.
- **`AGENTS.md`'s engineering rules and gotchas** are the project's to write; the template leaves marked places for them.
