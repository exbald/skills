import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requiredChecks } from "../lib/ci.mjs";
import { readConfig } from "../lib/config.mjs";
import { createFixture } from "./fixture.mjs";

describe("requiredChecks", () => {
  it("requires nothing while origin/main has no CI workflow", () => {
    const fx = createFixture();
    try {
      assert.deepEqual(requiredChecks(fx.dir, readConfig(fx.dir)), []);
    } finally {
      fx.cleanup();
    }
  });

  it("requires the configured jobs once origin's default branch has the workflow, even before the branch does", () => {
    const fx = createFixture();
    try {
      const config = readConfig(fx.dir);
      fx.git("switch", "-q", "main");
      fx.write(config.ci.workflowFile, "name: verify\n");
      fx.commitAll("add the verify workflow");
      fx.git("push", "-q", "origin", "main");
      fx.git("switch", "-q", "feat/demo");
      assert.equal(fx.exists(config.ci.workflowFile), false);
      assert.deepEqual(requiredChecks(fx.dir, config), [{ workflow: "verify", job: "verify" }]);
    } finally {
      fx.cleanup();
    }
  });

  it("reads another workflow file, its jobs and the default branch from the config", () => {
    const fx = createFixture();
    try {
      const jobs = [{ workflow: "ci", job: "test" }, { workflow: "ci", job: "image" }];
      fx.git("switch", "-q", "-c", "trunk");
      fx.write(".github/workflows/ci.yml", "name: ci\n");
      fx.commitAll("add the ci workflow");
      fx.git("push", "-q", "origin", "trunk");
      const config = { ...readConfig(fx.dir), defaultBranch: "trunk", ci: { workflowFile: ".github/workflows/ci.yml", requiredJobs: jobs } };
      assert.deepEqual(requiredChecks(fx.dir, config), jobs);
      assert.deepEqual(requiredChecks(fx.dir, { ...config, defaultBranch: "main" }), [], "main hasn't got it");
    } finally {
      fx.cleanup();
    }
  });

  it("refuses to guess when origin can't be fetched", () => {
    const fx = createFixture();
    try {
      fx.git("remote", "set-url", "origin", `${fx.dir}/no-such-remote.git`);
      assert.throws(() => requiredChecks(fx.dir, readConfig(fx.dir)), /git fetch origin main failed/);
    } finally {
      fx.cleanup();
    }
  });
});
