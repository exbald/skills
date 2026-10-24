// The decisions inside deploy-approved.mjs, whatever the deploy target: how a release is tagged with its commit,
// which commit a rollback takes its settings from, whether anything that ships changed, and whether the health route
// came back. The script does the git and network work; the target's own work (reading what runs, building,
// releasing, rolling back) is its adapter's. lib/deploy-fly.mjs is the worked example.
const isText = (value) => typeof value === "string" && value !== "";

/**
 * A tag naming the branch, the full commit and the time, e.g. main-<40 hex>-20261021-121500, so whatever runs tells
 * what's deployed. A branch name is cut to what an image tag allows.
 */
export function imageLabel(sha, now = new Date(), branch = "main") {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Expected a full commit hash, got ${JSON.stringify(sha)}.`);
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `${String(branch).replace(/[^A-Za-z0-9_.-]/g, "-")}-${sha}-${stamp}`;
}

/** The commit an imageLabel tag names, or null for a release this script didn't tag (deployment-…, a short hash). */
export function commitOfImage(image) {
  return /:(?:[A-Za-z0-9_.-]+-)?([0-9a-f]{40})-\d{8}-\d{6}$/.exec(String(image))?.[1] ?? null;
}

/**
 * The commit whose settings a rollback to `before` uses: the one its tag names, if git has it. null means there's
 * none to use, and the rollback takes the default branch's settings instead.
 */
export function rollbackCommit(before, hasCommit) {
  const commit = commitOfImage(before);
  return commit && hasCommit(commit) ? commit : null;
}

/**
 * The changed paths (from git diff --name-only) that end up in what's deployed: everything but agentkit.config.json's
 * deploy.notShipped, where a folder ends with "/". An unlisted folder costs at most an unneeded deploy.
 */
export function shippedPaths(paths, notShipped) {
  return paths.filter((path) => !notShipped.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry)));
}

/** The one thing every machine runs, from a list of what each runs; refuses none, or several. */
export function onlyOne(refs, target) {
  if (!Array.isArray(refs) || refs.length === 0) throw new Error(`${target} lists nothing running, so there is nothing to roll back to.`);
  if (!refs.every(isText)) throw new Error(`${target} named a release without a name.`);
  const distinct = [...new Set(refs)];
  if (distinct.length > 1) throw new Error(`${target} runs different releases (${distinct.join(", ")}). Check it before deploying.`);
  return distinct[0];
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function answers200(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Polls the health route until it answers 200, for up to two minutes. A target's own deploy may already wait for its
 * health check before it returns (flyctl does), so this confirms the public route as well. A network error counts as
 * not healthy yet.
 */
export async function waitForHealthy(url, { attempts = 24, delayMs = 5000, fetchImpl = fetch, sleep = pause } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await answers200(url, fetchImpl)) return true;
    if (attempt < attempts) await sleep(delayMs);
  }
  return false;
}
