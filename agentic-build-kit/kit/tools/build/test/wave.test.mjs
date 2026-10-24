import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { isWaiting, MAX_NUDGES, MAX_REVIEW_ROUNDS, nextStep, outsideLists, porcelainPaths, REVIEW_WAIT_MS, specNumber, waveBranch, waveOutcome as outcomeOf, waveTasks, worktreePath } from "../lib/wave.mjs";
import { REVIEWER } from "./acme.mjs";

// A spec of its own, so renaming a real spec's task never breaks these tests.
const taskFile = (n, wave, files) =>
  [`# Task 0${n}: demo`, "", "## Status", "", "pending", "", "## Wave", "", String(wave), "", "## Description", "", "Demo.", "", "## Dependencies", "", "None", "", "## Files to Modify", "", ...files.map((file) => `- \`${file}\``), "", "## Files to Create", "", "None", ""].join("\n");
let ROOT;
const complete = (...ids) => ids.map((id) => ({ id, status: "complete" }));
const approved = { state: "APPROVED", onHead: true, pending: false, answered: true, rounds: 2, waitedMs: 0 };
// The messages name agentkit.config.json's reviewer bot and default branch.
const waveOutcome = (facts, words = { reviewer: REVIEWER, defaultBranch: "main" }) => outcomeOf(facts, words);
const facts = (overrides = {}) => ({ tasks: complete("task-01", "task-02"), blocked: false, dirty: false, unpushed: false, pr: { number: 41 }, review: approved, ci: "pass", ...overrides });

describe("a wave's tasks, branch and checkout", () => {
  before(() => {
    ROOT = mkdtempSync(join(tmpdir(), "run-wave-test-"));
    mkdirSync(join(ROOT, "specs/09-demo/tasks"), { recursive: true });
    writeFileSync(join(ROOT, "specs/09-demo/tasks/task-01-first.md"), taskFile(1, 1, ["apps/agent/agent/a.ts"]));
    writeFileSync(join(ROOT, "specs/09-demo/tasks/task-02-second.md"), taskFile(2, 2, ["apps/mobile/src/cards/Card.tsx"]));
    writeFileSync(join(ROOT, "specs/09-demo/tasks/task-03-third.md"), taskFile(3, 2, ["docs/notes/"]));
  });
  after(() => rmSync(ROOT, { recursive: true, force: true }));

  it("reads the wave's tasks from the spec, in order, with their file lists", () => {
    const tasks = waveTasks(ROOT, "specs/09-demo", 2);
    assert.deepEqual(tasks.map((task) => task.id), ["task-02", "task-03"]);
    assert.equal(tasks[0].file, "specs/09-demo/tasks/task-02-second.md");
    assert.deepEqual(tasks[0].entries, ["apps/mobile/src/cards/Card.tsx"]);
    assert.deepEqual(tasks[1].entries, ["docs/notes/"]);
  });

  it("finds what a branch changed outside every task's lists, as the guard reads them", () => {
    const tasks = [
      { id: "task-01", file: "specs/09-demo/tasks/task-01-a.md", entries: ["apps/agent/agent/lib/a.ts", "apps/agent/test/a.test.ts", "docs/notes/"] },
      { id: "task-02", file: "specs/09-demo/tasks/task-02-b.md", entries: ["apps/mobile/src/**/*.tsx"] },
    ];
    const changed = [
      "apps/agent/agent/lib/a.ts",
      "apps/agent/test/a.test.ts",
      "docs/notes/x.md",
      "apps/mobile/src/cards/Card.tsx",
      "specs/09-demo/tasks/task-01-a.md",
      "specs/09-demo/README.md",
      "specs/LEDGER.md",
      "apps/agent/agent/lib/other.ts",
      "docs/notes/sneaky.test.ts",
    ];
    assert.deepEqual(outsideLists("specs/09-demo", tasks, changed), ["apps/agent/agent/lib/other.ts", "docs/notes/sneaky.test.ts"]);
  });

  it("counts docs/log.md and docs/STATUS.md as in scope when a task lists them, and only then", () => {
    const tasks = [{ id: "task-24", file: "specs/09-demo/tasks/task-24-docs.md", entries: ["docs/log.md", "docs/STATUS.md"] }];
    assert.deepEqual(outsideLists("specs/09-demo", tasks, ["docs/log.md", "docs/STATUS.md"]), []);
    const others = [{ id: "task-23", file: "specs/09-demo/tasks/task-23-fixes.md", entries: ["apps/agent/agent/lib/a.ts"] }];
    assert.deepEqual(outsideLists("specs/09-demo", others, ["docs/log.md"]), ["docs/log.md"]);
  });

  it("names the branch after the spec and the wave", () => {
    assert.equal(waveBranch("specs/02-app-api", 1), "build/spec-02-wave-01");
    assert.equal(waveBranch("specs/12-login-card/", 10), "build/spec-12-wave-10");
    assert.throws(() => waveBranch("specs/app-api", 1), /isn't a spec folder/);
    assert.throws(() => waveBranch("specs/02-app-api", 0), /isn't a wave number/);
  });

  it("reads the spec's number from its folder", () => {
    assert.equal(specNumber("specs/03-mobile-chat"), "03");
    assert.throws(() => specNumber("specs/mobile"), /isn't a spec folder/);
  });

  it("reads every path git status reports, both ends of a rename included", () => {
    const output = [" M apps/agent/agent/a.ts", "?? docs/notes/new file.md", "R  apps/new.ts", "apps/old.ts", "A  specs/LEDGER.md", ""].join("\0");
    assert.deepEqual(porcelainPaths(output), ["apps/agent/agent/a.ts", "docs/notes/new file.md", "apps/new.ts", "apps/old.ts", "specs/LEDGER.md"]);
    assert.deepEqual(porcelainPaths(""), []);
  });

  it("puts the checkout beside the repository, never inside it", () => {
    assert.equal(worktreePath("/work/acme", "build/spec-02-wave-01"), "/work/acme-builds/build-spec-02-wave-01");
  });
});

describe("where a wave stands when its builder stops", () => {
  it("is done once every task is complete and pushed, and the reviewer bot's approval of the head is answered and green", () => {
    assert.equal(waveOutcome(facts()).kind, "done");
  });

  it("stops at BLOCKED.md, before anything else", () => {
    assert.equal(waveOutcome(facts({ blocked: true, tasks: [{ id: "task-01", status: "pending" }] })).kind, "blocked");
  });

  it("sends the builder back to the first open task", () => {
    const outcome = waveOutcome(facts({ tasks: [...complete("task-01"), { id: "task-02", status: "pending" }, { id: "task-03", status: "pending" }] }));
    assert.equal(outcome.kind, "nudge");
    assert.match(outcome.reason, /task-02, task-03 aren't complete.*with task-02/);
  });

  it("sends the builder back to undo changes no task lists, before it's told to commit them", () => {
    const outcome = waveOutcome(facts({ outside: ["apps/agent/agent/lib/other.ts"], dirty: true }));
    assert.equal(outcome.kind, "nudge");
    assert.match(outcome.reason, /apps\/agent\/agent\/lib\/other\.ts, which no task in this wave lists/);
  });

  it("sends it back to commit and push, then to open the pull request", () => {
    assert.match(waveOutcome(facts({ dirty: true })).reason, /committed and pushed/);
    assert.match(waveOutcome(facts({ unpushed: true })).reason, /committed and pushed/);
    assert.match(waveOutcome(facts({ pr: null })).reason, /no pull request/);
  });

  it("sends the builder back to merge main when its pull request conflicts, since CI can't run", () => {
    const outcome = waveOutcome(facts({ pr: { number: 41, conflicting: true }, ci: "none" }));
    assert.equal(outcome.kind, "nudge");
    assert.match(outcome.reason, /conflicts with main/);
  });

  it("waits while the reviewer bot reviews, and asks again after 30 minutes", () => {
    assert.equal(waveOutcome(facts({ review: { ...approved, pending: true, waitedMs: 60_000 } })).kind, "await");
    assert.equal(waveOutcome(facts({ review: null })).kind, "await");
    assert.match(waveOutcome(facts({ review: { ...approved, pending: true, waitedMs: REVIEW_WAIT_MS + 1 } })).reason, /Comment \/review once/);
  });

  it("sends the builder back to act on a review that isn't an approval, or that's of an older push", () => {
    assert.match(waveOutcome(facts({ review: { ...approved, state: "CHANGES_REQUESTED" } })).reason, /CHANGES_REQUESTED.*answer every point/);
    assert.match(waveOutcome(facts({ review: { ...approved, state: "COMMENTED" } })).reason, /COMMENTED/);
    assert.match(waveOutcome(facts({ review: { ...approved, onHead: false } })).reason, /latest push/);
    assert.match(waveOutcome(facts({ review: { ...approved, state: "DISMISSED" } })).reason, /dismissed\. Comment \/review once/);
  });

  it("doesn't count an approval as done until its notes have an answer", () => {
    const outcome = waveOutcome(facts({ review: { ...approved, answered: false } }));
    assert.equal(outcome.kind, "nudge");
    assert.match(outcome.reason, /Answer each note/);
  });

  it("hands the lead a review it can't date, as merge-approved.mjs would refuse it", () => {
    assert.equal(waveOutcome(facts({ review: { ...approved, unreadable: true } })).kind, "escalate");
  });

  it("hands a review loop that won't converge to the lead", () => {
    assert.equal(waveOutcome(facts({ review: { ...approved, state: "CHANGES_REQUESTED", rounds: MAX_REVIEW_ROUNDS } })).kind, "escalate");
    assert.equal(waveOutcome(facts({ review: { ...approved, rounds: MAX_REVIEW_ROUNDS + 3 } })).kind, "done");
  });

  it("words its messages with the config's reviewer bot and default branch", () => {
    const words = { reviewer: { login: "muse-bot", name: "Muse", trigger: "/muse" }, defaultBranch: "trunk" };
    assert.equal(waveOutcome(facts({ review: { ...approved, pending: true, waitedMs: 60_000 } }), words).reason, "Waiting for Muse's review of PR #41.");
    assert.match(waveOutcome(facts({ review: { ...approved, onHead: false } }), words).reason, /^Muse hasn't reviewed your latest push to PR #41\. Comment \/muse once/);
    assert.match(waveOutcome(facts({ pr: { number: 41, conflicting: true }, ci: "none" }), words).reason, /conflicts with trunk.*Merge origin\/trunk into your branch.*comment \/muse once/);
    assert.match(waveOutcome(facts({ review: { ...approved, onHead: false } })).reason, /^The review bot hasn't reviewed your latest push/, "a name like \"the review bot\" starts a sentence with a capital");
  });

  it("waits for CI, and sends the builder back when it fails", () => {
    assert.equal(waveOutcome(facts({ ci: "pending" })).kind, "await");
    assert.equal(waveOutcome(facts({ ci: "none" })).kind, "await");
    assert.match(waveOutcome(facts({ ci: "fail" })).reason, /CI failed/);
  });
});

describe("a builder waiting on someone else", () => {
  it("is waiting while its PR waits on the reviewer bot (for up to 30 minutes) or on CI, and not otherwise", () => {
    const pr = { number: 41, conflicting: false };
    assert.equal(isWaiting({ pr, review: { pending: true, waitedMs: 60_000 }, ci: "pass" }), true);
    assert.equal(isWaiting({ pr, review: { pending: true, waitedMs: REVIEW_WAIT_MS + 1 }, ci: "pass" }), false);
    assert.equal(isWaiting({ pr, review: approved, ci: "pending" }), true, "CI running");
    assert.equal(isWaiting({ pr, review: approved, ci: "none" }), true, "CI not started yet");
    assert.equal(isWaiting({ pr: { ...pr, conflicting: true }, review: approved, ci: "none" }), false, "a conflict starts no CI");
    assert.equal(isWaiting({ pr, review: approved, ci: "pass" }), false);
    assert.equal(isWaiting({ pr: null, review: null, ci: "none" }), false);
  });
});

describe("how many nudges", () => {
  it("nudges up to the cap, then hands the wave to the lead", () => {
    const nudge = { kind: "nudge", reason: "task-02 isn't complete." };
    assert.equal(nextStep(nudge, MAX_NUDGES - 1).kind, "nudge");
    const step = nextStep(nudge, MAX_NUDGES);
    assert.equal(step.kind, "escalate");
    assert.match(step.reason, /task-02 isn't complete/);
    assert.equal(nextStep({ kind: "done", reason: "" }, MAX_NUDGES).kind, "done");
  });
});
