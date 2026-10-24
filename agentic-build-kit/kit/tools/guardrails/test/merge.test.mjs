import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isReviewer, mergeBlocker as decide } from "../lib/merge.mjs";

// agentkit.config.json's reviewer, as merge-approved.mjs passes it.
const REVIEWER = Object.freeze({ login: "acme-review-bot", name: "the review bot", trigger: "/review" });
const mergeBlocker = (pr, reviews) => decide(pr, reviews, REVIEWER);
const HEAD = "518381ea37aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD = "60b020fd67bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const pr = (overrides = {}) => ({ number: "7", state: "OPEN", isDraft: false, mergeable: "MERGEABLE", headRefOid: HEAD, ...overrides });
const review = (state, commit = HEAD, at = "2026-10-21T11:00:00Z", login = "acme-review-bot") => ({ login, state, commit, at });

describe("mergeBlocker", () => {
  it("allows a merge when the bot's latest review approves the current head", () => {
    assert.equal(mergeBlocker(pr(), [review("CHANGES_REQUESTED", OLD, "2026-10-21T10:00:00Z"), review("APPROVED")]), null);
  });

  it("accepts the bot's login with GitHub's [bot] suffix", () => {
    assert.equal(mergeBlocker(pr(), [review("APPROVED", HEAD, "2026-10-21T11:00:00Z", "acme-review-bot[bot]")]), null);
  });

  it("blocks when the bot hasn't reviewed", () => {
    assert.match(mergeBlocker(pr(), []), /hasn't reviewed/);
  });

  it("ignores approvals from anyone else", () => {
    assert.match(mergeBlocker(pr(), [review("APPROVED", HEAD, "2026-10-21T11:00:00Z", "alex")]), /hasn't reviewed/);
  });

  it("goes by the latest review, whatever order GitHub returns them in", () => {
    const reviews = [review("CHANGES_REQUESTED", HEAD, "2026-10-21T12:00:00Z"), review("APPROVED", HEAD, "2026-10-21T11:00:00Z")];
    assert.match(mergeBlocker(pr(), reviews), /CHANGES_REQUESTED/);
  });

  it("orders reviews by time when their timestamps differ in precision", () => {
    const reviews = [review("APPROVED", HEAD, "2026-10-21T11:00:00.500Z"), review("CHANGES_REQUESTED", HEAD, "2026-10-21T11:00:00Z")];
    assert.equal(mergeBlocker(pr(), reviews), null);
  });

  it("blocks when one of the bot's reviews has no time, since the latest can't be told", () => {
    const reviews = [review("APPROVED"), review("CHANGES_REQUESTED", HEAD, null)];
    assert.match(mergeBlocker(pr(), reviews), /no submission time/);
  });

  it("blocks when the latest review is a comment", () => {
    assert.match(mergeBlocker(pr(), [review("APPROVED", HEAD, "2026-10-21T10:00:00Z"), review("COMMENTED")]), /COMMENTED/);
  });

  it("blocks an approval of an older commit and says to ask for a new review with the configured trigger", () => {
    assert.match(mergeBlocker(pr(), [review("APPROVED", OLD)]), /Comment \/review for a review of the new head/);
  });

  it("refuses to merge when the config names no reviewer bot, since no approval could count", () => {
    assert.match(decide(pr(), [review("APPROVED")], { ...REVIEWER, login: null }), /names no reviewer bot \(reviewer\.login\)/);
  });

  it("knows the reviewer by its login, with or without [bot] on either side", () => {
    assert.equal(isReviewer("acme-review-bot[bot]", "acme-review-bot"), true);
    assert.equal(isReviewer("acme-review-bot", "acme-review-bot[bot]"), true);
    assert.equal(isReviewer("acme-review-bot-2", "acme-review-bot"), false);
    assert.equal(isReviewer(undefined, "acme-review-bot"), false);
    assert.equal(isReviewer("acme-review-bot", null), false);
  });

  it("blocks pull requests that aren't open, or are drafts", () => {
    assert.match(mergeBlocker(pr({ state: "MERGED" }), [review("APPROVED")]), /merged, not open/);
    assert.match(mergeBlocker(pr({ isDraft: true }), [review("APPROVED")]), /draft/);
  });

  it("blocks conflicts, and asks to wait while GitHub is still checking", () => {
    assert.match(mergeBlocker(pr({ mergeable: "CONFLICTING" }), [review("APPROVED")]), /conflicts with its base \(CONFLICTING\)/);
    assert.match(mergeBlocker(pr({ mergeable: "UNKNOWN" }), [review("APPROVED")]), /still checking.*\(mergeable: UNKNOWN\)/);
  });

  it("treats a missing or unexpected mergeable value as still checking, and names the value", () => {
    assert.match(mergeBlocker(pr({ mergeable: undefined }), [review("APPROVED")]), /still checking.*\(mergeable: undefined\)/);
    assert.match(mergeBlocker(pr({ mergeable: "SOMETHING_NEW" }), [review("APPROVED")]), /still checking.*\(mergeable: SOMETHING_NEW\)/);
  });

  it("blocks when GitHub returns no head commit", () => {
    assert.match(mergeBlocker(pr({ headRefOid: null }), [review("APPROVED")]), /head commit/);
  });
});

describe("mergeBlocker and CI checks", () => {
  // Shaped like gh pr view --json statusCheckRollup: Actions names a check run after its job id.
  const run = (name, conclusion, status = "COMPLETED", workflowName = "verify") => ({ __typename: "CheckRun", name, workflowName, status, conclusion });
  const REQUIRED = [{ workflow: "verify", job: "verify" }, { workflow: "verify", job: "image" }];
  const approved = [review("APPROVED")];
  const blocker = (checks, requiredChecks = REQUIRED) => mergeBlocker(pr({ statusCheckRollup: checks, requiredChecks }), approved);

  it("allows a merge when the required jobs succeeded and other checks passed or were skipped", () => {
    assert.equal(blocker([run("verify", "SUCCESS"), run("image", "SUCCESS"), run("docs", "SKIPPED", "COMPLETED", "docs")]), null);
  });

  it("allows a merge with no checks while main has no CI workflow", () => {
    assert.equal(blocker([], []), null);
  });

  it("blocks when a required job hasn't started on the head", () => {
    assert.match(blocker([run("verify", "SUCCESS")]), /no verify \/ image check yet/);
  });

  it("doesn't let another workflow's job of the same name stand in for a required one", () => {
    assert.match(blocker([run("verify", "SUCCESS"), run("image", "SUCCESS", "COMPLETED", "release")]), /no verify \/ image check yet/);
  });

  it("blocks while a check is still running", () => {
    assert.match(blocker([run("verify", null, "IN_PROGRESS"), run("image", "SUCCESS")]), /still running.*verify/);
  });

  it("blocks when a check failed, naming it", () => {
    assert.match(blocker([run("verify", "FAILURE"), run("image", "SUCCESS")]), /CI failed.*verify/);
  });

  it("counts cancelled, timed-out and stale checks as failed", () => {
    for (const conclusion of ["CANCELLED", "TIMED_OUT", "STALE"]) {
      assert.match(blocker([run("verify", "SUCCESS"), run("image", conclusion)]), /CI failed.*image/);
    }
  });

  it("blocks when a required job was skipped, since that proves nothing", () => {
    assert.match(blocker([run("verify", "SUCCESS"), run("image", "SKIPPED")]), /didn't run verify \/ image to success/);
  });

  it("reads commit statuses as well as check runs", () => {
    const pending = [{ __typename: "StatusContext", context: "deploy/preview", state: "PENDING" }];
    const failed = [{ __typename: "StatusContext", context: "deploy/preview", state: "ERROR" }];
    assert.match(blocker(pending, []), /still running.*deploy\/preview/);
    assert.match(blocker(failed, []), /CI failed.*deploy\/preview/);
  });

  it("checks the review before CI, so an unapproved PR says so first", () => {
    const checks = [run("verify", "FAILURE")];
    assert.match(mergeBlocker(pr({ statusCheckRollup: checks }), [review("CHANGES_REQUESTED")]), /CHANGES_REQUESTED/);
  });
});
