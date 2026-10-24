import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addableWithoutState, workingTreeHash } from "../lib/git.mjs";
import { STATE_FILES, verifyCommand } from "../lib/state.mjs";
import { createFixture } from "./fixture.mjs";

/** Blocks until just after the next whole second, so two steps can be placed in the same second or apart. */
function waitForNextSecond() {
  const until = Math.ceil(Date.now() / 1000) * 1000 + 50;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, until - Date.now()));
}

const withFixture = (options, body) => () => {
  const fx = createFixture(options);
  try {
    body(fx);
  } finally {
    fx.cleanup();
  }
};

describe("verify.mjs", () => {
  it(
    "stamps the working tree, and the stamp matches HEAD once that state is committed",
    withFixture({}, (fx) => {
      fx.write("src/app.ts", "export const app = 42;\n");
      fx.write("src/brand-new.ts", "export {};\n");
      const result = fx.verify();
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const stamp = JSON.parse(fx.read("specs/.verified"));
      assert.equal(stamp.command, "npm run verify");
      assert.ok(!Number.isNaN(Date.parse(stamp.at)), "at is a timestamp");
      assert.match(fx.git("status", "--porcelain"), /^\?\? src\/brand-new\.ts$/m, "the real index is untouched");
      fx.commitAll("feat: verified change");
      assert.equal(stamp.tree, fx.git("rev-parse", "HEAD^{tree}"));
    }),
  );

  it(
    "stamps the tree while a task is active, with its gitignored marker in place",
    withFixture({}, (fx) => {
      fx.setTask();
      fx.write("src/app.ts", "export const app = 7;\n");
      const result = fx.verify();
      assert.equal(result.status, 0, result.stderr + result.stdout);
      fx.commitAll("feat: verified change");
      assert.equal(JSON.parse(fx.read("specs/.verified")).tree, fx.git("rev-parse", "HEAD^{tree}"));
    }),
  );

  it(
    "names only the state files git doesn't ignore in git add's excludes, on any git version",
    withFixture({}, (fx) => {
      fx.setTask();
      assert.deepEqual(addableWithoutState(fx.dir), ["."]);
      fx.write(".gitignore", "node_modules\n.env*\n");
      assert.deepEqual(addableWithoutState(fx.dir), [".", ...STATE_FILES.map((file) => `:(exclude)${file}`)]);
    }),
  );

  it(
    "sees a same-size edit made in the same second as the last commit, hashed a second later",
    withFixture({}, (fx) => {
      // Commit and edit in one second, hash in the next: a scratch index stamped with the later time would
      // trust the old entry and miss the edit.
      waitForNextSecond();
      fx.write("src/app.ts", "export const app = 3;\n");
      fx.commitAll("feat: three");
      fx.write("src/app.ts", "export const app = 7;\n");
      waitForNextSecond();
      const tree = workingTreeHash(fx.dir);
      fx.commitAll("feat: seven");
      assert.equal(tree, fx.git("rev-parse", "HEAD^{tree}"));
    }),
  );

  it(
    "exits with the verification's code and leaves no stamp when it fails",
    withFixture({ verifyScript: 'node -e "process.exit(3)"' }, (fx) => {
      fx.stamp("stale");
      const result = fx.verify();
      assert.equal(result.status, 3);
      assert.equal(fx.exists("specs/.verified"), false);
    }),
  );

  it(
    "stamps the whole repository when run from a subdirectory, ignoring its own state files",
    withFixture({}, (fx) => {
      fx.write(".gitignore", "node_modules\n.env*\n");
      fx.commitAll("chore: state files not ignored");
      fx.setTask();
      fx.write("specs/.stop-blocks", "3\n");
      const result = fx.verify({ cwd: fx.path("src") });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.equal(JSON.parse(fx.read("specs/.verified")).tree, fx.git("rev-parse", "HEAD^{tree}"));
    }),
  );

  it("runs npm run verify when the script exists, and tsc until then", () => {
    assert.deepEqual(verifyCommand({ scripts: { verify: "tsc && node --test" } }), { command: "npm", args: ["run", "verify"] });
    assert.deepEqual(verifyCommand({ scripts: { build: "eve build" } }), { command: "npx", args: ["tsc", "--noEmit", "-p", "."] });
    assert.deepEqual(verifyCommand(null), { command: "npx", args: ["tsc", "--noEmit", "-p", "."] });
  });

  it("runs the config's verify.command when it names one, before anything else", () => {
    const config = { verify: { command: ["make", "verify"] } };
    assert.deepEqual(verifyCommand({ scripts: { verify: "x" } }, config), { command: "make", args: ["verify"] });
    assert.deepEqual(verifyCommand(null, { verify: { command: null } }), { command: "npx", args: ["tsc", "--noEmit", "-p", "."] });
  });

  it(
    "runs the configured command and stamps the tree",
    withFixture({ verifyScript: 'node -e "process.exit(5)"', config: { verify: { command: ["node", "-e", "process.exit(0)"] } } }, (fx) => {
      const result = fx.verify();
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.equal(JSON.parse(fx.read("specs/.verified")).command, "node -e process.exit(0)");
    }),
  );

  it(
    "fails, and writes no stamp, when the config is broken",
    withFixture({ config: { verify: { command: "npm run verify" } } }, (fx) => {
      const result = fx.verify();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /verify: agentkit\.config\.json: verify\.command must be a command as a list of words/);
      assert.equal(fx.exists("specs/.verified"), false);
    }),
  );
});
