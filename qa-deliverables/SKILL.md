---
name: qa-deliverables
description: >-
  Produce client-facing QA deliverables for a web app by driving the LIVE site with the
  browser-harness CLI: a documented power-user TEST REPORT (one screenshot per step, with
  goal/steps/expected/result) and a plain-English RUNBOOK / user guide, then polished PDFs of both
  with embedded screenshots. Use when asked to: QA or test a feature/milestone end-to-end WITH
  evidence, write a test report or "show it works" walkthrough, create a user guide / runbook /
  handover doc for a client, capture a screenshot walkthrough of a running app, or generate a PDF
  from a markdown report/guide. Drives the browser with browser-harness ONLY (never Playwright,
  Selenium, or MCP browser tools).
---

# QA deliverables: test report + runbook + PDFs

A three-phase pipeline that turns a working web app into a client handover pack: a screenshotted
test report, a user-facing runbook, and clean PDFs of both. The hard-won mechanics live in the
reference files — read the relevant one at each phase.

## Prerequisites
- The app is **running and reachable** (live prod URL, or local dev — confirm which).
- **browser-harness** is on `$PATH` (`browser-harness -c '...'`). It drives the user's Chrome, so
  an authenticated session is usually inherited; if a page redirects to login, STOP and ask.
- For PDFs: `python3 -m markdown` + a Chromium/Chrome binary (both checked by the script).

## Phase 1 — Drive the app + screenshot every step
1. **Plan the walkthrough as the end user's real decisions** — one test per feature, each framed as
   "the goal the user is trying to accomplish" (not "click the button"). Lead with the headline
   feature. Include a "test before you commit" flow and a "make a correction" flow if they exist.
2. **Drive it via browser-harness**, capturing one screenshot per step into a `screenshots/` folder.
   Read **`references/browser-harness-walkthrough.md`** for the reliable mechanics: the temp-file
   invocation pattern, the `save()` screenshot helper, JS-click-by-content, filling React inputs,
   proving "no network on interaction", and reading real on-screen values for the report.
3. **Use real numbers** (read them off the screen) and capture **before → after** for any
   state-changing action. **Undo any writes** (expire/delete test records) before finishing — never
   leave stray rows in a live system; on prod, prefer showing the read path and say so.

## Phase 2 — Write the two docs
Compile two Markdown files, each with its sibling screenshots folder. Both are **client-facing**:
plain English, second person, describe what the user *experiences* (no implementation jargon).
- **Test report** — a documented walkthrough proving each feature works, with a screenshot per step.
- **Runbook** — a "how to use it day to day" user guide.

Read **`references/report-and-runbook-structure.md`** for the exact section templates, the
per-test shape (Goal / Steps / What you should see / Result ✅ / screenshot), the voice rules, and
links to the working examples in the repo to mirror.

> **Image paths must be relative** (e.g. `screenshots/03-foo.png`) and the folder must sit **next
> to the .md file** — the PDF step resolves images against the markdown's own directory.

## Phase 3 — Generate the PDFs
Run the bundled generator on each markdown file. It renders Markdown → styled HTML → PDF via
headless Chromium (embedded screenshots, A4, print CSS), resolving relative images against the
source's directory:

```bash
python3 scripts/md_to_pdf.py path/to/test-report.md            # -> test-report.pdf (alongside)
python3 scripts/md_to_pdf.py path/to/runbook.md  path/to/runbook.pdf
```

Verify each PDF (`file out.pdf` → "PDF document, N pages"; open/spot-check that screenshots
embedded). These PDFs are the shareable copies for the client; the markdown stays the editable
source.

## Deliver
Hand the client the **PDFs** (no relative-link issues). Keep the markdown + screenshots in the repo
as the source of truth. If a maintainer handover is also needed, add a separate technical appendix
(sync schedule, schema, credentials, limitations) — keep it out of the user-facing runbook.
