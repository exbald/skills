#!/usr/bin/env node
// Merges a pull request only when the reviewer bot approved its current head commit and CI passed on it
// (AGENTS.md, Pull requests). The bot and the required CI jobs come from agentkit.config.json (reviewer, ci). It
// makes a merge commit and passes the approved commit to GitHub, so a push between the check and the merge makes
// the merge fail instead of landing unreviewed code.
// Usage: node tools/guardrails/merge-approved.mjs <pull request number>
import { spawnSync } from "node:child_process";
import { requiredChecks } from "./lib/ci.mjs";
import { readConfig } from "./lib/config.mjs";
import { mergeBlocker } from "./lib/merge.mjs";

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function reviewsOf(number) {
  const jq = ".[] | {login: .user.login, state: .state, commit: .commit_id, at: .submitted_at}";
  return gh(["api", "--paginate", `repos/{owner}/{repo}/pulls/${number}/reviews`, "--jq", jq])
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function repositoryRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("run it inside the repository.");
  return result.stdout.trim();
}

function main(number) {
  if (!/^\d+$/.test(number ?? "")) throw new Error("Usage: node tools/guardrails/merge-approved.mjs <pull request number>");
  const root = repositoryRoot();
  const config = readConfig(root);
  const fields = "state,isDraft,mergeable,headRefOid,url,statusCheckRollup";
  const pr = { number, requiredChecks: requiredChecks(root, config), ...JSON.parse(gh(["pr", "view", number, "--json", fields])) };
  const blocker = mergeBlocker(pr, reviewsOf(number), config.reviewer);
  if (blocker) throw new Error(blocker);
  gh(["pr", "merge", number, "--merge", "--match-head-commit", pr.headRefOid]);
  process.stdout.write(`Merged ${pr.url} at ${pr.headRefOid.slice(0, 7)}.\n`);
}

try {
  main(process.argv[2]);
} catch (error) {
  console.error(`Not merged: ${error.message}`);
  process.exitCode = 1;
}
