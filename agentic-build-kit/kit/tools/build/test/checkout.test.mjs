import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { prepareCheckout } from "../lib/checkout.mjs";

// Every way an earlier run can leave a wave's checkout, against real git: none of them loses a commit.
const BRANCH = "build/spec-09-wave-01";

describe("the wave's checkout", () => {
  let base;
  let root;
  let other;
  let worktree;
  let count = 0;
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const commit = (cwd, name) => {
    writeFileSync(join(cwd, name), name);
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", name);
    return git(cwd, "rev-parse", "HEAD");
  };

  before(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "run-wave-checkout-")));
    writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Stub\n\temail = stub@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
  });
  after(() => {
    delete process.env.GIT_CONFIG_GLOBAL;
    delete process.env.GIT_CONFIG_NOSYSTEM;
    rmSync(base, { recursive: true, force: true });
  });
  beforeEach(() => {
    count += 1;
    const dir = join(base, `case-${count}`);
    const remote = join(dir, "remote.git");
    root = join(dir, "repo");
    other = join(dir, "other");
    worktree = join(dir, "builds", "build-spec-09-wave-01");
    mkdirSync(root, { recursive: true });
    git(dir, "init", "-q", "--bare", remote);
    git(root, "init", "-q", "-b", "main");
    commit(root, "README.md");
    git(root, "remote", "add", "origin", remote);
    git(root, "push", "-q", "-u", "origin", "main");
    git(dir, "clone", "-q", remote, other);
  });

  it("starts a new wave from origin/main, in a clone of its own, never a worktree", () => {
    const said = prepareCheckout({ root, branch: BRANCH, worktree });
    assert.match(said, /cloned, new from origin\/main$/);
    assert.equal(git(worktree, "rev-parse", "HEAD"), git(root, "rev-parse", "origin/main"));
    assert.equal(git(worktree, "branch", "--show-current"), BRANCH);
    // The wave has a .git of its own, sharing nothing with the repository's checkout.
    assert.equal(git(worktree, "rev-parse", "--git-common-dir"), ".git");
    assert.equal(git(root, "worktree", "list").split("\n").length, 1);
    assert.equal(git(worktree, "remote", "get-url", "origin"), git(root, "remote", "get-url", "origin"));
  });

  it("starts a new wave from origin's default branch when it isn't main", () => {
    git(root, "switch", "-q", "-c", "trunk");
    const trunk = commit(root, "TRUNK.md");
    git(root, "push", "-q", "-u", "origin", "trunk");
    const said = prepareCheckout({ root, branch: BRANCH, worktree, defaultBranch: "trunk" });
    assert.match(said, /cloned, new from origin\/trunk$/);
    assert.equal(git(worktree, "rev-parse", "HEAD"), trunk);
  });

  it("refuses a git worktree left at the wave's path, rather than reuse it", () => {
    git(root, "worktree", "add", "-q", "-b", BRANCH, worktree, "origin/main");
    assert.throws(() => prepareCheckout({ root, branch: BRANCH, worktree }), /is a git worktree.*Remove it/);
  });

  it("refuses a path that's there but isn't a checkout, with an instruction, not a crash", () => {
    mkdirSync(worktree, { recursive: true });
    assert.throws(() => prepareCheckout({ root, branch: BRANCH, worktree }), /exists but isn't a git checkout\. Remove it/);
  });

  it("refuses a clone of another repository, rather than build there and push to it", () => {
    git(base, "clone", "-q", other, worktree);
    assert.throws(() => prepareCheckout({ root, branch: BRANCH, worktree }), /is a clone of .*other, not of .*remote\.git\. Remove it/);
  });

  it("puts an existing clone back on the wave's branch, wherever a stopped builder left it", () => {
    prepareCheckout({ root, branch: BRANCH, worktree });
    git(worktree, "switch", "-q", "main");
    assert.match(prepareCheckout({ root, branch: BRANCH, worktree }), /found$/);
    assert.equal(git(worktree, "branch", "--show-current"), BRANCH);
  });

  it("picks up a pushed branch when there's no local one, and tracks it", () => {
    git(other, "switch", "-q", "-c", BRANCH);
    const pushed = commit(other, "task-01.md");
    git(other, "push", "-q", "origin", BRANCH);
    assert.match(prepareCheckout({ root, branch: BRANCH, worktree }), /cloned, on its pushed branch, up to date/);
    assert.equal(git(worktree, "rev-parse", "HEAD"), pushed);
    assert.equal(git(worktree, "rev-parse", "--abbrev-ref", "@{u}"), `origin/${BRANCH}`);
  });

  it("carries over unpushed work an older worktree-based run left on a branch in the repository", () => {
    git(root, "switch", "-q", "-c", BRANCH);
    commit(root, "task-01.md");
    git(root, "push", "-q", "-u", "origin", BRANCH);
    const unpushed = commit(root, "task-02.md");
    git(root, "switch", "-q", "main");
    assert.match(prepareCheckout({ root, branch: BRANCH, worktree }), /cloned, with its local branch, 1 commit\(s\) ahead of origin.*kept as it is/);
    assert.equal(git(worktree, "rev-parse", "HEAD"), unpushed);
  });

  it("fast-forwards a checkout with no work of its own, and never one that has some", () => {
    prepareCheckout({ root, branch: BRANCH, worktree });
    commit(worktree, "task-01.md");
    git(worktree, "push", "-q", "-u", "origin", BRANCH);
    git(other, "fetch", "-q", "origin");
    git(other, "switch", "-q", "-c", BRANCH, `origin/${BRANCH}`);
    const theirs = commit(other, "task-02.md");
    git(other, "push", "-q", "origin", BRANCH);
    assert.match(prepareCheckout({ root, branch: BRANCH, worktree }), /found, fast-forwarded/);
    assert.equal(git(worktree, "rev-parse", "HEAD"), theirs);
    const mine = commit(worktree, "task-03.md");
    commit(other, "task-04.md");
    git(other, "push", "-q", "origin", BRANCH);
    assert.match(prepareCheckout({ root, branch: BRANCH, worktree }), /1 commit\(s\) ahead of origin.* and 1 behind: kept as it is/);
    assert.equal(git(worktree, "rev-parse", "HEAD"), mine);
  });
});
