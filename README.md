# skills

A collection of **41 Claude Code skills** covering marketing, copywriting, SEO, engineering patterns, Claude Code tooling, and decision-making workflows. Each skill is a self-contained `SKILL.md` (plus optional references and scripts) that extends Claude with specialized knowledge or process. Drop them into `~/.claude/skills/` and Claude will activate the right one automatically based on your request.

## Install

Clone into your Claude skills directory:

```bash
git clone https://github.com/exbald/skills.git ~/.claude/skills-exbald
```

Then either:

- **Symlink everything:** `for d in ~/.claude/skills-exbald/*/; do ln -s "$d" ~/.claude/skills/; done`
- **Pick individual skills:** `ln -s ~/.claude/skills-exbald/copywriting ~/.claude/skills/copywriting`

Some skills reference user-specific paths (notably `crm` expects a `~/personal-os/CRM/` directory). Adapt those to your own setup.

## Skills

### Marketing & CRO
- **ab-test-setup** — plan, design, and implement A/B tests; structure hypotheses and variants.
- **analytics-tracking** — set up GA4, GTM, conversion + event tracking, UTM strategy.
- **form-cro** — optimize non-signup forms (lead capture, contact, demo, surveys).
- **onboarding-cro** — improve post-signup activation, first-run experience, time-to-value.
- **page-cro** — conversion optimization across homepage, landing, pricing, and feature pages.
- **paid-ads** — Google Ads, Meta, LinkedIn, X — campaign strategy, creative, targeting, optimization.
- **paywall-upgrade-cro** — in-app paywalls, upgrade modals, feature gates, free-to-paid conversion.
- **popup-cro** — popups, modals, overlays, exit intent, lead-capture banners.
- **signup-flow-cro** — optimize signup, registration, trial activation flows.

### SEO & Discovery
- **competitor-alternatives** — competitor comparison pages, "vs" pages, alternative pages for SEO and sales.
- **programmatic-seo** — build SEO pages at scale from templates and data.
- **schema-markup** — JSON-LD structured data, rich snippets, FAQ/product/review schema.
- **seo-audit** — diagnose technical and on-page SEO issues.

### Copy & Content
- **copy-editing** — systematic editing of existing marketing copy across multiple passes.
- **copywriting** — write or rewrite marketing copy for homepage, landing, pricing, feature pages.
- **email-sequence** — drip campaigns, onboarding emails, lifecycle automations, re-engagement.
- **social-content** — LinkedIn posts, X threads, Instagram, TikTok — content creation and repurposing.

### Strategy & Growth
- **free-tool-strategy** — engineering-as-marketing — design free tools for lead gen, SEO, and brand.
- **launch-strategy** — product launches, Product Hunt, GTM, waitlists, phased rollouts.
- **marketing-ideas** — 140 proven marketing approaches organized by category.
- **marketing-psychology** — 70+ mental models and cognitive biases applied to marketing.
- **pricing-strategy** — pricing decisions, packaging, freemium, Van Westendorp, willingness-to-pay.
- **referral-program** — referral, affiliate, ambassador, and viral-loop program design.

### Sales & CRM
- **crm** — display CRM pipeline with contacts, deals, and weekly follow-up actions. (Expects `~/personal-os/CRM/`.)

### Engineering Patterns
- **backend-patterns** — Node.js / Express / Next.js API design, database, and server patterns.
- **frontend-patterns** — React / Next.js patterns, state management, performance, UI best practices.
- **postgres-patterns** — query optimization, schema design, indexing, RLS, based on Supabase practices.
- **security-review** — security checklists and patterns for auth, input handling, secrets, APIs, payments.
- **stripe-best-practices** — Stripe integration patterns — checkout, subscriptions, webhooks, Connect.
- **tdd-workflow** — enforce test-driven development with 80%+ coverage across unit, integration, E2E.

### Claude Code Tooling
- **agent-development** — author Claude Code subagents — frontmatter, descriptions, tools, examples.
- **command-development** — author slash commands — frontmatter, arguments, dynamic execution.
- **create-spec** — generate feature specs optimized for parallel agent execution and wave planning.
- **mcp-integration** — integrate MCP servers (SSE, stdio, HTTP, WebSocket) into Claude Code plugins.
- **claude-opus-4-5-migration** — migrate prompts and code from older Claude models to Opus 4.5.

### Workflows & Learning
- **continuous-learning-v2** — instinct-based learning that observes sessions and evolves skills/commands/agents.
- **profile-learner** — auto-detect and save personal facts about the user during conversations.
- **strategic-compact** — suggest manual `/compact` at logical task boundaries instead of arbitrary auto-compaction.

### Tools & Decision
- **decision-toolkit** — structured decision tools — step-by-step guides, bias checkers, scenario explorers, HTML dashboards.
- **og-image** — generate Open Graph social preview images matching the project's design system.
- **unified-dev-env** — pattern where all services, logs, and browser console stream into one observable place.

## License

[MIT](LICENSE).

---

Made by [zerodraft.studio](https://zerodraft.studio)
