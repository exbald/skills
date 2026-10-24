import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { configFile, fill, githubRepo, mergeClaudeMd, mergeClaudeSettings, mergeGitignore, mergePackageJson, parseArgs, screensSection } from "../lib/kit.mjs";

// init.mjs against real, throwaway git repositories: what it writes, what it refuses, and what it merges.
const INIT = fileURLToPath(new URL("../init.mjs", import.meta.url));
let base;
let env;
let count = 0;

before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "agentkit-init-")));
  writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Alex Example\n\temail = alex@example.com\n[init]\n\tdefaultBranch = main\n");
  env = { ...process.env, GIT_CONFIG_GLOBAL: join(base, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "CLAUDE_PROJECT_DIR"]) delete env[key];
});
after(() => rmSync(base, { recursive: true, force: true }));

/** A new git repository named `name`, with origin pointing at GitHub when `origin` is given. */
function repo(name = "acme", origin = null) {
  count += 1;
  const dir = join(base, `case-${count}`, name);
  mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir, env });
  if (origin) spawnSync("git", ["remote", "add", "origin", origin], { cwd: dir, env });
  return dir;
}

const init = (dir, ...args) => spawnSync(process.execPath, [INIT, dir, "--yes", ...args], { env, encoding: "utf8" });
const read = (dir, rel) => readFileSync(join(dir, rel), "utf8");
// Every file init could have written: the repository's files, outside .git.
const files = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .filter((rel) => !rel.startsWith(".git/"));

describe("init into a fresh repository", () => {
  it("installs the kit with every placeholder filled and a config the tools accept", () => {
    const dir = repo("acme", "git@github.com:acme-org/acme.git");
    const result = init(dir, "--reviewer-login", "acme-review-bot", "--reviewer-trigger", "/review");
    assert.equal(result.status, 0, result.stderr);
    for (const rel of ["AGENTS.md", "CLAUDE.md", "agentkit.config.json", "package.json", ".gitignore", ".claude/settings.json", ".opencode/plugins/guardrails.js", ".github/workflows/verify.yml"]) {
      assert.ok(existsSync(join(dir, rel)), rel);
    }
    for (const rel of ["docs/decisions/0001-adopt-the-agentic-build-kit.md", "specs/README.md", "specs/LEDGER.md", "specs/_template/README.md", "tools/guardrails/hooks/guard.mjs", "tools/build/run-wave.mjs", "tools/spec-check/check.mjs", "tools/.claude-plugin/marketplace.json"]) {
      assert.ok(existsSync(join(dir, rel)), rel);
    }
    const leftovers = files(dir).filter((rel) => rel.endsWith(".tmpl") || /\{\{[A-Z_]+\}\}/.test(readFileSync(join(dir, rel), "utf8")));
    assert.deepEqual(leftovers, [], "no template file or unfilled placeholder is left");
    assert.match(read(dir, "AGENTS.md"), /^# acme: agent contract/);
    assert.match(read(dir, "AGENTS.md"), /The \*\*acme-review-bot\*\* GitHub bot reviews every pull request into `main`/);
    assert.match(read(dir, ".github/workflows/verify.yml"), /branches: \[main\]\n[\s\S]*group: verify-\$\{\{ github\.ref \}\}/, "GitHub's own expressions are left alone");
    const config = JSON.parse(read(dir, "agentkit.config.json"));
    assert.equal(config.repo, "acme-org/acme");
    assert.equal(config.owner, "Alex Example");
    assert.equal(config.reviewer.login, "acme-review-bot");
    assert.deepEqual(Object.keys(config.builders), ["glm", "sonnet"]);
    assert.match(result.stdout, /Next steps:/);
  });

  it("leaves a repository whose own checks pass: the spec checker, and the template spec once copied", () => {
    const dir = repo();
    assert.equal(init(dir).status, 0);
    const check = () => spawnSync(process.execPath, ["tools/spec-check/check.mjs"], { cwd: dir, encoding: "utf8" });
    assert.equal(check().stdout, "spec-check: 0 spec(s), 0 tasks, no problems.\n");
    cpSync(join(dir, "specs/_template"), join(dir, "specs/01-example"), { recursive: true });
    const copied = check();
    assert.equal(copied.status, 0, copied.stdout);
    assert.match(copied.stdout, /1 spec\(s\), 1 tasks, no problems/);
  });

  it("reminds, in AGENTS.md, to set a reviewer bot it wasn't given", () => {
    const dir = repo();
    assert.equal(init(dir).status, 0);
    assert.match(read(dir, "AGENTS.md"), /reviewer bot \(set reviewer\.login in agentkit\.config\.json\)/);
    assert.match(init(repo()).stdout, /Set reviewer\.login before the first merge/);
  });

  it("writes nothing with --dry-run", () => {
    const dir = repo();
    const result = init(dir, "--dry-run");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Would write \d+ files/);
    assert.deepEqual(files(dir), []);
  });

  it("adds the screen check with --with-screens, its tests in test:tools and a screens section to check", () => {
    const dir = repo("my-app");
    assert.equal(init(dir, "--with-screens").status, 0);
    assert.ok(existsSync(join(dir, "tools/screens/capture.mjs")));
    assert.match(JSON.parse(read(dir, "package.json")).scripts["test:tools"], /"tools\/screens\/test\/\*\.test\.mjs"/);
    assert.deepEqual(JSON.parse(read(dir, "agentkit.config.json")).screens, screensSection("my-app"));
  });

  it("sets up a Fly deploy only with the app and its health route", () => {
    const missing = init(repo(), "--deploy", "fly", "--fly-app", "acme");
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /deploy\.healthUrl must be set/);
    const dir = repo();
    assert.equal(init(dir, "--deploy", "fly", "--fly-app", "acme", "--health-url", "https://acme.fly.dev/health").status, 0);
    assert.deepEqual(JSON.parse(read(dir, "agentkit.config.json")).deploy.fly, { app: "acme" });
  });
});

describe("init into a repository that has files already", () => {
  it("refuses, writing nothing, when a kit file exists, and names it", () => {
    const dir = repo();
    writeFileSync(join(dir, "AGENTS.md"), "# ours\n");
    const result = init(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /These kit files exist already, so nothing was written:\n {2}AGENTS\.md\n/);
    assert.deepEqual(files(dir), ["AGENTS.md"]);
    assert.equal(read(dir, "AGENTS.md"), "# ours\n");
  });

  it("overwrites them with --force", () => {
    const dir = repo();
    writeFileSync(join(dir, "AGENTS.md"), "# ours\n");
    assert.equal(init(dir, "--force").status, 0);
    assert.match(read(dir, "AGENTS.md"), /agent contract/);
  });

  it("merges package.json, .gitignore, CLAUDE.md and .claude/settings.json, only adding, and twice changes nothing more", () => {
    const dir = repo();
    writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "acme", scripts: { test: "vitest", verify: "tsc" } }, null, 2)}\n`);
    writeFileSync(join(dir, ".gitignore"), "dist\nnode_modules\n");
    writeFileSync(join(dir, "CLAUDE.md"), "# Notes\n");
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude/settings.json"), `${JSON.stringify({ permissions: { allow: ["Bash(ls)"] } })}\n`);
    const result = init(dir);
    assert.equal(result.status, 0, result.stderr);
    const pkg = JSON.parse(read(dir, "package.json"));
    assert.deepEqual(pkg.scripts, { test: "vitest", verify: "tsc", "check:specs": "node tools/spec-check/check.mjs", "test:tools": pkg.scripts["test:tools"] });
    assert.match(result.stdout, /package\.json has a verify script of its own: add "npm run check:specs && npm run test:tools" to it/);
    assert.equal(read(dir, ".gitignore"), "dist\nnode_modules\n\n# The agentic build kit: secrets and the guardrails' local state\n.env*\nspecs/.current-task\nspecs/.verified\nspecs/.stop-blocks\n");
    assert.equal(read(dir, "CLAUDE.md"), "# Notes\n\n@AGENTS.md\n");
    const settings = JSON.parse(read(dir, ".claude/settings.json"));
    assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
    assert.deepEqual(Object.keys(settings.hooks), ["PreToolUse", "Stop", "SessionStart"]);
    const before = Object.fromEntries([".gitignore", "CLAUDE.md", "package.json", ".claude/settings.json"].map((rel) => [rel, read(dir, rel)]));
    assert.equal(init(dir, "--force").status, 0);
    for (const [rel, text] of Object.entries(before)) assert.equal(read(dir, rel), text, `${rel} unchanged by a second run`);
  });

  it("refuses a folder that isn't a git repository", () => {
    const dir = join(base, "not-a-repo");
    mkdirSync(dir, { recursive: true });
    const result = init(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /isn't a git repository\. Run git init there first/);
  });
});

describe("init's decisions", () => {
  it("reads its arguments, and refuses what it can't use", () => {
    assert.deepEqual(parseArgs(["/x", "--project=acme", "--deploy", "fly", "--force"]).project, "acme");
    assert.throws(() => parseArgs([]), /Name the repository/);
    assert.throws(() => parseArgs(["/x", "--deploy", "heroku"]), /--deploy takes none or fly/);
    assert.throws(() => parseArgs(["/x", "--owner"]), /--owner needs a value/);
    assert.throws(() => parseArgs(["/x", "--bogus"]), /Unknown option --bogus/);
    assert.equal(parseArgs(["--help"]).help, true);
  });

  it("reads owner/name from GitHub's URL forms, and nothing else", () => {
    for (const url of ["git@github.com:acme-org/acme.git", "https://github.com/acme-org/acme", "https://github.com/acme-org/acme.git", "ssh://git@github.com/acme-org/acme.git", "https://token@github.com/acme-org/acme.git"]) {
      assert.equal(githubRepo(url), "acme-org/acme", url);
    }
    for (const url of ["https://gitlab.com/acme-org/acme.git", "", null, "/srv/git/acme.git"]) assert.equal(githubRepo(url), null, String(url));
  });

  it("fills every placeholder, and refuses one it has no value for", () => {
    assert.equal(fill("# {{PROJECT}} at ${{ github.ref }}", { PROJECT: "acme" }), "# acme at ${{ github.ref }}");
    assert.throws(() => fill("{{NOPE}}", {}), /no value for \{\{NOPE\}\}/);
  });

  it("merges each kind of file only by adding", () => {
    assert.deepEqual(mergeGitignore(".env*\nnode_modules\nspecs/.current-task\nspecs/.verified\nspecs/.stop-blocks\n").added, []);
    assert.equal(mergeGitignore(null).text.startsWith("# The agentic build kit"), true);
    assert.deepEqual(mergeClaudeMd("@AGENTS.md\n"), { text: "@AGENTS.md\n", added: [] });
    const fresh = JSON.parse(mergePackageJson(null, { project: "My App!", withScreens: false }).text);
    assert.equal(fresh.name, "my-app");
    assert.equal(fresh.scripts.verify, "npm run check:specs && npm run test:tools");
    const kit = { hooks: { Stop: [{ hooks: [{ type: "command", command: "node tools/guardrails/hooks/stop-verify.mjs" }] }] } };
    const wired = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR/tools/guardrails/hooks/stop-verify.mjs\"" }] }] } });
    assert.deepEqual(mergeClaudeSettings(wired, kit).added, [], "a hook that runs already isn't added twice");
  });

  it("names the screens section's app after the project, as an Android package and a scheme allow", () => {
    assert.deepEqual(screensSection("my-app"), { appId: "com.myapp.app", linkScheme: "myapp", avd: "myapp-pixel8-api35", idsFile: "apps/mobile/src/dev/gallery/ids.json" });
    assert.equal(screensSection("2fast").appId, "com.app2fast.app");
  });

  it("writes every key into the config, so the file shows what can be set", () => {
    const keys = Object.keys(configFile({ project: "acme", owner: "A", repo: null, defaultBranch: "main", lockfile: "package-lock.json", reviewerLogin: null, reviewerName: "r", reviewerTrigger: "/r", deploy: "none", withScreens: false }));
    assert.deepEqual(keys, ["$comment", "project", "owner", "repo", "defaultBranch", "lockfile", "verify", "protectedPaths", "deniedCommands", "reviewer", "ci", "deploy", "builders", "build"]);
  });
});
