// Which CI jobs a pull request must pass before it merges: agentkit.config.json's ci.requiredJobs. They become
// required once the default branch has the CI workflow (ci.workflowFile); before that there's no CI to wait for.
// GitHub names an Actions check run after its job id and reports the workflow's name separately (seen on 2026-10-21 in
// a probe pull request), so a required check is a workflow and job pair.
import { spawnSync } from "node:child_process";

/** The jobs a merge must wait for, read from origin's default branch after fetching it. */
export function requiredChecks(cwd, config) {
  const branch = config.defaultBranch;
  const fetched = spawnSync("git", ["fetch", "--quiet", "origin", branch], { cwd, encoding: "utf8" });
  if (fetched.status !== 0) throw new Error(`git fetch origin ${branch} failed: ${(fetched.stderr || fetched.error?.message || "").trim()}`);
  const onBranch = spawnSync("git", ["cat-file", "-e", `origin/${branch}:${config.ci.workflowFile}`], { cwd, stdio: "ignore" }).status === 0;
  return onBranch ? config.ci.requiredJobs : [];
}
