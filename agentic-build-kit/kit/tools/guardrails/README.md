# Guardrails

Hooks that hold coding agents to [AGENTS.md](../../AGENTS.md). They are gate G0 in [specs/README.md](../../specs/README.md): a pre-tool hook that enforces the task file list and the forbidden commands, and a stop hook that refuses unverified work. Claude Code runs them from `.claude/settings.json`; ZCode runs them as a plugin; OpenCode runs the guard through `.opencode/plugins/guardrails.js`. Harnesses without hooks rely on the wave-overlap checker and review.

Node 24 and git on the `PATH`. No dependencies. What differs between projects comes from `agentkit.config.json` at the repository root (see Configuration).

## What they enforce

### Before each tool call: `hooks/guard.mjs` (PreToolUse)

Always, with or without a task:

- **Secrets:** no Read, Grep (by path or glob), Write or Edit of `.env*` files anywhere. No shell command that reads, copies, sources or redirects one (`cat`, `grep`, `head`, `sed`, `cp`, `source`, `.`, `<`, `>`, `>>` and similar). No `printenv` or bare `env`. `node --env-file=.env.local …` stays allowed, because it loads the values without printing them. No command containing `sk_live_` or `rk_live_`.
- **Protected paths:** no writes into `.git/`, into lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`; npm itself still updates them) or into a path `agentkit.config.json`'s `protectedPaths` lists, such as a folder of frozen, approved designs. A folder ends with `/`; an entry's `reason`, or a default that names the config, is what the agent is told.
- **Commands reserved for the owner:** anything `deniedCommands` lists, by program and leading operands: `{ "command": "eve deploy" }` denies `npx eve deploy --prod` and leaves `eve dev` alone. Options before the operands aren't skipped, so list the form agents type.
- **Deploys and Fly:**
  - No `fly`/`flyctl` `deploy`: deploy through `deploy-approved.mjs` (see Deploying). No `npm run deploy`.
  - No `secrets set|unset|import`, and no destroying apps, volumes or machines.
  - Everything else on Fly is an allow-list that names each command's subcommands, so `releases rollback`, `version upgrade` or a subcommand flyctl adds later stays denied. Agents may read state and restart or start machines:
    - no subcommand: `status`, `logs`, `releases`, `doctor`, `version`;
    - `platform regions|vm-sizes|status`, `image show`, `scale show`, `config show|validate`, `auth whoami`;
    - `list` (and `show` where it exists) for `apps`, `volumes`, `ips`, `certs`, `checks`, `secrets` and `machine`, in their singular spellings too (`app`, `vol`, `cert`…);
    - `machine restart|start|status`, `apps restart`.
  - Any other `fly` command is denied, including `machine stop|update|run|exec`, `scale count`, `ssh`, `console`, `proxy`, `ips release`, `certs add`, `volumes create`, `storage create` and `auth token`. `--help` always works.
  - The Fly rules hold whatever the deploy target: on a project that doesn't deploy to Fly they cost nothing.
- **Git:** no force push (`--force`, `-f`, `--force-with-lease`, `+refspec`). No push that names a release branch (`main`, `master` and the config's `defaultBranch`), uses `--all` or `--mirror`, or starts from one. No `reset --hard`, `rebase`, `filter-branch`, `filter-repo`, BFG or `commit --amend`. No `--no-verify`, `commit -n` or `-c core.hooksPath=…`. No `git clean -x`, which would delete `.env.local` and the local database.
- **GitHub:** no direct merges. Merge through `merge-approved.mjs` (see Merging). The guard denies:
  - `gh pr merge`;
  - a `gh api` write to `…/pulls/<n>/merge` (a pull request) or `…/merges` (one branch into another);
  - the GraphQL mutations `mergePullRequest`, `enablePullRequestAutoMerge` and `mergeBranch`;
  - a GraphQL call whose query it can't read: `--input` (stdin or a file), `-F query=@file`, or a query built by the shell (`$(…)`, `$VAR`). Other fields are variables, so `-F name=$VALUE` stays allowed.
  - Endpoints match in any spelling: `graphql`, `/graphql`, a full URL, any case, a PR number from a variable.

  No `gh alias set` or `gh alias import`, because an alias hides the command it runs. No `gh repo delete`.
- **Processes:** no `pkill`, `killall`, `kill -1`, `fuser -k`, and no `kill` fed by `lsof`, `pgrep`, `pidof` or `ps` (through a pipe, `xargs` or `$(…)`). Stop a server by its PID.
- **Other:** no `sudo`. No `rm -r` of `/`, `~`, `$HOME`, `.`, `..`, `*`, the repository root or a folder above it. No `stripe … --live`, `npm publish` or `eas submit`.

While a task is active (see the marker below):

- **File lists:** writes go only to the paths in the task's `## Files to Modify` and `## Files to Create`. That covers the Write, Edit, MultiEdit and NotebookEdit tools and shell writes: `>`, `>>`, `tee`, `sed -i`, `cp` and `mv` (`mv` also removes its source), `rm`, `touch`, `git rm` and `git mv`.
  - Only backticked strings that look like paths count. A path ending in `/` allows everything under it, and globs such as `apps/agent/**/*.ts` work.
  - The task file, its spec's `README.md` and `BLOCKED.md`, `specs/LEDGER.md`, `specs/.current-task` and `specs/.verified` are always allowed.
- **Tests are the contract:** a `*.test.*` or `*.spec.*` file must be listed by its path or a glob. A listed folder doesn't cover tests.
- **Dependencies:** `npm install <package>` and `npm uninstall <package>` need the `package.json` they change in the lists: the nearest one above the command's folder, or the workspace's with `-w`. `-w` takes a workspace's package name (`@acme/agent`, read from the root `package.json`'s `workspaces`) or its folder (`apps/agent`), as npm does. A name with a trailing slash is refused, since no package name has one. Plain `npm install` and `npm ci` are fine.
- **Not limited:** reads, paths outside the repository and gitignored paths. The last two never reach a commit.
- **Which repository:** a write is checked against the task of the repository it lands in, wherever the session's directory is.

The guard reads shell commands the way the shell does: quotes, `&&`, `;`, `|`, subshells, `$(…)`, backticks, heredocs, comments, leading `VAR=value`, `cd`, and wrappers such as `env`, `nohup`, `timeout`, `xargs`, `npx`, `npm exec`, `sh -c` and `eval`. Text inside a heredoc or a quoted commit message is not a command.

When the guard has no objection it prints nothing, so the normal permission prompts still apply. It never answers "allow". If it hits an unexpected error, it lets the call through and writes a note to stderr.

### Before a session ends: `hooks/stop-verify.mjs` (Stop)

With an active task, a session can end only when one of these holds:

- the task's spec folder has a `BLOCKED.md`, or
- the task's `## Status` is `complete`, `git status` is clean, `specs/.verified` matches `HEAD^{tree}`, and the branch has an upstream it isn't ahead of.

Otherwise the hook keeps the session going and names the next step. It checks the session's repository, or `$CLAUDE_PROJECT_DIR` when the session has moved somewhere without an active task. After 10 blocks in a row it lets the session end and warns on stderr, so a hook problem can't trap an agent. The count lives in `specs/.stop-blocks` and resets whenever the hook lets a session end. Claude Code also caps consecutive stop-hook continuations on its own.

### At session start: `hooks/session-start.mjs` (SessionStart)

Adds the branch (with a warning on a release branch), the last 5 commits, `git status --short`, the last 8 lines of `specs/LEDGER.md`, any `specs/*/BLOCKED.md`, and the active task's path and first 40 lines. A broken `agentkit.config.json` comes first, as a warning: the guard is then on its defaults. It stays under 4,000 characters and runs again after `/clear` and compaction.

## The marker and the stamp

`specs/.current-task`, `specs/.verified` and `specs/.stop-blocks` are local state and must be gitignored.

- **Start a task:** write its path into the marker, for example `echo specs/01-repo-harness/tasks/task-03-logger.md > specs/.current-task`.
- **No task:** an empty or missing marker means no task is active. Clear it for any work outside the spec loop. While a task is active, even an interactive session can't end until the task is complete or blocked.
- **Finish a task:** set its Status to `complete`, tick its box in the spec README and add the ledger row. Then run `node tools/guardrails/verify.mjs`, commit everything in one commit and push.

`verify.mjs` runs `agentkit.config.json`'s `verify.command` when it names one, else `npm run verify` when `package.json` has that script, and `npx tsc --noEmit -p .` until then. It streams the output and exits with the command's code. It reads the config strictly: a broken file fails verification.

- **On success:** it writes `specs/.verified` as `{ tree, command, at }`. `tree` is the git tree hash of the working tree, built in a scratch copy of the index (`git add -A` and `git write-tree` with `GIT_INDEX_FILE`). The real index is untouched, and ignored files are left out. Once exactly that state is committed, `tree` equals `HEAD^{tree}`.
- **On failure:** a failing run removes the stamp. A run during which files change writes no stamp.

## Merging

`node tools/guardrails/merge-approved.mjs <number>` merges a pull request only when:
- the latest review from the reviewer bot (`reviewer.login`) approves the PR's current head commit;
- every CI check on that commit has passed (or was skipped). Once the default branch has the CI workflow (`ci.workflowFile`), its required jobs (`ci.requiredJobs`, the `verify` job by default) must be among them and must have succeeded; skipped doesn't count for them (`lib/ci.mjs`). Without branch protection or rulesets, this script is what enforces CI;
- GitHub sees the PR as open and mergeable.

 It makes a merge commit and passes the approved commit to GitHub (`--match-head-commit`), so a push between the check and the merge fails the merge. The decision is in `lib/merge.mjs`, covered by `test/merge.test.mjs`.

It doesn't check comment threads. The reviewer it was built for files review-level comments and approves only once it's satisfied, and AGENTS.md asks agents to answer every comment before asking for a new review. So the approval stands for "every comment has an answer". That depends on how the reviewer behaves, and the reviewer runs outside this repo. With a bot that approves while threads stay open, or never approves at all, this needs a real check.

## Deploying

`node tools/guardrails/deploy-approved.mjs` deploys `origin/<defaultBranch>` to the target `agentkit.config.json` names (`deploy.adapter`). Run it after every merge; `--help` prints its usage. With `"none"` it prints `Nothing to deploy` and exits 0. Fly (`"fly"`, `lib/deploy-fly.mjs`) is the worked example.

1. It reads the config strictly, fetches the default branch and asks the adapter what runs now. If it can't read that, it stops, because a rollback wouldn't be possible.
2. When the live release names its commit and nothing that ships changed between it and the default branch, it prints `Nothing to deploy` and stops. What doesn't ship is `deploy.notShipped`: `docs/`, `specs/`, `tools/`, `.claude/`, `.github/`, `.opencode/`, the root `AGENTS.md`, `CLAUDE.md` and `README.md`, and the config itself, by default. Anything else counts as shipped, so an unlisted folder costs at most an unneeded deploy.
3. It exports the default branch's committed tree with `git archive` into a temporary folder and deploys from there. Nothing from the working directory ships: no unmerged commits, untracked files or `.env.local`.
4. The release is tagged `<branch>-<full sha>-<yyyymmdd-hhmmss>`, so what runs names the deployed commit.
5. Then the script polls `deploy.healthUrl` for up to two minutes.
6. If the release isn't healthy, it redeploys the previous release with the settings of the commit that release's tag names, and prints `Rolled back: …` if that one is healthy. A release tagged before this script names no commit, so it gets the default branch's settings. If those settings are what broke the release, the rollback inherits the problem: check the target rather than running the script again.

`--dry-run` stops after building the default branch on the target's builder, so the build can be checked without touching production.

The decisions (tags, the rollback's commit, what ships, health) are in `lib/deploy.mjs`, covered by `test/deploy.test.mjs`. An adapter is a module that returns `{ target, live(), commitOf(live), build(source, label), release(source, label), rollback(before, source) }` and gets one line in `deploy-approved.mjs`'s `ADAPTERS`.

**Fly:** it finds `flyctl` through `$FLYCTL`, the `PATH` or `~/.fly/bin/flyctl`, and uses the login `flyctl auth` already has. It reads the live image with `flyctl image show`, builds with `flyctl deploy --remote-only` (the dry run with `--build-only`), and rolls back with `flyctl deploy --image <previous>`. flyctl runs inside the export, with the export's `fly.toml` and `Dockerfile` named explicitly, so nothing resolves from the checkout. flyctl waits for `fly.toml`'s own health check before the script polls the public route. Set `deploy.fly.app` and `deploy.healthUrl`.

## Install

- **Claude Code:** nothing to install. `.claude/settings.json` runs the three hooks from this folder through `$CLAUDE_PROJECT_DIR`. Don't also install the plugin, or every hook runs twice.
- **OpenCode 2:** nothing to install. OpenCode loads `.opencode/plugins/guardrails.js` from the checkout it runs in. Before each tool call, the plugin translates the call into the guard's input (`lib/opencode.mjs`) and runs `hooks/guard.mjs`. A denial fails the call with the guard's reason. A guard that can't run, or that fails while checking (its `(no decision made)` note on stderr, which on Claude Code lets the call through), blocks the call. It checks the shell, read, grep, write, edit and apply_patch tools. It fails closed: a call it can't read (no tool id, no path, no command) and any tool it doesn't know, MCP tools and OpenCode's `execute` included, are blocked. Only the tools in `SAFE_TOOLS`, which change nothing, pass unchecked. `task` (subagents) and `question` stay blocked: nobody has yet shown that a subagent's tool calls reach the hook, and an unattended builder has nobody to answer a question. The stop and session-start hooks have no OpenCode equivalent: `tools/build/run-wave.mjs` does their job for wave runs. It uses OpenCode 2's `setup` and `tool.hook("execute.before", …)`, so recheck it after an OpenCode upgrade: ask a session to read `.env`, or to write under a protected path, which the guard must refuse.
- **ZCode:** add the marketplace in Settings → Plugin Management → Discover → `+`, pointing it at this repository's `tools/` folder (marketplace `<project>-tools`). Install `guardrails` and start a new session. To check that it works, ask the agent to read `.env`; the guard should deny it.

## Configuration

What the guardrails read from `agentkit.config.json` (`lib/config.mjs` has every key and its default):

| Key | Read by | What it does |
|---|---|---|
| `owner` | guard | named in the reasons for what only the owner does |
| `defaultBranch` | guard, session start, merge, deploy | a release branch beside `main` and `master`; what deploys |
| `protectedPaths` | guard, session start | paths no agent writes: `[{ "path": "design/screens/", "reason": "…" }]` |
| `deniedCommands` | guard | commands only the owner runs: `[{ "command": "eve deploy", "reason": "…" }]` |
| `verify.command` | `verify.mjs` | the verification command as a list of words, instead of `npm run verify` |
| `reviewer.login`, `reviewer.trigger` | `merge-approved.mjs` | whose approval counts, and what to comment for a new review |
| `ci.workflowFile`, `ci.requiredJobs` | `merge-approved.mjs` | the jobs a merge waits for once the default branch has the workflow |
| `deploy` | `deploy-approved.mjs` | `adapter` (`none` or `fly`), `healthUrl`, `notShipped`, `fly.app` |

The scripts read it strictly and stop on a broken file. The hooks read it leniently: a broken file gives the defaults, so the rules that need no config still hold, and session start says what's wrong.

## Test

```sh
node --test "tools/guardrails/test/*.test.mjs"
```

Keep the quotes. On Node 24, `node --test tools/guardrails/test/` tries to run the folder as a module and fails. The tests build throwaway git repositories in the system temp folder. `test/fixture.mjs` holds the shared helpers.

Quick checks from the repository root:

```sh
echo '{"tool_name":"Write","tool_input":{"file_path":".env"}}' | node tools/guardrails/hooks/guard.mjs
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | node tools/guardrails/hooks/guard.mjs
echo '{"hook_event_name":"SessionStart","source":"startup"}' | node tools/guardrails/hooks/session-start.mjs | head -c 600
```

## Limits

- Hooks are guardrails, not a sandbox. They catch the usual ways of doing a forbidden thing, not deliberate workarounds:
  - a script that writes files, pushes or merges on its own;
  - a direct HTTP call to GitHub's API (`curl` with a token), a shell alias or function, or a `gh api` endpoint built entirely by the shell;
  - an agent that clears `specs/.current-task` or writes `specs/.verified` by hand.
- The spec gate (`npm run verify` at HEAD, the checker, review) is the backstop for both.
- Only the Write, Edit, MultiEdit, NotebookEdit, Read, Grep and Bash tools are checked.

## Files

```
tools/.claude-plugin/marketplace.json   marketplace <project>-tools, listing this plugin
tools/guardrails/
  .claude-plugin/plugin.json            Claude Code manifest
  .zcode-plugin/plugin.json             ZCode manifest (same content)
  hooks/hooks.json                      plugin wiring (${CLAUDE_PLUGIN_ROOT})
  hooks/guard.mjs                       PreToolUse
  lib/opencode.mjs                      OpenCode's tool calls in the guard's input, for .opencode/plugins/guardrails.js
  hooks/stop-verify.mjs                 Stop
  hooks/session-start.mjs               SessionStart
  lib/                                  shell parsing, rules, task files, git and path helpers
  lib/config.mjs                        reads agentkit.config.json, strictly for scripts and leniently for hooks
  lib/deploy.mjs, lib/deploy-fly.mjs    the deploy's decisions, and the Fly adapter
  verify.mjs                            runs verification and writes the stamp
  merge-approved.mjs                    merges a pull request once the reviewer approves it and CI passes
  deploy-approved.mjs                   deploys the default branch and rolls back if it isn't healthy
  test/                                 node:test tests
```
