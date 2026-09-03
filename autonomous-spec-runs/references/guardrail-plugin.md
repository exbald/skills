# Guardrail plugin

Layout that works for both ZCode and Claude Code from one directory. Keep it inside the repo it guards, at `<repo>/tools/<plugin-name>/`, so it is versioned with the specs it enforces. Everything below is complete enough to rebuild from scratch; the only per-project work is editing the deny lists.

```
<repo>/tools/
├── .claude-plugin/marketplace.json      # the marketplace ZCode/Claude Code adds
└── <plugin-name>/
    ├── .zcode-plugin/plugin.json        # ZCode manifest
    ├── .claude-plugin/plugin.json       # same content, Claude Code manifest
    ├── commands/    bearings, next-task, verify, done, blocked, wave
    ├── agents/      task-executor, verifier (no write tools), reviewer (read-only)
    ├── skills/      the task loop, the repo's conventions, how to run a wave
    └── hooks/       hooks.json + guard.mjs, stop-verify.mjs, session-start.mjs
```

Manifest fields: `name`, `version`, `description`, `author`, then `commands`, `agents`, `skills`, `hooks` pointing at those directories.

## The marker file

`/next-task` writes the chosen task's repo-relative path into `specs/.current-task`, and `/done` empties it. That single line is how the PreToolUse hook knows which files are in bounds. Gitignore it, along with `specs/*/BLOCKED.md`.

## PreToolUse: guard.mjs

Reads the hook JSON on stdin (`tool_name`, `tool_input.file_path`, `tool_input.command`, `cwd`), replies with `permissionDecision` of `allow` or `deny` plus a reason. Three checks:

1. **Always denied paths**, whatever the task says: `.env*`, `.git/`, the lockfile, migration metadata.
2. **Task boundary.** Parse the current task's "Files to Modify" and "Files to Create" sections for backticked paths; deny writes outside that set. Always permit the task file itself, the spec README, `BLOCKED.md`, `progress_log.md` and the marker. Deny writes to any `*.test.*` file the task does not list, with a message saying tests are the contract.
3. **Forbidden commands** for `Bash`, and also for shell redirects, `tee` and `sed -i` targets parsed out of the command string, since agents reach for those when an editor tool is refused.

Command deny list worth having: `git push --force`, pushing `master`/`main`, `git reset --hard`, `git rebase`, `git filter-repo`/`bfg`, `rm -rf` of a root, `db:reset`/`db:push`/`drizzle-kit drop`, `curl` at deploy or payment APIs, `printenv`/`cat .env`, `npm`/`yarn`, `--no-verify`, `sudo`, and docker verbs (`rm`, `kill`, `stop`, `prune`, `exec`) aimed at anything but the project's own test containers.

Permit `git switch master` and `git merge --ff-only` if you want chained runs; keep pushing master denied, because that is the release gate.

## Stop: stop-verify.mjs

Refuses to end a turn while the current task is neither complete nor blocked. Reply `{"decision":"block","reason":"..."}` and the harness gives the model another turn. If the task says complete, additionally require its file and the ledger to be committed, so "complete" cannot mean "edited but uncommitted". Return `{}` when there is no current task, otherwise every ordinary conversation gets blocked.

## SessionStart: session-start.mjs

Returns `additionalContext` with branch, `git log`, `git status`, the ledger tail, any BLOCKED notes, and the head of the current task. Warn loudly when the branch is master. This is what makes a fresh context start from the ledger instead of from an assumption.

## Wave checker

A standalone script, run in CI and before every wave, that walks `specs/NN-*/tasks/*.md` and fails if any task lacks Status, Wave, a file list or Verification, or if two tasks in the same wave list the same file. Parse only backticked strings that look like paths, and accept root-level files like `README.md`, or it will miss real overlaps and invent fake ones.

## Testing hooks without a harness

They are plain scripts reading stdin, so exercise them directly:

```
echo '{"tool_name":"Write","tool_input":{"file_path":".env"}}' | node hooks/guard.mjs
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | node hooks/guard.mjs
echo '{}' | node hooks/session-start.mjs | head -c 400
```

Do this on the machine the agent will actually run on, not only where you wrote them.
