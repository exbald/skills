import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globToRegExp } from "../lib/paths.mjs";
import { isComplete, listedEntries, matchesEntry, taskStatus } from "../lib/task.mjs";
import { taskText } from "./fixture.mjs";

describe("task file parsing", () => {
  it("takes backticked paths from Files to Modify and Files to Create only", () => {
    assert.deepEqual(listedEntries(taskText(), "/repo"), [
      "src/app.ts",
      "README.md",
      "src/new-module.ts",
      "src/new-module.test.ts",
      "docs/notes/",
    ]);
  });

  it("skips commands, package names, URLs and paths outside the repository", () => {
    const text = [
      "## Files to Modify",
      "",
      "- `npm run verify`",
      "- `zod@4.5.4`",
      "- `https://example.com/a`",
      "- `Dockerfile`",
      "- `./agent/agent.ts`",
      "- `apps/agent/**`",
      "- `../outside.ts`",
      "- `./`",
      "",
      "## Notes",
      "",
      "- `notes.md`",
    ].join("\n");
    assert.deepEqual(listedEntries(text, "/repo"), ["Dockerfile", "agent/agent.ts", "apps/agent/"]);
  });

  it("reads the status from the first line under ## Status", () => {
    assert.equal(taskStatus(taskText("pending")), "pending");
    assert.equal(taskStatus(taskText("**Complete**")), "complete");
    assert.equal(taskStatus("# no status\n"), "");
    assert.equal(isComplete("complete"), true);
    assert.equal(isComplete("pending"), false);
  });

  it("matches exact paths, directories and globs", () => {
    assert.equal(matchesEntry("src/app.ts", "src/app.ts"), true);
    assert.equal(matchesEntry("src/app.tsx", "src/app.ts"), false);
    assert.equal(matchesEntry("docs/notes/a/b.md", "docs/notes/"), true);
    assert.equal(matchesEntry("docs/notes", "docs/notes/"), true);
    assert.equal(matchesEntry("docs/notesx/a.md", "docs/notes/"), false);
    assert.equal(matchesEntry("src/a/b.test.ts", "src/**/*.test.ts"), true);
    assert.equal(matchesEntry("src/b.test.ts", "src/**/*.test.ts"), true);
  });

  it("reads brackets in a listed path literally", () => {
    const route = "apps/mobile/src/app/(app)/bot/[botId]/index.tsx";
    assert.equal(matchesEntry(route, route), true);
    assert.equal(matchesEntry("apps/mobile/src/app/(app)/bot/b/index.tsx", route), false);
    const glob = "apps/mobile/src/app/(app)/bot/[botId]/*.tsx";
    assert.equal(matchesEntry("apps/mobile/src/app/(app)/bot/[botId]/edit.tsx", glob), true);
    assert.equal(matchesEntry("apps/mobile/src/app/(app)/bot/b/edit.tsx", glob), false);
    assert.equal(globToRegExp(".en[v]").test(".env"), true);
  });

  it("does not let a directory entry cover test files", () => {
    assert.equal(matchesEntry("docs/notes/a.test.ts", "docs/notes/", false), false);
    assert.equal(matchesEntry("src/b.test.ts", "src/**/*.test.ts", false), true);
  });
});
