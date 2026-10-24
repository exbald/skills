// Test data: an agentkit.config.json for a made-up project, acme, with the two builders of the worked example (model
// ids here are data, as AGENTS.md allows in tests). Not a test file itself.
export const REVIEWER = Object.freeze({ login: "acme-review-bot", name: "the review bot", trigger: "/review" });

export const BUILDERS = Object.freeze({
  glm: Object.freeze({ harness: "opencode", model: "zai-coding-plan/glm-5.3#max", label: "GLM 5.3 (max)" }),
  sonnet: Object.freeze({ harness: "claude", model: "claude-sonnet-5-5", effort: "high", label: "Sonnet 5.5 (high)", budgetUsd: 10 }),
});

export const CONFIG = Object.freeze({ project: "acme", owner: "Ada", repo: "acme/acme", defaultBranch: "main", reviewer: REVIEWER, builders: BUILDERS });

/** The config file's text, with `overrides` over CONFIG. */
export function configText(overrides = {}) {
  return `${JSON.stringify({ ...CONFIG, ...overrides }, null, 2)}\n`;
}
