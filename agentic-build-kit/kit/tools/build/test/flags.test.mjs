import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { builderCommand } from "../lib/builders.mjs";
import { PR_FIELDS } from "../lib/github.mjs";
import { BUILDERS } from "./acme.mjs";

// Every flag the runner passes, checked against the builder CLI installed here: a renamed or dropped flag fails
// this test instead of a live wave. CI has neither CLI, so there it skips; the lead's machine runs it. The same
// goes for the fields the runner reads from gh. The flags don't depend on the model, so the test data's builders do.
function help(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000, env: { ...process.env, CLAUDECODE: "" } });
  return result.status === 0 ? `${result.stdout}${result.stderr}` : null;
}

const flagsOf = (builder) => builderCommand(BUILDERS[builder], { message: "m", session: "s", title: "t" }).args.filter((arg) => arg.startsWith("-"));

describe("the builders' flags, against the installed CLIs", () => {
  const opencode = help("opencode", ["run", "--help"]);
  it("opencode run knows every flag the runner gives an OpenCode builder", { skip: !opencode && "opencode isn't installed here" }, () => {
    for (const flag of flagsOf("glm")) assert.ok(opencode.includes(flag), `opencode run has no ${flag}`);
  });

  const claude = help("claude", ["--help"]);
  it("claude knows every flag the runner gives a Claude Code builder", { skip: !claude && "claude isn't installed here" }, () => {
    for (const flag of flagsOf("sonnet")) assert.ok(claude.includes(flag), `claude has no ${flag}`);
  });
});

describe("the pull request's fields, against the installed gh", () => {
  // Asked for no fields, gh lists the ones it knows, one per line, without needing a repository or a login.
  const listed = spawnSync("gh", ["pr", "list", "--json"], { encoding: "utf8", timeout: 30_000 });
  const known = listed.error ? null : `${listed.stdout}${listed.stderr}`;
  const lists = Boolean(known?.includes("Specify one or more comma-separated fields"));
  it("gh pr list knows every field the runner reads", { skip: !lists && "gh isn't installed here, or didn't list its fields" }, () => {
    for (const field of PR_FIELDS) assert.match(known, new RegExp(`^\\s+${field}$`, "m"), `gh pr list has no --json field ${field}`);
  });
});
