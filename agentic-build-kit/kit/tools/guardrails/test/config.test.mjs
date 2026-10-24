import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CONFIG_FILE, ConfigError, configAt, readConfig, releaseBranches } from "../lib/config.mjs";

let root;
before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "agentkit-config-")));
});
after(() => rmSync(root, { recursive: true, force: true }));

const write = (value) => writeFileSync(join(root, CONFIG_FILE), typeof value === "string" ? value : JSON.stringify(value));
const remove = () => rmSync(join(root, CONFIG_FILE), { force: true });
const FLY = { adapter: "fly", healthUrl: "https://acme.fly.dev/health", fly: { app: "acme" } };

describe("agentkit.config.json", () => {
  it("gives the defaults when there is no file, the project named after its folder", () => {
    remove();
    const config = readConfig(root);
    assert.equal(config.project, basename(root));
    assert.equal(config.defaultBranch, "main");
    assert.equal(config.deploy.adapter, "none");
    assert.deepEqual(config.protectedPaths, []);
    assert.deepEqual(config.ci.requiredJobs, [{ workflow: "verify", job: "verify" }]);
    assert.equal(config.reviewer.login, null);
    assert.equal(config.problem, null);
  });

  it("lays the file over the defaults one section deep, and a list replaces its default whole", () => {
    write({ project: "acme", reviewer: { login: "acme-review-bot" }, deploy: FLY, $comment: "ignored" });
    const config = readConfig(root);
    assert.equal(config.project, "acme");
    assert.deepEqual(config.reviewer, { login: "acme-review-bot", name: "the reviewer bot", trigger: "/review" });
    assert.equal(config.deploy.fly.app, "acme");
    assert.ok(config.deploy.notShipped.includes("specs/"), "the section's other keys keep their defaults");
    write({ deploy: { ...FLY, notShipped: ["docs/"] } });
    assert.deepEqual(readConfig(root).deploy.notShipped, ["docs/"]);
  });

  it("is frozen, so no tool can change what another reads", () => {
    write({ project: "acme" });
    const config = readConfig(root);
    assert.throws(() => {
      config.reviewer.login = "someone";
    }, TypeError);
  });

  it("refuses an unknown key, naming it, so a typo can't pass for a setting", () => {
    write({ reviwer: { login: "x" } });
    assert.throws(() => readConfig(root), (error) => error instanceof ConfigError && /unknown key "reviwer"/.test(error.message));
  });

  it("refuses a file that isn't JSON, or isn't one object", () => {
    write("{ nope");
    assert.throws(() => readConfig(root), /isn't readable JSON/);
    write("[]");
    assert.throws(() => readConfig(root), /must hold one JSON object/);
  });

  it("names each value that doesn't fit", () => {
    write({ repo: "not a repo", defaultBranch: "has space", verify: { command: "npm run verify" }, protectedPaths: [{ path: "/abs" }] });
    const message = (() => {
      try {
        readConfig(root);
        return "";
      } catch (error) {
        return error.message;
      }
    })();
    for (const key of ["repo must be owner/name", "defaultBranch must be a branch name", "verify.command must be a command as a list of words", "protectedPaths[0] doesn't fit"]) {
      assert.ok(message.includes(key), `${key} in: ${message}`);
    }
  });

  it("checks each builder's harness, model and budget", () => {
    write({ builders: { glm: { harness: "opencode", model: "zai-coding-plan/glm-5.3#max" }, sonnet: { harness: "claude", model: "claude-sonnet-5-5", budgetUsd: 10 } } });
    assert.deepEqual(Object.keys(readConfig(root).builders), ["glm", "sonnet"]);
    write({ builders: { glm: { harness: "vim", model: "x" } } });
    assert.throws(() => readConfig(root), /builders\.glm\.harness must be one of opencode, claude/);
    write({ builders: { sonnet: { harness: "claude", model: "m", budgetUsd: 0 } } });
    assert.throws(() => readConfig(root), /budgetUsd must be a positive number/);
    write({ builders: { "Big Model": { harness: "claude", model: "m" } } });
    assert.throws(() => readConfig(root), /isn't a name/);
  });

  it("needs the app and a health URL for a Fly deploy, since the rollback depends on the health check", () => {
    write({ deploy: { adapter: "fly" } });
    assert.throws(() => readConfig(root), /deploy\.fly\.app must name the Fly app[\s\S]*deploy\.healthUrl must be set/);
    write({ deploy: { adapter: "heroku" } });
    assert.throws(() => readConfig(root), /deploy\.adapter must be one of none, fly/);
    write({ deploy: FLY });
    assert.equal(readConfig(root).deploy.adapter, "fly");
  });

  it("for the hooks, falls back to the defaults on a broken file and says why, never throwing", () => {
    write({ protectedPaths: "design/screens/" });
    const config = configAt(root);
    assert.deepEqual(config.protectedPaths, []);
    assert.match(config.problem, /protectedPaths must be a list/);
    remove();
    assert.equal(configAt(root).problem, null);
  });

  it("counts main, master and the default branch as release branches", () => {
    write({ defaultBranch: "trunk" });
    assert.deepEqual([...releaseBranches(readConfig(root))].sort(), ["main", "master", "trunk"]);
  });
});
