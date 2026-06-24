# Structure of the two deliverables

Both are **client-facing**: plain English, second-person ("you"), no implementation jargon
(describe what the user *experiences*, never API/framework names). Screenshots inline. The goal is
a non-technical stakeholder reads it top to bottom and (a) trusts the tool works and (b) can re-run
it themselves.

Working examples to mirror (read them before writing):
- Test report: `docs/business/inventory-dash/m3-test-report/M3-test-report.md` (+ `screenshots/`).
- Runbook: `docs/runbook-inventory.md` (+ `runbook-screenshots/`).

---

## A. Test report

A documented walkthrough proving each feature works, on the **real/live** environment, with a
screenshot per step. One file + a `screenshots/` sibling folder.

**Top matter**
- `# <Product> — <Milestone>: Test Report`
- `Prepared for <Client> · <date>` and where it was tested (live URL vs. local, on real data).
- A **> Bottom line:** blockquote — one paragraph: everything works, what's notable, what was
  folded in. Mention the screenshots are read straight off the live screen.
- A small **"What's added"** table (feature → what it lets you do, in user terms).
- **How I tested** — where, what data (e.g. "your real 37 SKUs"), that every number is read off
  the live screen. A one-line snapshot of the board state.

**One section per feature/test** — keep this exact shape, it's what makes it scannable:
```
## Test N — <plain-English feature name>   (⭐ on the headline feature)
**Goal (your words / your scope):** <the user's decision this answers>
**Steps:** <what you did, briefly>
**What you should see:** <the expected outcome in plain terms>
**Result ✅** — <the actual on-screen result, with REAL numbers read via js()>.
![caption](screenshots/NN-name.png)
> Honest note: <anything sparse/expected-but-odd, e.g. "trend is correct but sparse for now">
```
- Lead with the **star feature** prominence (⭐). Use real before→after numbers ("tiles shifted
  Reorder now 5 → 6").
- Add a **"> Honest note:"** wherever something looks alarming-but-fine (blank lead times, sparse
  trend, a high number worth sanity-checking) — candor builds trust.
- If a step found+fixed a bug, say so plainly ("Found & fixed during this test: …").

**Close**
- **What I verified under the hood** — the invisible guarantees (e.g. "no network on interaction",
  admin-gating), each as a one-liner.
- **Try it yourself (≈2 minutes)** — a numbered quickstart so the client re-runs the key flows.

---

## B. Runbook (user guide)

A "how to use it day to day" guide — **no technical knowledge needed**. One file + a
`*-screenshots/` folder. ~6 screenshots.

**Recommended section order** (adapt to the app):
1. `# <Product> — Guide` + **Where to find it** (URL) + **Updated** date + a one-line "no
   technical knowledge needed".
2. **What it does** — the value in 3-5 bullets.
3. **Reading the <main screen>** — the tiles/headline, the freshness indicator, the tabs. (screenshot)
4. **One short how-to per feature** the user acts on — each: what it's for + the click path. Cover
   the headline feature, any "test before you commit" flow, and any "make a correction" flow.
   (screenshot each)
5. **Operator tasks** — the recurring chores: refresh on demand, keep the data source updated,
   add a teammate, fill in a missing setting.
6. **A few things that are normal (not bugs)** — pre-empt the "is this broken?" questions
   (expected flags, sparse early data, etc.).
7. **If something looks off** — the 2-3 first checks + who to ping.

**Voice rules** (both docs)
- Describe by experience: "everything updates instantly as you click, no page reload" — not the
  mechanism.
- One idea per sentence; short paragraphs; bullets over prose for steps.
- Reassure on the scary bits ("nothing you do on screen ever changes your sheet or Cin7").
- If the same screenshots serve both docs, capture once and reference from each.

---

## Optional: a deeper "for whoever maintains it" appendix
The runbook above is end-user-facing. If the client also needs a maintainer handover, add a
separate technical section/doc covering: the sync schedule + how to trigger it, re-running any data
importer, the schema overview, credentials/service-account ownership, and known limitations. Keep
it OUT of the user-facing runbook (different audience).
