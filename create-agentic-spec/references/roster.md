# Team roster and routing

roster_as_of: 2026-10-05

Update that date whenever you refresh this file. `team_facts.py` prints the roster's age and marks it STALE after 14 days. A stale roster gets refreshed (section 6), or the user explicitly agrees to use it as is. Also refresh it when `team_facts.py` shows a model this file does not cover, or when a pick here keeps failing.

## 1. Facts first

```text
python3 scripts/team_facts.py --hours <expected run length> --probe-clis
```

- Worker agent ids: `claude`, `codex`, `cursor`, `antigravity`, `muse`, `zcode`, `opencode`, `opencode2`.
- `--model` and `--effort` work for claude, codex, cursor, antigravity and muse. opencode and zcode run the model in their own config, so check it before routing to them. `opencode2` can hold a second config, for example GLM-5.3-Flash beside GLM-5.3.
- A meter marked **EXHAUSTED** is out. A meter marked **resets during run** is usable only for work that starts after the reset.
- DeepSeek is not an Orca worker id. Its harness CLI is `dsh` (the launchers are `dsh-tui` and `dst`), not `deepseek`, and its key sits in the DSH credential store rather than the environment; `dsh-tui doctor` confirms both. For a one-shot, read-only review, pipe the instructions and the diff into `DSH_PERMISSION_MODE=read-only dsh --profile headless -`; headless mode otherwise defaults to `workspace-write`. To pin a model, pass `--patch <file>`, where the file holds `- id: agent-default-model` with `config: {provider: deepseek-official, model: deepseek-flash}`. The patch replaces the whole config block, so leaving out `provider` makes startup fail. DeepSeek's API accepts only `deepseek-flash` (currently V4.1 Flash, II 39) and `deepseek-v4-pro` (V4 Pro 0813, II 36, and more expensive). Verified with a live headless probe on 2026-10-05.
- Untracked agents (opencode, opencode2, muse) are usable. Watch worker output for rate-limit errors and reroute only after a proven failure.
- Claude has two meters. `weekly` caps every claude model, fable included; `fableWeekly` is an extra cap on fable alone. A low `fableWeekly` never makes fable available while `weekly` is full. `team_facts.py` already applies this rule.

## 2. Model families (for the diversity rule)

| Family | Where it runs |
|---|---|
| Anthropic | `claude` (every model), antigravity `claude-*`, cursor `claude-*` |
| OpenAI | `codex` (every model), cursor `gpt-*`, antigravity `gpt-oss-*` |
| Google | antigravity `gemini-*`, cursor `gemini-*` |
| Z.ai | opencode / zcode `glm-*` |
| Meta | `muse`, opencode `muse-*` |
| xAI | cursor `grok-*` |
| Cursor | cursor `composer-*` and `auto`; the underlying model is unknown, so treat it as its own family |

## 3. Evidence

Independent numbers unless marked (vendor). II = Artificial Analysis Intelligence Index. TB4 = Terminal-Bench 4.0 (AA run). CAI = AA Coding Agent Index, scored on each model in its own harness, which is the closest match to an Orca worker. Review = MacroscopeBench code-review score. Halluc. = AA-Omniscience hallucination rate (lower is better). Prices are USD per 1M tokens, input/output.

| Model | Agent / `--model` | II | TB4 | CAI | Review | Halluc. | Speed | Price |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | claude / `opus` | 58 max, 56 xhigh | 60% | 66.0 | **83.9** max, 78.9 xhigh | 59% | 93 t/s | 4 / 20 |
| Sonnet 5.5 | claude / `sonnet` | 56 max | **64%** | **68.4** max, 62.9 xhigh | n/a | 47% | 139 t/s | 2 / 10 |
| Fable 5.1 | claude / `fable` | 53 | 52% | 62.2 | n/a | 72.6% | 68 t/s | 10 / 50 |
| GPT-6.1-Sol | codex / `gpt-6.1-sol` | 52 max | 56% | 62.9 xhigh | 78.5 (precision 90.7%) | 54% | 63 t/s | 2 / 10 |
| GPT-6-Astra | codex / `gpt-6-astra` | 53 | 59% | 61.6 | 78.0 | 51% | 54 t/s | 10 / 50 |
| GPT-6-Luna | codex / `gpt-6-luna` | 38 | 13% | 41.1 | 72.5 | n/a | 131 t/s | 0.10 / 0.50 |
| GLM-5.3 | opencode, zcode (config) | 45 | 42% | 53.6 | 77.4 | **29.6%** | 71 t/s | flat-rate plan |
| GLM-5.3-Flash | opencode, zcode (config) | 42 | 33% | n/a | n/a | n/a | 54 t/s | flat-rate plan, 3x quota |
| Muse Spark 1.3 | muse / `muse-spark-1.3` | 48 | 33% | 54.3 | n/a | 32.9% | 152 t/s | 1.25 / 4.25 |
| Gemini 3.8 Flash | antigravity / `gemini-3.8-flash-high` | 41 | 20% | 41.9 | 70.7 | 55% | 249 t/s | 0.75 / 3.75 |
| Gemini 3.1 Pro | antigravity / `gemini-3.1-pro-high` | 30 | 4% | n/a | n/a | 51% | 117 t/s | 2 / 12 |
| Composer 2.5 | cursor / `composer-2.5` | n/a | n/a | n/a | n/a | n/a | n/a | 0.50 / 2.50 |
| DeepSeek V4.1 Flash | dsh-tui (not a worker id) | 39 | 27% | n/a | 72.0 | 96.5% | 209 t/s | 0.30 / 1.20 |

Other facts that matter for routing:
- Fable 5.1 tops FrontierSWE v2 (37.2%), the longest-horizon coding benchmark.
- Sonnet 5.5 tops AutomationBench (72%) and ranks high on LMArena WebDev (1786). At max effort it is slow and token-hungry, about 1.5 hours and $14 per task.
- Opus 5.5 is #1 on LMArena WebDev (1815) and has the best factual accuracy. At max effort its first token takes about 11 minutes; xhigh takes about 2.
- GPT-6.1-Sol has the top DeepSWE score (73%) and costs about $1 and 15 minutes per coding task.
- GLM-5.3 reviews take about 12.5 minutes.
- Composer 2.5 has no current independent data. Its vendor figure is Terminal-Bench 2.0 69.3%.
- No independent computer-use or browser scores exist for any of these models.

## 4. Role picks

Take the first pick that is not EXHAUSTED and passes the family rule. Pick the reviewer first, then route coders around the reviewer's family, so the strongest available reviewer stays independent. If a wave really needs coders from more families than that allows, split its review: one reviewer per group of tasks, each from a family other than that group's coders.

**PM / coordinator.** This is the session you open in Orca, not a worker.
1. claude `opus` xhigh: top II, top factual accuracy, best judgement.
2. claude `fable` high: strongest on the longest work, but the highest hallucination rate, so make it cite file:line.
3. codex `gpt-6-astra` high.

**Spec critic** (read-only, before wave 1).
1. The weakest coder model planned for this run, often opencode (GLM-5.3) or muse. If it can follow the spec without guessing, every stronger model can.
2. codex `gpt-6.1-sol` high: high precision, few false alarms.

**Coder, T3** (auth, money, data and migrations, concurrency, cross-cutting changes).
1. claude `sonnet` max: #1 coding agent. Slow and expensive, so use it for T3 only.
2. claude `opus` xhigh.
3. codex `gpt-6.1-sol` xhigh.

**Coder, T2** (standard feature work).
1. codex `gpt-6.1-sol` high: fast and cheap per task.
2. claude `sonnet` high.
3. muse `muse-spark-1.3` high.
4. opencode (GLM-5.3): flat-rate quota.

**Coder, T1** (mechanical: wiring, templates, copy, simple tests).
1. opencode (GLM-5.3 or GLM-5.3-Flash).
2. muse `muse-spark-1.3`.
3. cursor `composer-2.5`: uses the Cursor Models pool; no independent data.
4. antigravity `gemini-3.8-flash-high`: fastest, but weak on anything hard.

**Needs vision** (matching a design or reading screenshots): keep the tier's pick if it is multimodal (claude, codex and gemini models are). GLM-5.3-Flash is the multimodal option on the GLM plan.

**Reviewer** (read-only, once per wave).
1. claude `opus` xhigh: best recall and precision on code review.
2. codex `gpt-6.1-sol` xhigh: 90.7% precision and cheap, but it misses about a third of known bugs (67% recall).
3. opencode (GLM-5.3): 77.4, and the most honest model measured.
4. codex `gpt-6-astra` high.

**QA.**
1. claude `sonnet` xhigh: top AutomationBench and strong web-UI work.
2. codex `gpt-6.1-sol` high.
3. claude `opus` high.
4. antigravity `gemini-3.8-flash-high`: fast and multimodal, weaker judgement. Make its evidence concrete.

**Avoid:**
- DeepSeek V4.1 Flash for anything that needs judgement (96.5% hallucination).
- Haiku 4.5 and GPT-6-Luna for coding.
- Gemini 3.1 Pro except for vision checks.
- codex effort `ultra` for any worker. It hands work to sub-agents you cannot see or verify.

## 5. Record the team

Write `team.md` from `references/templates.md`. Paste the `team_facts.py` lines you relied on, the pick for each role with its evidence and fallback, and the family check.

## 6. Refresh procedure

Sources:
- AA leaderboard (II, TB4, hallucination, speed, price): https://artificialanalysis.ai/leaderboards/models
- AA Coding Agent Index (model plus harness): https://artificialanalysis.ai/agents/coding-agents
- MacroscopeBench (code review): https://macroscope.com/benchmark
- LMArena WebDev (UI work): https://arena.ai/leaderboard/code/webdev
- Terminal-Bench: https://www.tbench.ai/leaderboard

Prefer independent numbers and mark vendor-only figures "(vendor)". Keep the picks limited to models the user actually has, and update the date at the top of this file.
