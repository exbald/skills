import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { formatProblems } from "../lib/format.mjs";
import { acrossOverlaps, entriesOverlap, waveOverlaps } from "../lib/overlap.mjs";
import { readinessProblems } from "../lib/ready.mjs";
import { readSpec, specDirs, splitSections } from "../lib/spec.mjs";

const CHECK = join(dirname(fileURLToPath(import.meta.url)), "..", "check.mjs");
const SECTIONS = [
  "Status",
  "Wave",
  "Description",
  "Dependencies",
  "Files to Modify",
  "Files to Create",
  "Technical Details",
  "Implementation Steps",
  "Verification",
  "Acceptance Criteria",
  "Notes",
];

function fileList(entries) {
  return entries.length === 0 ? "None." : entries.map((entry) => `- \`${entry}\``).join("\n");
}

/** A valid task file. Each argument has a default. */
function task({
  status = "pending",
  wave = 1,
  deps = "None.",
  modify = ["src/a.ts"],
  create = [],
  verification = "```sh\nnpm test\n```",
} = {}) {
  const bodies = {
    Status: status,
    Wave: String(wave),
    Description: "Does a thing.",
    Dependencies: deps,
    "Files to Modify": fileList(modify),
    "Files to Create": fileList(create),
    "Technical Details": "Details.",
    "Implementation Steps": "1. Do it.",
    Verification: verification,
    "Acceptance Criteria": "- [ ] It works.",
    Notes: "None.",
  };
  return `# Task\n\n${SECTIONS.map((title) => `## ${title}\n\n${bodies[title]}\n`).join("\n")}`;
}

function readmeFor(tasks) {
  const lines = Object.entries(tasks).map(([name, text]) => {
    const done = /## Status\n\n(\w+)/.exec(text)?.[1] === "complete";
    const id = name.slice(0, 7);
    return `- [${done ? "x" : " "}] [${id}](tasks/${name}): Summary (any model)`;
  });
  return [
    "# Spec",
    "",
    "- **Written against:** `main` at abc1234",
    "",
    "```mermaid",
    "graph TD",
    "  a --> b",
    "```",
    "",
    "## Waves",
    "",
    "| Wave | Goal | Tasks |",
    "",
    "## Tasks",
    "",
    ...lines,
    "",
  ].join("\n");
}

function put(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** Writes specs/<name>/ with requirements, action-required, the task files and a README. */
function writeSpec(root, name, tasks, readme = readmeFor(tasks)) {
  const dir = `specs/${name}`;
  put(root, `${dir}/requirements.md`, "# Requirements\n");
  put(root, `${dir}/action-required.md`, "# Action required\n");
  for (const [file, text] of Object.entries(tasks)) put(root, `${dir}/tasks/${file}`, text);
  if (readme !== null) put(root, `${dir}/README.md`, readme);
  return dir;
}

let root;
let counter = 0;
before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spec-check-")));
});
after(() => rmSync(root, { recursive: true, force: true }));

/** A fresh repository per test, so specs from one test never leak into another. */
function repo() {
  counter += 1;
  const path = join(root, `repo-${counter}`);
  mkdirSync(join(path, "specs"), { recursive: true });
  return path;
}

function problemsOf(repoRoot, dir) {
  return formatProblems(repoRoot, readSpec(repoRoot, dir));
}

function messages(problems) {
  return problems.map((problem) => problem.message);
}

function build(tasks, readme) {
  const repoRoot = repo();
  const dir = writeSpec(repoRoot, "01-demo", tasks, readme);
  return { repoRoot, dir, spec: readSpec(repoRoot, dir) };
}

describe("format rules", () => {
  it("accepts a valid spec", () => {
    const { repoRoot, dir } = build({ "task-01-first.md": task(), "task-02-second.md": task({ wave: 2, deps: "task-01" }) });
    assert.deepEqual(problemsOf(repoRoot, dir), []);
  });

  it("rule 1: reports missing files", () => {
    const repoRoot = repo();
    put(repoRoot, "specs/01-demo/tasks/.keep", "");
    const found = messages(problemsOf(repoRoot, "specs/01-demo"));
    for (const message of ["missing README.md", "missing requirements.md", "missing action-required.md", "no task files in tasks/"]) {
      assert.ok(found.includes(message), message);
    }
  });

  it("rule 2: reports files in tasks/ that aren't task files", () => {
    const { repoRoot, dir } = build({ "task-01-first.md": task(), "notes.md": "hello" });
    assert.ok(messages(problemsOf(repoRoot, dir)).includes("unexpected file in tasks/: notes.md"));
  });

  it("rule 3: reports a duplicated task id", () => {
    const { repoRoot, dir } = build({ "task-01-first.md": task(), "task-01-other.md": task({ modify: ["src/b.ts"] }) });
    assert.ok(messages(problemsOf(repoRoot, dir)).includes("duplicate task id task-01"));
  });

  it("rule 4: reports a missing section and sections out of order, and skips the other task rules", () => {
    const missing = task({ status: "done" }).replace("## Notes\n\nNone.\n", "");
    const first = build({ "task-01-first.md": missing });
    const found = messages(problemsOf(first.repoRoot, first.dir));
    assert.equal(found.length, 1);
    assert.match(found[0], /^sections must be exactly: Status, Wave, Description, Dependencies, .*, Notes; found: Status, .*, Acceptance Criteria$/);
    const swapped = task().replace("## Wave", "## Tmp").replace("## Description", "## Wave").replace("## Tmp", "## Description");
    const second = build({ "task-01-first.md": swapped });
    assert.match(messages(problemsOf(second.repoRoot, second.dir))[0], /^sections must be exactly/);
  });

  it("rule 4: ignores a heading inside a code fence", () => {
    const text = task({ verification: "```md\n## Not a section\n```" });
    assert.deepEqual(splitSections(text).map((section) => section.title), SECTIONS);
    const { repoRoot, dir } = build({ "task-01-first.md": text });
    assert.deepEqual(problemsOf(repoRoot, dir), []);
  });

  it("rule 5: reports a status that isn't pending or complete", () => {
    const { repoRoot, dir } = build({ "task-01-first.md": task({ status: "done" }) });
    assert.ok(messages(problemsOf(repoRoot, dir)).includes('Status must be "pending" or "complete", found "done"'));
  });

  it("rule 6: reports a wave that isn't a whole number from 1", () => {
    for (const wave of ["one", "0", "1.5"]) {
      const { repoRoot, dir } = build({ "task-01-first.md": task({ wave }) });
      assert.ok(messages(problemsOf(repoRoot, dir)).includes(`Wave must be a whole number from 1, found "${wave}"`), wave);
    }
  });

  it("rule 7: reports a list line with commentary and a backticked command", () => {
    const text = task().replace("- `src/a.ts`", "- `src/a.ts` (the main file)\n- `npm run verify`");
    const { repoRoot, dir } = build({ "task-01-first.md": text });
    const found = messages(problemsOf(repoRoot, dir));
    assert.ok(found.includes('Files to Modify: "- `src/a.ts` (the main file)" isn\'t a "- `path`" line'));
    assert.ok(found.includes("Files to Modify: `npm run verify` isn't a path"));
  });

  it("rule 7: reports a path outside the repository", () => {
    const text = task().replace("- `src/a.ts`", "- `../shared/missing.ts`\n- `/etc/hosts`");
    const { repoRoot, dir } = build({ "task-01-first.md": text });
    const found = messages(problemsOf(repoRoot, dir));
    assert.ok(found.includes("Files to Modify: `../shared/missing.ts` isn't inside the repository"));
    assert.ok(found.includes("Files to Modify: `/etc/hosts` isn't inside the repository"));
  });

  it("rule 7: reports only the form problem for a line that is malformed and outside the repository", () => {
    const text = task().replace("- `src/a.ts`", "- `../shared/x.ts` and more");
    const { repoRoot, dir } = build({ "task-01-first.md": text });
    assert.deepEqual(messages(problemsOf(repoRoot, dir)), ['Files to Modify: "- `../shared/x.ts` and more" isn\'t a "- `path`" line']);
  });

  it("rule 7: reports a file list with no lines at all", () => {
    const text = task().replace("- `src/a.ts`\n", "");
    const { repoRoot, dir } = build({ "task-01-first.md": text });
    assert.deepEqual(messages(problemsOf(repoRoot, dir)), ["Files to Modify is empty: list its paths or write None"]);
  });

  it("rule 7: accepts None and - None as a whole section", () => {
    const text = task({ create: [] }).replace("## Files to Create\n\nNone.", "## Files to Create\n\n- None");
    const { repoRoot, dir } = build({ "task-01-first.md": text });
    assert.deepEqual(problemsOf(repoRoot, dir), []);
  });

  it("rule 8: reports a package.json without package-lock.json, and accepts both", () => {
    const bad = build({ "task-01-first.md": task({ modify: ["apps/agent/package.json"] }) });
    assert.ok(messages(problemsOf(bad.repoRoot, bad.dir)).includes("lists a package.json but not package-lock.json"));
    const good = build({ "task-01-first.md": task({ modify: ["apps/agent/package.json", "package-lock.json"] }) });
    assert.deepEqual(problemsOf(good.repoRoot, good.dir), []);
    const outside = build({ "task-01-first.md": task({ modify: ["../package.json"] }) });
    assert.deepEqual(messages(problemsOf(outside.repoRoot, outside.dir)), ["Files to Modify: `../package.json` isn't inside the repository"]);
  });

  it("rule 8: takes the lockfile from the config, and skips the rule when it's null", () => {
    const pnpm = build({ "task-01-first.md": task({ modify: ["package.json", "pnpm-lock.yaml"] }) });
    assert.deepEqual(formatProblems(pnpm.repoRoot, pnpm.spec, { lockfile: "pnpm-lock.yaml" }), []);
    assert.deepEqual(messages(formatProblems(pnpm.repoRoot, pnpm.spec)), ["lists a package.json but not package-lock.json"]);
    const none = build({ "task-01-first.md": task({ modify: ["package.json"] }) });
    assert.deepEqual(formatProblems(none.repoRoot, none.spec, { lockfile: null }), []);
  });

  it("rule 8: doesn't count a workspace's own lockfile as the repository's", () => {
    const { repoRoot, dir } = build({ "task-01-first.md": task({ modify: ["apps/agent/package.json", "apps/agent/package-lock.json"] }) });
    assert.deepEqual(messages(problemsOf(repoRoot, dir)), ["lists a package.json but not package-lock.json"]);
  });

  it("rule 9: reports a dependency on a later-wave task and on a missing task", () => {
    const tasks = {
      "task-01-first.md": task({ wave: 1, deps: "task-02" }),
      "task-02-second.md": task({ wave: 2, modify: ["src/b.ts"], deps: "task-07" }),
    };
    const { repoRoot, dir } = build(tasks);
    const found = messages(problemsOf(repoRoot, dir));
    assert.ok(found.includes("Dependencies: task-02 is in wave 2, not before this task's wave 1"));
    assert.ok(found.includes("Dependencies: task-07 isn't a task in this spec"));
  });

  it("rule 9: counts a task id inside a file name", () => {
    const tasks = {
      "task-01-first.md": task({ wave: 1, deps: "Reads `task-02-second.md`." }),
      "task-02-second.md": task({ wave: 2, modify: ["src/b.ts"] }),
    };
    const { repoRoot, dir } = build(tasks);
    assert.deepEqual(messages(problemsOf(repoRoot, dir)), ["Dependencies: task-02 is in wave 2, not before this task's wave 1"]);
  });

  it("rule 10: reports a Verification without a code block and an Acceptance Criteria without a list", () => {
    const text = task({ verification: "Run the tests." }).replace("- [ ] It works.", "It works.");
    const { repoRoot, dir } = build({ "task-01-first.md": text });
    const found = messages(problemsOf(repoRoot, dir));
    assert.ok(found.includes("Verification has no code block"));
    assert.ok(found.includes("Acceptance Criteria has no list items"));
  });

  it("rule 11: reports a README that misses a task, ticks wrongly or lacks a model tag", () => {
    const tasks = { "task-01-first.md": task({ status: "complete" }), "task-02-second.md": task({ modify: ["src/b.ts"] }) };
    const missing = build(tasks, readmeFor({ "task-01-first.md": task() }));
    const found = messages(problemsOf(missing.repoRoot, missing.dir));
    assert.ok(found.includes("README.md: task-01 is complete but its box isn't ticked"));
    assert.ok(found.includes("README.md doesn't list tasks/task-02-second.md"));

    const ticked = build({ "task-01-first.md": task() }, readmeFor({ "task-01-first.md": task() }).replace("- [ ]", "- [x]"));
    assert.ok(messages(problemsOf(ticked.repoRoot, ticked.dir)).includes("README.md: task-01 is pending but its box is ticked"));

    const untagged = build({ "task-01-first.md": task() }, readmeFor({ "task-01-first.md": task() }).replace(" (any model)", ""));
    assert.ok(messages(problemsOf(untagged.repoRoot, untagged.dir)).some((message) => message.includes("isn't a task line like")));
  });

  it("rule 11: reports a duplicated, a nonexistent and a mislabelled README task line", () => {
    const base = readmeFor({ "task-01-first.md": task() });
    const line = "- [ ] [task-01](tasks/task-01-first.md): Summary (any model)";
    const twice = build({ "task-01-first.md": task() }, base.replace(line, `${line}\n${line}`));
    assert.ok(messages(problemsOf(twice.repoRoot, twice.dir)).includes("README.md lists task-01 more than once"));
    const ghost = build({ "task-01-first.md": task() }, base.replace(line, `${line}\n- [ ] [task-09](tasks/task-09-ghost.md): Ghost (any model)`));
    assert.ok(messages(problemsOf(ghost.repoRoot, ghost.dir)).includes("README.md lists tasks/task-09-ghost.md, which doesn't exist"));
    const wrong = build({ "task-01-first.md": task() }, base.replace("[task-01](", "[task-02]("));
    assert.ok(messages(problemsOf(wrong.repoRoot, wrong.dir)).includes("README.md: link text task-02 doesn't match tasks/task-01-first.md"));
  });

  it("rule 11: reports a README with no mermaid graph, Written against line or sections", () => {
    const base = readmeFor({ "task-01-first.md": task() });
    const bare = build({ "task-01-first.md": task() }, base.replace("```mermaid", "```text").replace("**Written against:**", "Based on").replace("## Waves", "## Plan"));
    const found = messages(problemsOf(bare.repoRoot, bare.dir));
    assert.ok(found.includes("README.md has no mermaid graph"));
    assert.ok(found.includes("README.md has no Written against line"));
    assert.ok(found.includes("README.md has no Waves section"));
  });
});

describe("entriesOverlap", () => {
  const cases = [
    ["the same file", "src/a.ts", "src/a.ts", true],
    ["different files", "src/a.ts", "src/b.ts", false],
    ["a folder and a file inside it", "apps/agent/", "apps/agent/x.ts", true],
    ["a folder and a file that only shares a prefix", "apps/agent/", "apps/agentx.ts", false],
    ["nested folders", "apps/", "apps/agent/lib/", true],
    ["sibling folders", "apps/agent/", "apps/mobile/", false],
    ["a glob and a file it matches", "apps/agent/test/**/*.test.ts", "apps/agent/test/db/a.test.ts", true],
    ["a glob and a file it doesn't match", "apps/agent/test/**/*.test.ts", "apps/agent/test/support/temp-db.ts", false],
    ["a glob and a folder inside its prefix", "apps/agent/test/**/*.ts", "apps/agent/test/db/", true],
    ["a glob and a folder above its prefix", "apps/agent/test/**/*.ts", "apps/", true],
    ["a glob and an unrelated folder", "apps/agent/test/**/*.ts", "apps/mobile/", false],
    ["two globs that could meet", "apps/agent/**/*.ts", "apps/agent/test/*.mjs", true],
    ["two globs in different folders", "apps/agent/*.ts", "apps/mobile/*.ts", false],
    [
      "two Expo routes in one bracketed folder",
      "apps/mobile/src/app/(app)/bot/[botId]/index.tsx",
      "apps/mobile/src/app/(app)/bot/[botId]/routines.tsx",
      false,
    ],
    [
      "an Expo route with itself",
      "apps/mobile/src/app/(app)/bot/[botId]/index.tsx",
      "apps/mobile/src/app/(app)/bot/[botId]/index.tsx",
      true,
    ],
  ];
  for (const [name, a, b, expected] of cases) {
    it(`${name}: ${expected ? "overlap" : "no overlap"}`, () => {
      assert.equal(entriesOverlap(a, b), expected);
      assert.equal(entriesOverlap(b, a), expected);
    });
  }
});

describe("overlap between tasks", () => {
  it("reports two tasks in the same wave that share a file", () => {
    const { spec } = build({ "task-01-first.md": task(), "task-02-second.md": task() });
    const [problem, ...rest] = waveOverlaps(spec);
    assert.equal(rest.length, 0);
    assert.equal(problem.file, "specs/01-demo/tasks/task-01-first.md");
    assert.equal(problem.message, "task-01 and task-02 are both in wave 1 and both cover `src/a.ts` / `src/a.ts`");
  });

  it("allows the same file in different waves", () => {
    const { spec } = build({ "task-01-first.md": task(), "task-02-second.md": task({ wave: 2 }) });
    assert.deepEqual(waveOverlaps(spec), []);
  });

  it("reports pending tasks of two specs that share a file, and ignores complete ones", () => {
    const repoRoot = repo();
    writeSpec(repoRoot, "01-one", { "task-01-first.md": task() });
    writeSpec(repoRoot, "02-two", { "task-01-other.md": task() });
    const [one, two] = [readSpec(repoRoot, "specs/01-one"), readSpec(repoRoot, "specs/02-two")];
    assert.deepEqual(messages(acrossOverlaps(one, two)), [
      "specs/02-two task-01 also covers `src/a.ts` / `src/a.ts` (specs run in parallel must not share files)",
    ]);
    writeSpec(repoRoot, "02-two", { "task-01-other.md": task({ status: "complete" }) });
    assert.deepEqual(acrossOverlaps(one, readSpec(repoRoot, "specs/02-two")), []);
  });
});

describe("readiness", () => {
  it("reports a file to modify that doesn't exist", () => {
    const { repoRoot, spec } = build({ "task-01-first.md": task() });
    assert.deepEqual(messages(readinessProblems(repoRoot, spec)), [
      "task-01: Files to Modify lists `src/a.ts`, which doesn't exist and no earlier wave creates",
    ]);
  });

  it("accepts a file to modify that exists, and a folder that exists", () => {
    const repoRoot = repo();
    put(repoRoot, "src/a.ts", "");
    mkdirSync(join(repoRoot, "docs"));
    const dir = writeSpec(repoRoot, "01-demo", { "task-01-first.md": task({ modify: ["src/a.ts", "docs/"] }) });
    assert.deepEqual(readinessProblems(repoRoot, readSpec(repoRoot, dir)), []);
  });

  it("accepts a file that an earlier wave creates, but not one a later wave creates", () => {
    const earlier = build({
      "task-01-first.md": task({ modify: [], create: ["src/a.ts"] }),
      "task-02-second.md": task({ wave: 2, deps: "task-01", modify: ["src/a.ts"] }),
    });
    assert.deepEqual(readinessProblems(earlier.repoRoot, earlier.spec), []);
    const later = build({
      "task-01-first.md": task({ modify: ["src/a.ts"] }),
      "task-02-second.md": task({ wave: 2, deps: "task-01", modify: [], create: ["src/a.ts"] }),
    });
    assert.equal(readinessProblems(later.repoRoot, later.spec).length, 1);
  });

  it("reports a file to create that already exists", () => {
    const repoRoot = repo();
    put(repoRoot, "src/new.ts", "");
    const dir = writeSpec(repoRoot, "01-demo", { "task-01-first.md": task({ modify: [], create: ["src/new.ts"] }) });
    assert.deepEqual(messages(readinessProblems(repoRoot, readSpec(repoRoot, dir))), [
      "task-01: Files to Create lists `src/new.ts`, which already exists",
    ]);
  });

  it("reports a file to create that already exists as a folder", () => {
    const repoRoot = repo();
    put(repoRoot, "src/lib/a.ts", "");
    const dir = writeSpec(repoRoot, "01-demo", { "task-01-first.md": task({ modify: [], create: ["src/lib"] }) });
    assert.deepEqual(messages(readinessProblems(repoRoot, readSpec(repoRoot, dir))), [
      "task-01: Files to Create lists `src/lib`, which already exists",
    ]);
  });

  it("skips complete tasks", () => {
    const { repoRoot, spec } = build({ "task-01-first.md": task({ status: "complete" }) });
    assert.deepEqual(readinessProblems(repoRoot, spec), []);
  });
});

describe("command line", () => {
  function run(repoRoot, ...args) {
    const result = spawnSync(process.execPath, [CHECK, ...args], { cwd: repoRoot, encoding: "utf8" });
    return { code: result.status, out: result.stdout, err: result.stderr };
  }

  it("exits 0 with the summary on a valid repository", () => {
    const { repoRoot } = build({ "task-01-first.md": task(), "task-02-second.md": task({ wave: 2, deps: "task-01" }) });
    const result = run(repoRoot);
    assert.equal(result.code, 0);
    assert.equal(result.out, "spec-check: 1 spec(s), 2 tasks, no problems.\n");
  });

  it("exits 1 and prints file: message lines on a broken one", () => {
    const { repoRoot } = build({ "task-01-first.md": task({ status: "done" }) });
    const result = run(repoRoot);
    assert.equal(result.code, 1);
    assert.match(result.out, /^specs\/01-demo\/tasks\/task-01-first\.md: Status must be "pending" or "complete", found "done"$/m);
    assert.match(result.out, /spec-check: 1 problem\(s\)\.\n$/);
  });

  it("checks readiness only with --ready", () => {
    const { repoRoot } = build({ "task-01-first.md": task() });
    assert.equal(run(repoRoot).code, 0);
    const ready = run(repoRoot, "--ready", "specs/01-demo");
    assert.equal(ready.code, 1);
    assert.match(ready.out, /which doesn't exist and no earlier wave creates/);
  });

  it("checks two named specs against each other with --across", () => {
    const repoRoot = repo();
    writeSpec(repoRoot, "01-one", { "task-01-first.md": task() });
    writeSpec(repoRoot, "02-two", { "task-01-other.md": task() });
    const result = run(repoRoot, "--across", "specs/01-one", "specs/02-two");
    assert.equal(result.code, 1);
    assert.match(result.out, /specs run in parallel must not share files/);
  });

  it("exits 2 for --across with one spec, an unknown option and a missing folder", () => {
    const { repoRoot } = build({ "task-01-first.md": task() });
    const usage = "Usage: node tools/spec-check/check.mjs [--ready] [--across] [specs/NN-name ...]";
    for (const args of [["--across", "specs/01-demo"], ["--bogus"], ["specs/09-missing"]]) {
      const result = run(repoRoot, ...args);
      assert.equal(result.code, 2, args.join(" "));
      assert.ok(result.err.includes(usage), args.join(" "));
    }
  });

  it("reads the lockfile from agentkit.config.json at the root", () => {
    const { repoRoot } = build({ "task-01-first.md": task({ modify: ["package.json", "pnpm-lock.yaml"] }) });
    assert.equal(run(repoRoot).code, 1);
    writeFileSync(join(repoRoot, "agentkit.config.json"), JSON.stringify({ lockfile: "pnpm-lock.yaml" }));
    assert.equal(run(repoRoot).code, 0);
  });

  it("reports a broken agentkit.config.json as a problem, and exits 1", () => {
    const { repoRoot } = build({ "task-01-first.md": task() });
    writeFileSync(join(repoRoot, "agentkit.config.json"), JSON.stringify({ lockfile: 7 }));
    const result = run(repoRoot);
    assert.equal(result.code, 1);
    assert.match(result.out, /^agentkit\.config\.json: lockfile must be a file name or null$/m);
  });

  it("lists spec folders by name", () => {
    const repoRoot = repo();
    writeSpec(repoRoot, "02-two", { "task-01-a.md": task() });
    writeSpec(repoRoot, "01-one", { "task-01-a.md": task() });
    mkdirSync(join(repoRoot, "specs", "notes"));
    assert.deepEqual(specDirs(repoRoot), ["specs/01-one", "specs/02-two"]);
  });
});
