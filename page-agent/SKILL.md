---
name: page-agent
description: Drive a running web app with natural-language tasks using Alibaba's page-agent (its GUI agent that lives in the page), via the extension page-API and a one-shot browser-harness injection — no MCP, no headless browser. Use when the user wants Claude to click/type/fill/navigate a real site by describing the task ("sign up as X and open Settings", "fill this form", "test the checkout flow"), or asks to run/set up the `pa` command or the `/page-agent` workflow. This ACTS on the DOM (fast, text-based) — it does NOT read images; pair with a screenshot + vision model to SEE.
---

# page-agent

[page-agent](https://github.com/alibaba/page-agent) is Alibaba's "GUI agent living in your webpage" — it drives web UIs from natural language by reading the DOM as **text** (no screenshots, no multimodal model). This skill drives it *externally* so Claude can automate a real site: it injects one `window.PAGE_AGENT_EXT.execute()` call with `browser-harness`, and the browser extension does the actual clicking/typing/navigating.

**Key mental model — two axes:**

1. **ACT vs SEE.** page-agent only *acts* on the DOM. It is blind to rendered pixels, so it can report `success: true` while the visible UI differs. To *read* images/charts/canvas or verify what actually rendered, use a screenshot + vision model (not page-agent).
2. **Drive vs embed.** This skill *drives* an existing app (you test it). To instead ship page-agent *inside* an app as a product copilot — including custom tools/instructions — that's the core library (`npm install page-agent`, `new PageAgent(...)`), a different task.

## When to use

- "Use page-agent / `pa` / `/page-agent` to …"
- "Test the signup / login / checkout flow on localhost:3000"
- "Fill out this form / click through this wizard on <site>"
- Any natural-language browser task where you want fast DOM-level automation and don't need to *read* visual content.

Not for: reading images/OCR/visual diffs (use vision), or pixel-exact repeatable scripted checks (use browser-harness/CDP directly).

## Architecture (no MCP)

```
Claude ──▶ browser-harness  ──(inject one js call)──▶  window.PAGE_AGENT_EXT.execute(task, cfg)
                                                              │  (extension, text-based DOM loop)
                                                              ▼
                                                        clicks / types / navigates the page
```

`browser-harness` is only the injection vector; the extension runs the agent loop in-page. page-agent also has an optional MCP server and a core-lib path — but the extension page-API driven this way is the lightest and avoids MCP/port-forward setup entirely.

## One-time setup

1. **Install the extension** in the Chrome that `browser-harness` attaches to (CDP `:9222`). Prebuilt zips ship on [GitHub Releases](https://github.com/alibaba/page-agent/releases) (faster than the Web Store); unzip and load unpacked at `chrome://extensions`. Open its side panel and set your LLM (OpenAI-compatible `baseURL` + `model` + key).
2. **Copy the page-API auth token** from the extension side panel. This token gates `window.PAGE_AGENT_EXT` and is bound to that Chrome profile.
3. **Create the config** (secrets stay local, never in this repo):
   ```bash
   mkdir -p ~/.config/page-agent && chmod 700 ~/.config/page-agent
   cp scripts/config.example.json ~/.config/page-agent/config.json   # then edit: paste token
   printf '%s' 'YOUR_LLM_API_KEY' > ~/.config/page-agent/key && chmod 600 ~/.config/page-agent/key
   cp scripts/pa_run.py ~/.config/page-agent/pa_run.py
   install -m755 scripts/pa ~/.local/bin/pa      # ensure ~/.local/bin is on PATH
   ```
   `config.json`: `{ "token": "<from side panel>", "baseURL": "<OpenAI-compatible base>", "model": "<model id>" }`.

**LLM note (z.ai GLM example):** page-agent is bring-your-own-LLM (OpenAI-compatible). If you use a z.ai **GLM Coding Plan** key, the base URL is `https://api.z.ai/api/coding/paas/v4` (models `glm-5-turbo` fast / `glm-5.2` flagship). Hitting the pay-as-you-go base `.../paas/v4` with a coding-plan key returns *"insufficient balance"* — that's a wrong-endpoint error, not a real limit.

## Usage

```bash
pa "Type 'banana' into the search box; do not press Enter"  https://en.wikipedia.org
pa "Log in as test@x.com / hunter2 and open Settings"       http://localhost:3000  glm-5.2
```

Every run saves a screenshot to `~/.config/page-agent/last.png`. **Always look at it** — page-agent's own `success` can disagree with the rendered state.

## Gotchas (field-tested)

- **Runtime dep:** the extension-Chrome must be running on `:9222` — the same Chrome/profile `browser-harness` uses (the token is bound to that profile; a fresh profile mints a different token and the API won't expose). Rule of thumb: if `browser-harness` works, `pa` works.
- **Navigation kills the callback.** When the agent navigates the *tab it was called from*, that tab's JS context dies, losing both the poller and page-agent's result callback. For multi-page flows (login → redirect) run with `PA_INITIAL=0` (driver-tab pattern: the agent works in a separate tab and the caller survives), or just verify by end-state (`last.png` + a fresh DOM read).
- **DOM-success ≠ visual-success.** It typed into the element it *identified*; confirm visually. For anything image/visual, use a vision model on the screenshot.
- **Custom tools are core-lib only.** The `customTools` option is a `PageAgent` *constructor* feature (embedded path). The extension page-API config here only accepts `baseURL/model/apiKey/systemInstruction/includeInitialTab/experimentalIncludeAllTabs` — no custom tools. To add tools, embed the core lib in the app.
- **Long flows:** raise `PA_MAXPOLL` (default 45 × 2s).

## Verify visually (the SEE half)

page-agent can't read images. To check what actually rendered, or to read visual content:

```bash
browser-harness -c 'new_tab("http://localhost:3000"); wait_for_load(); capture_screenshot("/tmp/shot.png")'
```
then pass `/tmp/shot.png` to a vision model (e.g. a `*v` vision model, or a vision analysis tool). Treat page-agent as the hands and a vision pass as the eyes.

## Reference

Mirror the upstream docs locally so config/extension work isn't guesswork:

```bash
# firecrawl (or any scraper): crawl https://alibaba.github.io/page-agent/docs → per-page markdown
```

Most relevant pages: `features/chrome-extension`, `features/third-party-agent` (page-API), `features/custom-tools` + `features/custom-instructions` (embed path), `advanced/page-agent-core`, `features/models`.
