---
name: upwork-listings
description: >-
  Create or edit Upwork Project Catalog listings and consultations by driving the browser with
  browser-harness. Covers the full wizard (title, category, tiers, add-ons, gallery, requirements,
  description, FAQs) plus the pricing strategy that makes a listing sell. Use when asked to: add,
  edit, price or fix an Upwork project or consultation, build a new productized service offering on
  Upwork, or diagnose why a listing gets views but no orders. Also answers questions about Upwork
  listing field limits, tier structure, and gallery image requirements.
---

# Upwork Project Catalog listings

Drives Upwork's listing wizard end to end with `browser-harness`. A config-driven
driver script does the mechanical work; this file carries the strategy and the
platform traps that cost hours to discover.

## Before building anything: decide project vs consultation

**Consultations have no title field.** The name is generated from the category,
and there are only seven categories. Two consultations in the same category are
named identically and are indistinguishable to buyers. Consultation pricing also
has a **single** rate field labelled "per 30 minutes", and the 60-minute price is
always exactly double it, so arbitrary pairs like $150/$249 are impossible.

**Therefore: any named, specific advisory offering must be a PROJECT.** A
"60-minute AI strategy audit" sells as a catalog project with a real title. Keep
at most one consultation as a generic entry point.

## Strategy that should shape the config

Check these before writing copy. They come from analysing a real account's
earnings against 40 competitor listings.

- **Entry price is the whole game.** In dev/AI categories, entry tiers cluster at
  **$99 to $150**, with $149 the mode. A listing whose cheapest tier is $2,000
  is not competing, it is invisible.
- **Ladder shape is roughly 1x / 4x / 10-17x**, not 1x/2x/3x. Starter exists to
  be bought; the money is in Advanced plus add-ons.
- **Add-ons are free margin.** Fast delivery, extra revision, source code,
  deployment, extra data source, training, monthly support. Competitors turn a
  $149 order into $3,000 this way.
- **Entry delivery is 1 to 5 days.** Fourteen days on the cheapest tier signals
  "custom project", the opposite of what catalog buyers shop for.
- **Named and specific beats generic and cheap.** The highest-reviewed seller in
  a scan of one category sold a *named* system at $220, not the cheapest option.
- **Write in one honest disqualifier per listing.** "If it is cheaper to buy off
  the shelf, the scope will say so." Nobody expects it, and it makes every other
  claim credible. This is the single most differentiating move available.
- **Match the buyer to the work that historically went well.** Check who actually
  paid well and rated highly before productising something.

## Running the driver

```bash
# create a new project end to end
CFG=/abs/path/config.json browser-harness < scripts/build_project.py

# resume an existing project from the Pricing step (skips Overview)
CFG=/abs/path/config.json PID=<project-id> browser-harness < scripts/build_project.py

# only Requirements onward, for when the gallery step needed a manual assist
CFG=/abs/path/config.json PID=<project-id> browser-harness < scripts/finish_project.py
```

`references/example-config.json` is a complete working config. Copy and edit it.

**Validate every field length before touching the browser.** Limits are listed
in `references/wizard-mechanics.md`. Assert them in Python first; a rejected field
mid-wizard is far more expensive than a failed assertion.

The driver leaves the listing as a **DRAFT** and never submits. The user reviews,
then submits for Upwork review themselves.

## Non-negotiable safety rules

1. **Never open or interact with an already-approved listing** unless explicitly
   asked to edit that specific one. Do not click its row menu; the menu contains
   a Delete item and a misclick opens a delete confirmation.
2. **Never click delete, remove, archive or unpublish.** If any confirmation
   dialog appears, Cancel and report it.
3. **Never submit for review.** Draft only.
4. **Never trigger JS alert/confirm/prompt dialogs.** They permanently freeze the
   browser session.
5. Pace navigation. Upwork rate-limits automated activity and can restrict search
   access with a Terms of Service notice. Stop immediately on any such message
   rather than retrying.

## The traps that will waste your time

Full detail in `references/wizard-mechanics.md`. The ones that matter most:

- **File dialogs need a trusted gesture.** A DOM `.click()` will *never* open the
  gallery file chooser. Use a real mouse event via `click_at_xy`. This is the
  single biggest time sink if you do not know it.
- **Setting the hidden file input directly does nothing.** The Vue dropzone
  ignores it even when `input.files.length` becomes 1. Intercept the OS file
  chooser instead (recipe in the reference).
- **The crop modal clips the left edge by default**, which destroys any image
  with a text panel. Fix it through the Cropper.js API, not by dragging.
- **DOM `.click()` is otherwise more reliable than coordinates**, because the
  viewport resizes between steps and cached rects go stale.
- **Category auto-suggestions are useless** and must be bypassed via the "Browse
  all categories" modal.
- **"Add" buttons must be scoped to their own form container**, or the click
  lands on a different section's Add and silently does nothing.
- **Gallery guidelines warn against "text-heavy images" and "Upwork badges"**,
  but text-heavy informational cards do pass review in practice and outperform
  atmospheric imagery in a search grid, where the image has about one second to
  say what is being sold.

## Keep a build log

For any multi-listing job, maintain a log file recording listing IDs, which
wizard steps are complete, and any new platform quirk discovered. Sessions get
interrupted and agents get swapped; the log is what makes the work resumable.
