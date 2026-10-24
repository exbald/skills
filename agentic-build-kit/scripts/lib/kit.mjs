// What init.mjs decides, kept pure so the tests can cover it without a repository: its arguments, the GitHub
// repository an origin URL names, the agentkit.config.json it writes, the {{PLACEHOLDERS}} it fills, and the additive
// merges of the files a repository usually has already (.gitignore, CLAUDE.md, package.json, .claude/settings.json).

export const USAGE = [
  "Usage: node scripts/init.mjs <target-dir> [options]",
  "  --project <name>           the project's name (default: the folder's name)",
  "  --owner <name>             who owns the decisions agents can't make (default: git config user.name)",
  "  --repo <owner/name>        the GitHub repository (default: from origin's URL)",
  "  --default-branch <name>    the branch that deploys (default: origin/HEAD's, else the current branch, else main)",
  "  --reviewer-login <login>   the reviewer bot's GitHub login (needed before the first merge)",
  "  --reviewer-name <text>     how the brief names the bot (default: the reviewer bot)",
  "  --reviewer-trigger <text>  the comment that asks it for a review (default: /review)",
  "  --deploy none|fly          the deploy target (default: none); fly needs --fly-app and --health-url",
  "  --fly-app <name>           the Fly app, with --deploy fly",
  "  --health-url <url>         the health route deploy-approved.mjs polls, with --deploy fly",
  "  --with-screens             add the optional screen check (tools/screens) and a screens section to fill in",
  "  --force                    overwrite kit files that exist already",
  "  --dry-run                  print what it would write, and write nothing",
  "  --yes                      no prompts: take the flags and the defaults",
].join("\n");

const VALUE_FLAGS = new Map([
  ["--project", "project"],
  ["--owner", "owner"],
  ["--repo", "repo"],
  ["--default-branch", "defaultBranch"],
  ["--reviewer-login", "reviewerLogin"],
  ["--reviewer-name", "reviewerName"],
  ["--reviewer-trigger", "reviewerTrigger"],
  ["--deploy", "deploy"],
  ["--fly-app", "flyApp"],
  ["--health-url", "healthUrl"],
]);
const SWITCHES = new Map([
  ["--with-screens", "withScreens"],
  ["--force", "force"],
  ["--dry-run", "dryRun"],
  ["--yes", "yes"],
  ["--help", "help"],
]);

/** The command line as options: { target, ...values given, switches }. Throws an Error whose message is the reason. */
export function parseArgs(argv) {
  const options = { target: null, withScreens: false, force: false, dryRun: false, yes: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].startsWith("--") ? argv[index].split(/=(.*)/s) : [argv[index]];
    if (SWITCHES.has(flag)) options[SWITCHES.get(flag)] = true;
    else if (VALUE_FLAGS.has(flag)) {
      const value = inline ?? argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
      options[VALUE_FLAGS.get(flag)] = value;
    } else if (flag.startsWith("-")) throw new Error(`Unknown option ${flag}.`);
    else if (options.target === null) options.target = flag;
    else throw new Error(`One target folder only, not also ${flag}.`);
  }
  if (!options.help && options.target === null) throw new Error("Name the repository to set up.");
  if (options.deploy !== undefined && !["none", "fly"].includes(options.deploy)) throw new Error(`--deploy takes none or fly, not ${options.deploy}.`);
  return options;
}

/** owner/name from a GitHub remote URL (https, ssh or scp-like), or null for anything else. */
export function githubRepo(url) {
  const match = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url ?? "").trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

// The worked example's builders: GLM in OpenCode for the waves whose code a spec gives, Sonnet in Claude Code for the
// waves where the builder writes the code. Pinned ids, never moving aliases; change them in the config.
export const EXAMPLE_BUILDERS = Object.freeze({
  glm: { harness: "opencode", model: "zai-coding-plan/glm-5.3#max", label: "GLM 5.3 (max)" },
  sonnet: { harness: "claude", model: "claude-sonnet-5-5", effort: "high", label: "Sonnet 5.5 (high)", budgetUsd: 10 },
});

const NOT_SHIPPED = ["docs/", "specs/", "tools/", ".claude/", ".github/", ".opencode/", "AGENTS.md", "CLAUDE.md", "README.md", "agentkit.config.json"];

/** A name an Android package or a link scheme can hold: lower-case letters and digits, starting with a letter. */
function identifier(project) {
  const plain = String(project).toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^[a-z]/.test(plain) ? plain : `app${plain}`;
}

/** The screens section --with-screens starts from: the worked example's shape, named after the project, to check. */
export function screensSection(project) {
  const id = identifier(project);
  return { appId: `com.${id}.app`, linkScheme: id, avd: `${id}-pixel8-api35`, idsFile: "apps/mobile/src/dev/gallery/ids.json" };
}

/** The agentkit.config.json init writes: every key spelled out, so the file shows what can be set. */
export function configFile(values) {
  const fly = values.deploy === "fly";
  return {
    $comment: "Settings for tools/ (guardrails, spec-check, build). tools/guardrails/lib/config.mjs has every key and its default.",
    project: values.project,
    owner: values.owner,
    repo: values.repo,
    defaultBranch: values.defaultBranch,
    lockfile: values.lockfile,
    verify: { command: null },
    protectedPaths: [],
    deniedCommands: [],
    reviewer: { login: values.reviewerLogin, name: values.reviewerName, trigger: values.reviewerTrigger },
    ci: { workflowFile: ".github/workflows/verify.yml", requiredJobs: [{ workflow: "verify", job: "verify" }] },
    deploy: { adapter: values.deploy, healthUrl: fly ? values.healthUrl : null, notShipped: NOT_SHIPPED, fly: { app: fly ? values.flyApp : null } },
    builders: EXAMPLE_BUILDERS,
    build: { install: null, installEnv: {}, longCommands: [] },
    ...(values.withScreens ? { screens: screensSection(values.project) } : {}),
  };
}

/** The text each {{PLACEHOLDER}} in a kit template becomes. A missing reviewer login reads as a reminder to set it. */
export function placeholders(values) {
  return {
    PROJECT: values.project,
    OWNER: values.owner,
    REPO: values.repo ?? "the repository",
    DEFAULT_BRANCH: values.defaultBranch,
    REVIEWER_LOGIN: values.reviewerLogin ?? "reviewer bot (set reviewer.login in agentkit.config.json)",
    REVIEWER_NAME: values.reviewerName,
    REVIEWER_TRIGGER: values.reviewerTrigger,
    DATE: values.date,
  };
}

/** A template with its {{PLACEHOLDERS}} filled. Throws on one it has no value for, so no template ships half-filled. */
export function fill(text, table) {
  const filled = text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!Object.hasOwn(table, key)) throw new Error(`no value for ${match}`);
    return table[key];
  });
  return filled;
}

/** .gitignore with the lines the guardrails' state and the secrets need, appended once, under a heading. */
export function mergeGitignore(text) {
  const wanted = ["node_modules", ".env*", "specs/.current-task", "specs/.verified", "specs/.stop-blocks"];
  const have = new Set(String(text ?? "").split(/\r?\n/).map((line) => line.trim()));
  const missing = wanted.filter((line) => !have.has(line));
  if (missing.length === 0) return { text, added: [] };
  const base = String(text ?? "");
  const gap = base === "" ? "" : base.endsWith("\n") ? "\n" : "\n\n";
  return { text: `${base}${gap}# The agentic build kit: secrets and the guardrails' local state\n${missing.join("\n")}\n`, added: missing };
}

/** CLAUDE.md importing AGENTS.md, added once to what's there. */
export function mergeClaudeMd(text) {
  if (text === null) return { text: "@AGENTS.md\n", added: ["@AGENTS.md"] };
  if (/^@AGENTS\.md\s*$/m.test(text)) return { text, added: [] };
  return { text: `${text}${text.endsWith("\n") ? "" : "\n"}\n@AGENTS.md\n`, added: ["@AGENTS.md"] };
}

/** The scripts the kit's verification needs. */
export function kitScripts(withScreens) {
  const suites = ["guardrails", "spec-check", "build", ...(withScreens ? ["screens"] : [])].map((tool) => `"tools/${tool}/test/*.test.mjs"`);
  return {
    "check:specs": "node tools/spec-check/check.mjs",
    "test:tools": `node --test ${suites.join(" ")}`,
    verify: "npm run check:specs && npm run test:tools",
  };
}

/**
 * package.json with the kit's scripts: a new one when there's none, else only the scripts it lacks. A verify script of
 * its own stays, and `note` says to add the kit's checks to it.
 */
export function mergePackageJson(text, { project, withScreens }) {
  const scripts = kitScripts(withScreens);
  if (text === null) {
    const name = String(project).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "project";
    const created = { name, version: "0.0.0", private: true, scripts };
    return { text: `${JSON.stringify(created, null, 2)}\n`, added: Object.keys(scripts), note: null };
  }
  const pkg = JSON.parse(text);
  const existing = pkg.scripts ?? {};
  const missing = Object.keys(scripts).filter((key) => existing[key] === undefined);
  const covered = typeof existing.verify === "string" && existing.verify.includes("check:specs") && existing.verify.includes("test:tools");
  const note = missing.includes("verify") || covered ? null : `package.json has a verify script of its own: add "npm run check:specs && npm run test:tools" to it.`;
  if (missing.length === 0) return { text, added: [], note };
  const merged = { ...pkg, scripts: { ...existing, ...Object.fromEntries(missing.map((key) => [key, scripts[key]])) } };
  return { text: `${JSON.stringify(merged, null, 2)}\n`, added: missing, note };
}

/**
 * .claude/settings.json running the three hooks, keeping everything else it holds. A hook is added only when no
 * command of that event runs it already, so running init twice adds nothing.
 */
export function mergeClaudeSettings(text, kitSettings) {
  const settings = text === null ? {} : JSON.parse(text);
  const hooks = { ...(settings.hooks ?? {}) };
  const added = [];
  for (const [event, groups] of Object.entries(kitSettings.hooks)) {
    const commands = JSON.stringify(hooks[event] ?? []);
    const script = /tools\/guardrails\/hooks\/[\w-]+\.mjs/.exec(JSON.stringify(groups))[0];
    if (commands.includes(script)) continue;
    hooks[event] = [...(hooks[event] ?? []), ...groups];
    added.push(event);
  }
  if (added.length === 0 && text !== null) return { text, added };
  return { text: `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`, added };
}
