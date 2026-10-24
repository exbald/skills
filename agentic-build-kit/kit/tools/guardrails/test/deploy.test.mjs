import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_FILE, readConfig } from "../lib/config.mjs";
import { commitOfImage, imageLabel, onlyOne, rollbackCommit, shippedPaths, waitForHealthy } from "../lib/deploy.mjs";
import { liveImage } from "../lib/deploy-fly.mjs";
import { createFixture } from "./fixture.mjs";

const image = (tag, machine = "48ee712fd796d8") => ({ MachineID: machine, Registry: "registry.fly.io", Repository: "acme", Tag: tag });
const SHA = "1d51a92aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TAGGED = `registry.fly.io/acme:main-${SHA}-20261021-121509`;
const LEGACY = "registry.fly.io/acme:deployment-01M5E1ZD9KH3DA6AMTWMKWDPKS";
const NOT_SHIPPED = readConfig("/work/acme").deploy.notShipped;

describe("liveImage (the Fly adapter)", () => {
  it("names the image the machines run", () => {
    assert.equal(liveImage([image("deployment-01M5"), image("deployment-01M5", "2")], "acme"), "registry.fly.io/acme:deployment-01M5");
  });

  it("refuses when the machines run different images, or there are none", () => {
    assert.throws(() => liveImage([image("deployment-a"), image("deployment-b", "2")], "acme"), /different releases/);
    assert.throws(() => liveImage([], "acme"), /no machines for acme/);
    assert.throws(() => liveImage(null, "acme"), /no machines/);
  });

  it("refuses an image without a tag", () => {
    assert.throws(() => liveImage([{ Registry: "registry.fly.io", Repository: "acme" }], "acme"), /tag/);
  });
});

describe("onlyOne", () => {
  it("is what every machine runs, and refuses none, a blank or several", () => {
    assert.equal(onlyOne(["a", "a"], "the target"), "a");
    assert.throws(() => onlyOne([], "the target"), /the target lists nothing running/);
    assert.throws(() => onlyOne(["a", ""], "the target"), /without a name/);
    assert.throws(() => onlyOne(["a", "b"], "the target"), /different releases \(a, b\)/);
  });
});

describe("imageLabel and commitOfImage", () => {
  it("tags the full commit and the time", () => {
    assert.equal(imageLabel(SHA, new Date("2026-10-21T12:15:09.123Z")), `main-${SHA}-20261021-121509`);
  });

  it("refuses anything but a full commit hash", () => {
    assert.throws(() => imageLabel("1d51a92"), /full commit hash/);
  });

  it("reads the commit back from a tag the script made", () => {
    assert.equal(commitOfImage(`registry.fly.io/acme:${imageLabel(SHA)}`), SHA);
  });

  it("names the default branch, cut to what a tag allows, and still reads back", () => {
    const when = new Date("2026-10-21T12:15:09.123Z");
    assert.equal(imageLabel(SHA, when, "trunk"), `trunk-${SHA}-20261021-121509`);
    assert.equal(imageLabel(SHA, when, "release/2026"), `release-2026-${SHA}-20261021-121509`);
    assert.equal(commitOfImage(`registry.fly.io/acme:${imageLabel(SHA, when, "release/2026")}`), SHA);
  });

  it("returns null for images tagged before the script, or with a short hash", () => {
    assert.equal(commitOfImage(LEGACY), null);
    assert.equal(commitOfImage("registry.fly.io/acme:main-1d51a92-20261021-122852"), null);
  });
});

describe("rollbackCommit", () => {
  it("uses the commit the previous image names when git has it", () => {
    assert.equal(rollbackCommit(TAGGED, () => true), SHA);
  });

  it("falls back to main's fly.toml when git doesn't have that commit, or the tag names none", () => {
    assert.equal(rollbackCommit(TAGGED, () => false), null);
    assert.equal(rollbackCommit(LEGACY, () => true), null);
  });
});

describe("shippedPaths", () => {
  it("keeps what the service runs and drops docs, specs, tools, root Markdown and the kit's config, by default", () => {
    const changed = ["docs/STATUS.md", "specs/README.md", "tools/guardrails/lib/rules.mjs", "AGENTS.md", CONFIG_FILE, "agent/agent.ts", "Dockerfile", "fly.toml"];
    assert.deepEqual(shippedPaths(changed, NOT_SHIPPED), ["agent/agent.ts", "Dockerfile", "fly.toml"]);
  });

  it("drops a folder the config lists, such as a site that deploys elsewhere", () => {
    assert.deepEqual(shippedPaths(["site/src/pages/index.astro", "site/Dockerfile", "agent/agent.ts"], [...NOT_SHIPPED, "site/"]), ["agent/agent.ts"]);
  });

  it("keeps Markdown the service reads at runtime", () => {
    assert.deepEqual(shippedPaths(["agent/instructions/base.md", "agent/skills/browser.md"], NOT_SHIPPED), ["agent/instructions/base.md", "agent/skills/browser.md"]);
  });
});

describe("waitForHealthy", () => {
  const replies = (...statuses) => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const status = statuses[Math.min(calls.length, statuses.length) - 1];
      if (status instanceof Error) throw status;
      return { status };
    };
    return { calls, fetchImpl };
  };
  const sleep = async () => {};

  it("waits until the route answers 200", async () => {
    const { calls, fetchImpl } = replies(503, new Error("connection refused"), 200);
    assert.equal(await waitForHealthy("https://example.test/health", { attempts: 5, fetchImpl, sleep }), true);
    assert.equal(calls.length, 3);
  });

  it("gives up after the last attempt", async () => {
    const { calls, fetchImpl } = replies(502);
    assert.equal(await waitForHealthy("https://example.test/health", { attempts: 4, fetchImpl, sleep }), false);
    assert.equal(calls.length, 4);
  });
});

describe("deploy-approved.mjs arguments", () => {
  const script = fileURLToPath(new URL("../deploy-approved.mjs", import.meta.url));
  const runScript = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

  it("prints its usage for --help and exits 0, without touching git or Fly", () => {
    const result = runScript("--help");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage: node tools\/guardrails\/deploy-approved\.mjs \[--dry-run\]/);
  });

  it("refuses an unknown argument with the usage and exits 1", () => {
    const result = runScript("--bogus");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Not deployed: Usage:/);
  });

  it("deploys nothing, and says so, where the config names no deploy target", () => {
    const fx = createFixture();
    try {
      const result = spawnSync(process.execPath, [script], { cwd: fx.dir, env: fx.env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Nothing to deploy: agentkit\.config\.json sets deploy\.adapter to "none"/);
    } finally {
      fx.cleanup();
    }
  });

  it("stops on a broken config rather than deploy on guesses", () => {
    const fx = createFixture({ config: { deploy: { adapter: "fly", fly: { app: "acme" } } } });
    try {
      const result = spawnSync(process.execPath, [script], { cwd: fx.dir, env: fx.env, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Not deployed: agentkit\.config\.json: deploy\.healthUrl must be set/);
    } finally {
      fx.cleanup();
    }
  });
});
