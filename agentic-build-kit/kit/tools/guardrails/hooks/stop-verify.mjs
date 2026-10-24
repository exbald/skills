#!/usr/bin/env node
// Stop hook. While specs/.current-task names a task, the session may end only when the task is
// blocked (its spec has a BLOCKED.md) or complete, committed, verified on exactly what was
// committed (specs/.verified matches HEAD^{tree}) and pushed. After 10 blocks in a row it lets the
// session stop anyway, with a warning, so a hook problem can't trap an agent forever.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { changedPaths, currentBranch, headTree, repoRoot, upstreamStatus } from "../lib/git.mjs";
import { blockStop, isEvent, readHookInput, runHook } from "../lib/io.mjs";
import { readBlockCount, readStamp, resetBlockCount, writeBlockCount } from "../lib/state.mjs";
import { activeTask, isComplete, taskStatus } from "../lib/task.mjs";

const MAX_CONSECUTIVE_BLOCKS = 10;
const VERIFY = "node tools/guardrails/verify.mjs";

await runHook("stop-verify", async () => {
  const input = await readHookInput();
  if (!isEvent(input, "Stop")) return;
  const root = taskRoot([input.cwd || process.cwd(), process.env.CLAUDE_PROJECT_DIR]);
  if (!root) return;
  const problem = stopProblem(root);
  if (!problem) {
    resetBlockCount(root);
    return;
  }
  const blocks = readBlockCount(root);
  if (blocks >= MAX_CONSECUTIVE_BLOCKS) {
    resetBlockCount(root);
    console.error(`guardrails stop-verify: blocked ${blocks} times in a row, so letting the session stop. Still open: ${problem}`);
    return;
  }
  writeBlockCount(root, blocks + 1);
  blockStop(problem);
});

/**
 * The repository whose task decides: the session's directory, or the project directory when the
 * session has moved somewhere without an active task (Claude Code and ZCode set CLAUDE_PROJECT_DIR).
 */
function taskRoot(directories) {
  const roots = directories.filter(Boolean).map((dir) => repoRoot(dir)).filter(Boolean);
  return roots.find((root) => activeTask(root) !== null) ?? roots[0] ?? null;
}

function stopProblem(root) {
  const task = activeTask(root);
  if (!task || existsSync(join(root, task.specDir, "BLOCKED.md"))) return null;
  const status = taskStatus(task.text);
  if (!isComplete(status)) {
    return (
      `Task ${task.path} is not finished (Status: ${status || "missing"}). Finish it: set its ## Status to complete, ` +
      `tick its box in ${task.specDir}/README.md, add its row to specs/LEDGER.md, run ${VERIFY} until it passes, ` +
      `make one commit and push it. If you can't finish, write ${task.specDir}/BLOCKED.md ` +
      "(what you were doing, what failed, what you tried, what would unblock it) and stop."
    );
  }
  return deliveryProblem(root, task);
}

function deliveryProblem(root, task) {
  const changes = changedPaths(root);
  if (changes === null) return null;
  if (changes.length > 0) {
    const listed = changes.slice(0, 10).join("\n");
    return `Task ${task.path} is marked complete, but these changes are not committed:\n${listed}\nCommit the task's work in one commit after ${VERIFY} passes on it, remove stray files, then push.`;
  }
  const stamp = readStamp(root);
  if (!stamp || stamp.tree !== headTree(root)) {
    const why = stamp ? "it was run on a different tree" : "there is no specs/.verified stamp";
    return `Verification did not run on exactly what was committed (${why}). Run ${VERIFY} again, then commit any fixes it needs and push.`;
  }
  const { upstream, ahead } = upstreamStatus(root);
  const branch = currentBranch(root) ?? "HEAD";
  if (!upstream) return `Branch ${branch} has no upstream, so the task's commit isn't pushed. Push it: git push -u origin ${branch}.`;
  if (ahead > 0) return `Branch ${branch} has ${ahead} commit(s) that are not pushed to ${upstream}. Push them: git push.`;
  return null;
}
