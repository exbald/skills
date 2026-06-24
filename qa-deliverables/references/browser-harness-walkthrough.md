# Driving the app + capturing screenshots with browser-harness

The non-obvious mechanics for running a documented, power-user walkthrough of a live web app and
saving a screenshot per step. Use the **browser-harness CLI** (`browser-harness -c '...'`) — never
Playwright/Selenium/MCP browser tools (project convention).

## Table of contents
- Connection & auth
- The one reliable invocation pattern (temp-file + `$(cat ...)`)
- The `save()` screenshot helper
- Clicking & navigating (coordinate vs. JS)
- Filling React-controlled inputs
- Proving "no network on interaction" (live-recompute claims)
- Reading results for the report
- Designing the test like the end user

## Connection & auth
- browser-harness attaches to the user's **already-running Chrome** (CDP). First navigation is
  `new_tab(url)` — NOT `goto_url` (which clobbers the user's active tab).
- Because it uses the user's browser, an **authenticated app session is inherited** — you usually
  land logged in. If a navigation redirects to a login page, **stop and ask the user**; never type
  credentials read off the screen.
- `capture_screenshot()` returns/saves to `/tmp/shot.png` (overwritten each call). `js("...")` runs
  JS and returns the result. `page_info()` is a quick "is this alive / what URL" check.

## The one reliable invocation pattern
Multi-step scripts mix Python + JS + quotes, which is quote-escaping hell inline. **Write the
Python to a temp file with a quoted heredoc, then pipe it in** — this passes the body verbatim:

```bash
cat > /tmp/bh.py << 'PYEOF'
import time, shutil
SS = "/abs/path/to/report/screenshots/"          # hardcode the absolute dir
def save(name):
    capture_screenshot(); shutil.copy("/tmp/shot.png", SS + name + ".png"); print("saved", name)

new_tab("http://localhost:3000/inventory"); wait_for_load(); time.sleep(2.5)
print("URL:", page_info().get("url"))
save("01-board")
PYEOF
browser-harness -c "$(cat /tmp/bh.py)"
```

`$(cat file)` inside double quotes inserts the content literally (no re-tokenizing of its quotes),
so the JS/Python quotes inside survive. Avoid `$`/backticks in the script body.

## The `save()` helper
`capture_screenshot()` always writes `/tmp/shot.png`; copy it to the report's `screenshots/` folder
with a **meaningful, ordered name** (`03-whatif-applied.png`). Capture a frame *after* each action
settles (`time.sleep(~1)` after a click/animation) so the shot reflects the new state.

## Clicking & navigating
- **Visible target, by pixel:** `capture_screenshot()` → read the coordinate off the image →
  `click_at_xy(x, y)` → re-screenshot to verify. Hit-testing is compositor-level, so it passes
  through iframes/shadow DOM.
- **Specific element (row / tab / button), by content:** a JS click bubbles to React's delegated
  onClick, so this is reliable and scroll-independent:
  ```python
  js("""[...document.querySelectorAll('tbody tr')].find(e=>e.textContent.includes('SKU-123'))?.click()""")
  js("""[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim().startsWith('Trend')).click()""")
  js("""(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(x=>x.textContent.includes('Apply'));if(b&&!b.disabled){b.click();return 'ok'}return b?'disabled':'no'})()""")
  ```
  When a button doesn't respond, dump candidates to find the real label:
  `js("JSON.stringify([...document.querySelectorAll('[role=dialog] button')].map(b=>({t:b.textContent.trim(),dis:b.disabled})))")`.
- Closing a modal / resetting: re-`new_tab(url)` is the most reliable reset.

## Filling React-controlled inputs
Setting `.value` directly does NOT fire React's onChange. Use the native setter + dispatched
`input`/`change` events, then click the (now-enabled) submit:
```python
js("""window.__set=(sel,v)=>{const el=document.querySelector(sel);const p=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value;}""")
js("""window.__set('input[aria-label="Quantity for adjustment 1"]','8000')""")
```
Target by `aria-label` / `placeholder` — stable across re-renders.

## Proving "no network on interaction"
For "live, recomputes in the browser, no reload" claims, instrument and count requests around the
interaction — a clean `{f:0,x:0}` is hard evidence:
```python
js("""window.__net={f:0,x:0};const of=window.fetch;window.fetch=function(){window.__net.f++;return of.apply(this,arguments)};const ox=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){window.__net.x++;return ox.apply(this,arguments)};1""")
js("window.__net={f:0,x:0}")                       # reset right before the interaction
js("""[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Flat run-rate').click()""")
print("network:", js("JSON.stringify(window.__net)"))   # expect {"f":0,"x":0}
```

## Reading results for the report
Pull the actual on-screen numbers/text with `js("...")` so the report quotes real values, not
guesses (e.g. read a KPI cell's text after an action to show "On hand 623.25 → 573.25"). Pair
every claim with a screenshot.

## Designing the test like the end user
Frame each test as the **end user's real decision**, not a mechanical click:
- their goal in their words ("if I take an 8,000-case order, what stocks out?"),
- a realistic action (model a big order; add a "damaged lot" correction),
- the **before → after** (read tiles/status pre- and post-action; screenshot both).
This is what makes the report read as "it works for *my* job," not "the button clicks."

## Clean up after writes
If a test writes real data (an override, a record), **undo it** (expire/delete) before finishing
— don't leave stray test rows in a live/prod-backed system. On prod, prefer showing the editor /
read path over writing, and say so in the report.
