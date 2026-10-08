# Where each tool keeps hooks, rules, skills, and MCP config

What `scripts/install.py` touches, and why each tool gets the hook it does. Checked against the versions listed on 2026-10-08.

| Tool (version) | Hook file | Events used | Context output | Rules file | Skills dir | MCP config |
|---|---|---|---|---|---|---|
| Claude Code | `~/.claude/settings.json` `hooks` | SessionStart, UserPromptSubmit, Stop | `hookSpecificOutput.additionalContext`; Stop `{"decision":"block"}` | `~/.claude/rules/shared-memory.md` | `~/.claude/skills` | `~/.claude.json` `mcpServers` (type http) |
| Codex 0.145 | `~/.codex/hooks.json` | SessionStart, UserPromptSubmit, Stop | same as Claude | `~/.codex/AGENTS.md` | `~/.agents/skills` | `~/.codex/config.toml` `[mcp_servers.x]` + `.http_headers` |
| Gemini CLI 0.29 | `~/.gemini/settings.json` `hooks` | SessionStart, BeforeAgent | `hookSpecificOutput.additionalContext` (JSON only; plain stdout never reaches the model) | `~/.gemini/GEMINI.md` | `~/.agents/skills` | `~/.gemini/settings.json` `mcpServers` (`httpUrl`) |
| ZCode | `~/.zcode/cli/config.json` `hooks.events` + `hooks.enabled: true` | SessionStart (also fires after compact), UserPromptSubmit, Stop | `hookSpecificOutput.additionalContext`; strict schema, extra keys fail | `~/.zcode/AGENTS.md` | `~/.agents/skills` | `~/.zcode/cli/config.json` `mcp.servers` (type remote) |
| Cursor 3.16 | none: imports `~/.claude/settings.json` hooks | (Claude's) | `mem.py` sees `cursor_version` in the payload and answers `additional_context` | Settings > Rules (UI only) | `~/.claude/skills`, `~/.agents/skills` | `~/.cursor/mcp.json` |
| OpenCode 1.18 | plugin `~/.config/opencode/plugin/shared-memory.ts` | `experimental.chat.system.transform`, `experimental.session.compacting` | pushes onto the system prompt | `~/.config/opencode/AGENTS.md` | `~/.agents/skills` | `~/.config/opencode/opencode.json` `mcp` (type remote) |
| Hermes 0.21 | `~/.hermes/config.yaml` `hooks.pre_llm_call` + `~/.hermes/shell-hooks-allowlist.json` | pre_llm_call, first turn only (`--once`) | `{"context": ...}` | `~/.hermes/SOUL.md` | `~/.hermes/skills` | `~/.hermes/config.yaml` `mcp_servers` |
| Cline 3.0 | `~/.cline/hooks/PreToolUse` (executable) | PreToolUse, first call per task (`--once`) | `{"contextModification": ...}` | `~/.cline/rules/` | `~/.agents/skills` | `~/.cline/data/settings/cline_mcp_settings.json` (type streamableHttp) |
| Antigravity CLI | `~/.gemini/config/hooks.json` | PreInvocation, every call (`--cached`, no refetch) | `{"injectSteps":[{"ephemeralMessage": ...}]}` | `~/.gemini/GEMINI.md` | `~/.gemini/config/skills` | `~/.gemini/config/mcp_config.json` (`serverUrl`) |

## Gotchas

- **Codex hooks need trust.** Untrusted hooks never run. After installing, open `codex`, run `/hooks`, and trust the shared-memory ones. Trust is pinned to a hash in `config.toml` (`[hooks.state."<id>"] trusted_hash`), so editing the hook command means trusting it again.
- **Cursor runs Claude Code's hooks.** That's `thirdPartyExtensibilityEnabled`, on by default. Don't also write `~/.cursor/hooks.json`, or every hook fires twice.
- **Cline can't inject at task start.** Its TaskStart and UserPromptSubmit hooks run detached and their output is dropped, so the first PreToolUse is the earliest point where context lands. Its rules file covers turns before that.
- **Hermes asks before running a hook for the first time.** Non-interactive runs skip unapproved hooks. The installer writes the `{event, command}` approval itself instead of turning on `hooks_auto_accept`, which would approve every hook.
- **Gemini's PreCompress and Cursor's preCompact can't add context.** Claude Code and ZCode fire SessionStart again after compaction (matcher `compact`), which brings the memories back.
- **Stop nudge.** It only works where the payload includes `transcript_path` (Claude Code, Codex, ZCode). It blocks once after 10 or more tool calls with no `mem_add`/`mem_update`, then stays quiet for the next 10.

## Not covered by `install.py`

- claude.ai, the desktop app, and mobile: the MCP is a connector there, set up in claude.ai's settings.
- Remote agents (OpenClaw and Hermes on a server): run the installer on that box. Skills and hooks only cover their own machine.
