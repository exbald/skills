import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BUILDERS, configText, REVIEWER } from "./acme.mjs";

const SCRIPT = fileURLToPath(new URL("../run-wave.mjs", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

// A repository of its own with one spec and an agentkit.config.json, so the CLI's tests don't depend on a real
// spec's tasks or on the repository's own config.
const TASK = ["# Task 01: demo", "", "## Status", "", "pending", "", "## Wave", "", "1", "", "## Files to Modify", "", "- `apps/a.ts`", ""].join("\n");
let base;
let root;
let WAVE;

/** A repository at `base/<name>` with the demo spec and a config file of `text`. */
function repository(name, text) {
  const dir = join(base, name);
  mkdirSync(join(dir, "specs/09-demo/tasks"), { recursive: true });
  writeFileSync(join(dir, "specs/09-demo/tasks/task-01-demo.md"), TASK);
  writeFileSync(join(dir, "agentkit.config.json"), text);
  return dir;
}

before(() => {
  base = mkdtempSync(join(tmpdir(), "run-wave-cli-"));
  root = repository("repo", configText());
  WAVE = ["--root", root, "--spec", "specs/09-demo", "--wave", "1", "--dry-run"];
});
after(() => rmSync(base, { recursive: true, force: true }));

describe("run-wave's arguments", () => {
  it("plans a wave without running anything", () => {
    const result = run(...WAVE, "--builder", "sonnet");
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.branch, "build/spec-09-wave-01");
    assert.deepEqual(plan.tasks, ["task-01"]);
    assert.equal(plan.worktree, join(`${root}-builds`, "build-spec-09-wave-01"));
    assert.equal(plan.builder, "Sonnet 5.5 (high)");
    assert.match(plan.command, /--max-budget-usd 10\.00/);
    assert.match(plan.command, /--model claude-sonnet-5-5 --effort high/);
    assert.match(plan.brief, /in acme, unattended/);
  });

  it("takes the wave's budget from the builder's budgetUsd, unless --budget says otherwise", () => {
    const thrifty = repository("thrifty", configText({ builders: { ...BUILDERS, sonnet: { ...BUILDERS.sonnet, budgetUsd: 4 } } }));
    const plan = (...extra) => JSON.parse(run("--root", thrifty, "--spec", "specs/09-demo", "--wave", "1", "--dry-run", "--builder", "sonnet", ...extra).stdout);
    assert.match(plan().command, /--max-budget-usd 4\.00/);
    assert.match(plan("--budget", "2.5").command, /--max-budget-usd 2\.50/);
  });

  it("refuses a budget that isn't a positive number, since it's a spend cap", () => {
    for (const budget of ["abc", "0", "-5", "Infinity"]) {
      const result = run(...WAVE, "--builder", "sonnet", "--budget", budget);
      assert.equal(result.status, 1, `--budget ${budget}`);
      assert.match(result.stderr, /--budget must be a positive number/);
    }
  });

  it("refuses a wave that isn't a whole number, an unknown builder, a missing spec and an empty wave", () => {
    assert.match(run("--root", root, "--spec", "specs/09-demo", "--wave", "1.5", "--builder", "glm", "--dry-run").stderr, /--wave must be a wave number/);
    assert.match(run(...WAVE, "--builder", "grok").stderr, /Usage/);
    assert.match(run("--wave", "1", "--builder", "glm").stderr, /Usage/);
    assert.match(run("--root", root, "--spec", "specs/09-demo", "--wave", "4", "--builder", "glm", "--dry-run").stderr, /no tasks in wave 4/);
  });

  it("names the configured builders when --builder names another, or none", () => {
    const unknown = run(...WAVE, "--builder", "grok");
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown builder "grok"\. The builders in agentkit\.config\.json are: glm, sonnet\./);
    assert.match(run(...WAVE).stderr, /Usage: .*--builder <name>/);
    const none = repository("none", configText({ builders: {} }));
    assert.match(run("--root", none, "--spec", "specs/09-demo", "--wave", "1", "--dry-run", "--builder", "glm").stderr, /agentkit\.config\.json names no builders/);
  });

  it("stops before anything runs when the config names no repository or no reviewer bot", () => {
    for (const [name, overrides, said] of [
      ["no-repo", { repo: null }, /agentkit\.config\.json has no repo \(owner\/name on GitHub\)/],
      ["no-reviewer", { reviewer: { ...REVIEWER, login: null } }, /agentkit\.config\.json has no reviewer\.login/],
    ]) {
      const dir = repository(name, configText(overrides));
      // Not a dry run: the runner must stop before it clones, installs or starts a builder.
      const result = run("--root", dir, "--spec", "specs/09-demo", "--wave", "1", "--builder", "glm");
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, said);
      assert.equal(existsSync(`${dir}-builds`), false, `${name}: nothing was made beside the repository`);
    }
  });

  it("stops on a config file that doesn't fit, naming the file", () => {
    const broken = repository("broken", "{ not json");
    const result = run("--root", broken, "--spec", "specs/09-demo", "--wave", "1", "--dry-run", "--builder", "glm");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /agentkit\.config\.json isn't readable JSON/);
  });
});
