import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { COMMENTS_JQ, parseGhJson, pullRequestFacts, REVIEWS_JQ } from "../lib/github.mjs";
import { REVIEWER } from "./acme.mjs";

// GitHub, as gh answers the runner: what each call asks for, and canned answers to it.
const HEAD = "9f".padEnd(40, "0");
const at = (minute) => new Date(Date.UTC(2026, 9, 23, 10, minute)).toISOString();
const job = (name) => ({ __typename: "CheckRun", workflowName: "verify", name, status: "COMPLETED", conclusion: "SUCCESS" });
const REQUIRED = [
  { workflow: "verify", job: "verify" },
  { workflow: "verify", job: "image" },
];

function stubGh(answers) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    const endpoint = args[0] === "pr" ? "pr list" : args[1].replace(/\?.*$/, "");
    if (!(endpoint in answers)) throw new Error(`unexpected gh call: ${args.join(" ")}`);
    return answers[endpoint];
  };
  return { gh, calls };
}

describe("the pull request's facts, through gh", () => {
  const pr = { number: 41, headRefOid: HEAD, createdAt: at(0), statusCheckRollup: [job("verify"), job("image")], mergeable: "MERGEABLE" };

  it("asks gh for the PR by its branch, then its reviews, its conversation and its review threads", () => {
    const { gh, calls } = stubGh({
      "pr list": pr,
      "repos/acme/acme/pulls/41/reviews": [{ login: "acme-review-bot[bot]", state: "APPROVED", commit: HEAD, at: at(20) }],
      "repos/acme/acme/issues/41/comments": [],
      "repos/acme/acme/pulls/41/comments": [{ login: "ada", body: "Note 2 is on #42.", at: at(25) }],
    });
    const facts = pullRequestFacts({ branch: "build/spec-02-wave-02", required: REQUIRED, gh, repo: "acme/acme", reviewer: REVIEWER, now: Date.parse(at(30)) });
    assert.deepEqual(calls[0], ["pr", "list", "--repo", "acme/acme", "--head", "build/spec-02-wave-02", "--state", "open", "--json", "number,headRefOid,createdAt,statusCheckRollup,mergeable", "--jq", ".[0]"]);
    assert.deepEqual(calls.slice(1).map((args) => [args[1], args[3]]), [
      ["repos/acme/acme/pulls/41/reviews?per_page=100", REVIEWS_JQ],
      ["repos/acme/acme/issues/41/comments?per_page=100", COMMENTS_JQ],
      ["repos/acme/acme/pulls/41/comments?per_page=100", COMMENTS_JQ],
    ]);
    assert.deepEqual(facts.pr, { number: 41, conflicting: false });
    assert.equal(facts.ci, "pass");
    assert.equal(facts.review.state, "APPROVED");
    assert.equal(facts.review.onHead, true);
    assert.equal(facts.review.answered, true, "a reply in a review thread answers");
  });

  it("has no PR, review or CI when gh finds no open PR for the branch", () => {
    const { gh, calls } = stubGh({ "pr list": null });
    assert.deepEqual(pullRequestFacts({ branch: "build/x", required: REQUIRED, gh, repo: "acme/acme", reviewer: REVIEWER }), { pr: null, review: null, ci: "none" });
    assert.equal(calls.length, 1);
  });

  it("knows a conflicting PR", () => {
    const { gh } = stubGh({
      "pr list": { ...pr, mergeable: "CONFLICTING", statusCheckRollup: [] },
      "repos/acme/acme/pulls/41/reviews": [],
      "repos/acme/acme/issues/41/comments": [],
      "repos/acme/acme/pulls/41/comments": [],
    });
    const facts = pullRequestFacts({ branch: "b", required: REQUIRED, gh, repo: "acme/acme", reviewer: REVIEWER, now: Date.parse(at(5)) });
    assert.equal(facts.pr.conflicting, true);
    assert.equal(facts.ci, "none");
    assert.equal(facts.review.pending, true);
  });
});

describe("gh's printed JSON", () => {
  it("is null when gh printed nothing, a bare newline included, as `--jq '.[0]'` prints for a branch with no PR", () => {
    for (const blank of ["", "\n", "  \n", undefined]) assert.equal(parseGhJson(blank), null);
  });

  it("parses what gh printed, its trailing newline included", () => {
    assert.equal(parseGhJson("null\n"), null);
    assert.deepEqual(parseGhJson('{"number":41}\n'), { number: 41 });
    assert.deepEqual(parseGhJson("[]\n"), []);
  });

  it("still throws on output that isn't JSON, so the runner counts a real failure", () => {
    assert.throws(() => parseGhJson("gh: Not Found\n"), SyntaxError);
  });
});

describe("gh's --jq filters, on GitHub's own answers", () => {
  const jq = (filter, value) => {
    const result = spawnSync("jq", ["-c", filter], { input: JSON.stringify(value), encoding: "utf8" });
    return result.error ? undefined : JSON.parse(result.stdout);
  };
  const hasJq = spawnSync("jq", ["--version"]).status === 0;

  it("reduces a review to its login, state, commit and time", { skip: !hasJq && "no jq here" }, () => {
    const raw = [{ id: 1, user: { login: "acme-review-bot[bot]", type: "Bot" }, state: "APPROVED", commit_id: HEAD, submitted_at: at(20), body: "## Verdict" }];
    assert.deepEqual(jq(REVIEWS_JQ, raw), [{ login: "acme-review-bot[bot]", state: "APPROVED", commit: HEAD, at: at(20) }]);
  });

  it("reduces a comment, in the conversation or a thread, to its login, body and time", { skip: !hasJq && "no jq here" }, () => {
    const raw = [{ id: 2, user: { login: "ada" }, body: "/review", created_at: at(21), path: "a.ts", line: 3 }];
    assert.deepEqual(jq(COMMENTS_JQ, raw), [{ login: "ada", body: "/review", at: at(21) }]);
  });
});
