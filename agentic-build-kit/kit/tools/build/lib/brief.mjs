// The builder's brief for one wave. It points at AGENTS.md, restating only the rules a wave run leans on hardest, and
// adds what a wave run needs: its tasks, its branch, its pull request and when to stop. The project, the repository,
// the reviewer bot and the default branch come from agentkit.config.json, through the runner.
import { REVIEW_WAIT_MS } from "./wave.mjs";

const WAIT_MINUTES = REVIEW_WAIT_MS / 60_000;

/** The first message a wave's builder gets. `reviewer` is { login, name, trigger }. */
export function waveBrief({ specDir, wave, branch, tasks, specNumber, project, repo, reviewer, defaultBranch }) {
  const list = tasks.map((task) => `- ${task.id}: ${task.file}`).join("\n");
  return [
    `You're building wave ${wave} of ${specDir} in ${project}, unattended, on branch ${branch} in this checkout. Nobody will answer questions: decide from the files, or write BLOCKED.md.`,
    "",
    "Read AGENTS.md first, then follow its work loop for each task, in this order:",
    list,
    "",
    `Each task is one commit, verified with node tools/guardrails/verify.mjs and pushed (git push -u origin ${branch} the first time). Never run a command that doesn't return on its own, such as a dev server or tests in watch mode: the runner stops a command that runs past 10 minutes, or 30 for installs, builds and tests.`,
    "",
    "Change only files the wave's tasks list, between tasks and during review too, apart from the work loop's own bookkeeping: each task's Status, its box in the spec's README, its ledger row, BLOCKED.md and specs/.current-task.",
    "The ledger rows are the wave's record: don't edit docs/log.md or docs/STATUS.md unless a task lists them, since the lead updates them when the wave merges. A task that lists them gets exactly the edits it specifies.",
    "If a review note needs a file no task lists, don't change it, even for a bug: answer the note, say it's for the lead, and leave the change to the lead.",
    "",
    "After the last task:",
    `1. Open one pull request into ${defaultBranch} with gh: title "build(spec-${specNumber}): wave ${wave}", and a body listing each task, what you verified and anything a reviewer should look at closely. Not a draft. Never merge it.`,
    `2. The reviewer bot, ${reviewer.login}, reviews it within minutes. Wait for that review: check gh api repos/${repo}/pulls/<number>/reviews every minute. If none has come in ${WAIT_MINUTES} minutes, comment ${reviewer.trigger} once more and keep waiting.`,
    `3. Then follow AGENTS.md's Pull requests rules to the letter. Notes in an approving review need answers too. Check each point before acting on it. After each push, comment ${reviewer.trigger}, and keep going until the bot approves.`,
    "   From the fourth review on, change code only for correctness, security and data bugs, and only in files the wave's tasks list.",
    "   Answer every other note in a comment saying it's deferred, and list it under what you deferred in your last message, without changing code or filing issues (the lead files them): each change is new code for the next review, so the loop only ends when the changes stop.",
    `4. Stop when ${reviewer.name}'s latest review approves your PR's head, every note in it has an answer, and CI has passed on the head. Your last message: the PR's URL, the commits, the test counts, and what you deferred and where.`,
    "",
    "If a stop condition in AGENTS.md applies, write BLOCKED.md as it says and stop.",
  ].join("\n");
}

/** The message that sends a stopped builder back to work. */
export function nudgeMessage(reason, { restarted = false } = {}) {
  const why = restarted ? "You stopped responding for 10 minutes, so you were restarted." : "You stopped before the wave was finished.";
  return `${why} ${reason} Then carry on with your brief until its stop condition holds, or write BLOCKED.md.`;
}
