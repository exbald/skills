"""Drive Upwork's Project Catalog wizard from a JSON config.

Run with:  CFG=/path/to/config.json browser-harness < scripts/build_project.py

Encodes every technique learned in docs/listing-specs/BUILD-LOG.md, notably:
  - category must be set through the "Browse all categories" modal, since
    Upwork's auto-suggestions are unusable
  - per-tier revision comboboxes render at a FIXED screen position, so options
    must be chosen with the keyboard, not coordinate clicks
  - the gallery file input cannot be set directly; intercept the OS file
    chooser, then fix Cropper.js's inset crop box through its own API
  - Add buttons must be scoped to their own form container, or the click lands
    on a different section's Add
Leaves the project as a DRAFT. Never submits.
"""
import json, os, time

CFG = json.load(open(os.environ["CFG"]))
IMG = CFG["image"]


def jse(expr):
    return js("(() => { %s })()" % expr)


def find_xy(expr):
    """expr must return an element or null."""
    loc = js("""
    (() => {
      const el = (() => { %s })();
      if (!el) return 'none';
      el.scrollIntoView({block:'center'});
      const b = el.getBoundingClientRect();
      return JSON.stringify({x:Math.round(b.x+b.width/2), y:Math.round(b.y+b.height/2)});
    })()
    """ % expr)
    return None if not loc.startswith("{") else json.loads(loc)


def click_expr(expr, pause=2):
    """DOM .click() is more reliable here than coordinate clicks: the viewport
    resizes between steps and rects go stale. Falls back to a real mouse event."""
    r = js("""
    (() => {
      const el = (() => { %s })();
      if (!el) return 'none';
      el.scrollIntoView({block:'center'});
      el.click();
      return 'ok';
    })()
    """ % expr)
    if r == "ok":
        time.sleep(pause)
        return True
    c = find_xy(expr)
    if not c:
        return False
    click_at_xy(c["x"], c["y"])
    time.sleep(pause)
    return True


def click_xy_expr(expr, pause=2):
    """Real mouse event. Required for anything that opens a native OS dialog:
    browsers only honour file choosers from trusted user gestures, so a DOM
    .click() silently does nothing there."""
    c = find_xy(expr)
    if not c:
        return False
    click_at_xy(c["x"], c["y"])
    time.sleep(pause)
    return True


def click_btn(text, pause=2, last=False):
    return click_expr(
        "const a=[...document.querySelectorAll('button')].filter(e=>(e.innerText||'').trim().toLowerCase()===%s);"
        "return a.length? a[%s] : null;" % (json.dumps(text.lower()), "a.length-1" if last else "0"),
        pause)


def set_val(eid, val):
    return js("""
    (() => {
      const el=document.getElementById(%s);
      if(!el) return -1;
      const proto = el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el, %s);
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return el.value.length;
    })()
    """ % (json.dumps(eid), json.dumps(val)))


def wait_ready(tries=10):
    for _ in range(tries):
        if "Just a moment" not in page_info()["title"]:
            return True
        time.sleep(4)
    return False


def wait_for_id(eid, tries=15, label=None):
    """Upwork renders each wizard step asynchronously. Acting before the step's
    fields exist silently no-ops, so gate every step on a known element."""
    for _ in range(tries):
        if jse("return !!document.getElementById(%s);" % json.dumps(eid)):
            return True
        time.sleep(2)
    raise SystemExit(f"timed out waiting for {label or eid}")


def wait_for_btn(text, tries=15):
    for _ in range(tries):
        if jse("return [...document.querySelectorAll('button')].some(e=>(e.innerText||'').trim().toLowerCase()===%s);"
               % json.dumps(text.lower())):
            return True
        time.sleep(2)
    raise SystemExit(f"timed out waiting for button {text!r}")


def add_in_form(anchor_id, pause=3):
    """Click the Add button inside the form that owns anchor_id."""
    return click_expr(
        "const ta=document.getElementById(%s); if(!ta) return null;"
        "const box=ta.closest('.up-modify')||ta.parentElement.parentElement;"
        "return [...box.querySelectorAll('button')].find(b=>/^add$/i.test((b.innerText||'').trim()))||null;"
        % json.dumps(anchor_id), pause)


def pick_option(text, pause=2.5, scroll_tries=6):
    """Select a listbox option by exact text.

    Two traps: the site header's search dropdown also uses [role=option] but
    renders at zero size, and long lists are scrolled so the target may not be
    in view. Scroll the listbox and retry before giving up.
    """
    sel = ("[...document.querySelectorAll('[role=option]')]"
           ".filter(e=>e.getBoundingClientRect().width>0)"
           ".find(e=>(e.innerText||'').trim()===%s)" % json.dumps(text))
    for _ in range(scroll_tries):
        if click_expr("return %s||null;" % sel, pause):
            return True
        moved = js("""
        (() => {
          const o=[...document.querySelectorAll('[role=option]')].filter(e=>e.getBoundingClientRect().width>0);
          if(!o.length) return 'no options';
          const box=o[0].closest('[role=listbox]')||o[0].parentElement;
          const before=box.scrollTop;
          box.scrollTop = before + box.clientHeight*0.8;
          return box.scrollTop>before ? 'scrolled' : 'end';
        })()
        """)
        if moved != "scrolled":
            return False
        time.sleep(1)
    return False


RESUME = os.environ.get("PID")

if RESUME:
    print("=== RESUMING", RESUME, "-> skipping Overview ===")
    pid = RESUME
    ensure_real_tab()
    goto_url(f"https://www.upwork.com/nx/project-dashboard/{pid}?step=Pricing")
    wait_for_load(); wait_ready(); time.sleep(3)
else:
  print("=== STEP 1: OVERVIEW ===")
  ensure_real_tab()
  goto_url("https://www.upwork.com/nx/project-dashboard/create")
  wait_for_load(); wait_ready(); time.sleep(3)

  # Title has a stable id. Width-based selectors are ambiguous here because the
  # readonly "You will get" prefix input sits at almost the same coordinates.
  for _ in range(10):
      if jse("return !!document.getElementById('project-title-input');"):
          break
      time.sleep(3)

  for attempt in range(4):
      n = set_val("project-title-input", CFG["title"])
      time.sleep(2)
      print(f"  title attempt {attempt+1}: {n} chars")
      if isinstance(n, int) and n >= 10:
          break
      time.sleep(2)
  else:
      raise SystemExit("could not set title")

  # Category, via the modal. Auto-suggestions are unusable.
  for attempt in range(4):
      click_expr("return [...document.querySelectorAll('button,a')].find(e=>/browse all categories/i.test((e.innerText||'').trim()))||null;", 3)
      if jse("return !!document.querySelector('[role=dialog],[aria-modal=true],.air3-modal,.up-modal');"):
          print("  category modal open")
          break
      time.sleep(2)
  else:
      raise SystemExit("category modal never opened")

  for level, name in enumerate(CFG["cat"]):
      # Level 0 uses the first combobox. Deeper levels use the "Narrow down"
      # combobox, because an extra empty combobox appears after each selection
      # and index-based targeting silently picks the wrong one.
      if level == 0:
          expr = ("const d=document.querySelector('[role=dialog],[aria-modal=true],.air3-modal,.up-modal');"
                  "if(!d) return null; return [...d.querySelectorAll('[role=combobox]')][0]||null;")
      else:
          expr = ("const d=document.querySelector('[role=dialog],[aria-modal=true],.air3-modal,.up-modal');"
                  "if(!d) return null; const a=[...d.querySelectorAll('[role=combobox]')];"
                  "return a.find(e=>/narrow down/i.test((e.innerText||'')))||a[a.length-1]||null;")
      if not click_expr(expr, 2.5):
          raise SystemExit(f"combobox for level {level} not found")
      ok = pick_option(name)
      print(f"  cat[{level}] {name}: {'ok' if ok else 'FAILED'}")
      if not ok:
          raise SystemExit(f"could not select category level {level}: {name}")
  click_btn("save", 3)
  print("category:", jse("const t=document.body.innerText; const m=t.match(/Development & IT > [^\\n]+/); return m?m[0]:'?';"))

  # Attributes. DOM click works here and survives reflow.
  want = CFG["langs"] + CFG["expertise"]
  print("attrs:", js("""
  (() => {
    const want=%s; let n=0;
    document.querySelectorAll('input[type=checkbox]').forEach(el=>{
      const lbl=(el.closest('label')?.innerText||document.querySelector(`label[for="${el.id}"]`)?.innerText||'').trim();
      if(want.includes(lbl) && !el.checked && !el.disabled){ el.click(); n++; }
    });
    const on=[]; document.querySelectorAll('input[type=checkbox]').forEach(el=>{
      if(el.checked){ on.push((el.closest('label')?.innerText||'').trim()); }});
    return 'clicked '+n+' -> '+on.join(', ');
  })()
  """ % json.dumps(want)))

  # Tags
  tagf = find_xy("return [...document.querySelectorAll('input')].find(e=>/start typing to view/i.test(e.placeholder||''))||null;")
  for t in CFG["tags"]:
      click_at_xy(tagf["x"], tagf["y"]); time.sleep(1)
      type_text(t); time.sleep(2)
      press_key("Enter"); time.sleep(2)
  print("tags set")

  click_btn("save & continue", 6)
  wait_for_load(); wait_ready(); time.sleep(2)
  pid = page_info()["url"].split("/nx/project-dashboard/")[1].split("?")[0]
  print("PROJECT ID:", pid)

print("=== STEP 2: PRICING ===")
wait_for_id("Starter-custom-tier-title", label="pricing fields")
T = CFG["tiers"]
for i, tier in enumerate(["Starter", "Standard", "Advanced"]):
    print(" ", tier,
          set_val(f"{tier}-custom-tier-title", T["titles"][i]),
          set_val(f"{tier}-custom-tier-description", T["descs"][i]),
          set_val(f"{tier}-days-to-fulfill", T["days"][i]),
          set_val(f"currency-input-{i}", T["prices"][i]))
    time.sleep(1)

# Revisions: coordinate click to open, then keyboard. DOM clicks on the option
# list are unreliable because every tier's listbox renders in the same fixed
# position, so a text match can hit the wrong column. Verify and retry.
def rev_values():
    return jse("const o=[];document.querySelectorAll('[role=combobox]').forEach(e=>{const b=e.getBoundingClientRect();"
               "if(b.width>100&&b.width<250)o.push((e.innerText||'').trim());});return JSON.stringify(o);")

for i, n in enumerate(T["revisions"]):
    for attempt in range(3):
        press_key("Escape"); time.sleep(0.8)
        combo = find_xy(
            "const a=[...document.querySelectorAll('[role=combobox]')].filter(e=>{const b=e.getBoundingClientRect();"
            "return b.width>100&&b.width<250;}); return a[%d]||null;" % i)
        if not combo:
            print(f"  !! revisions combobox {i} not found"); break
        click_at_xy(combo["x"], combo["y"]); time.sleep(2.5)
        for _ in range(n):
            press_key("ArrowDown"); time.sleep(0.45)
        press_key("Enter"); time.sleep(2)
        vals = json.loads(rev_values())
        if i < len(vals) and vals[i].strip() == str(n):
            break
        print(f"  revisions[{i}] attempt {attempt+1} gave {vals}, retrying")

print("revisions:", jse(
    "const o=[];document.querySelectorAll('[role=combobox]').forEach(e=>{const b=e.getBoundingClientRect();"
    "if(b.width>100&&b.width<250)o.push((e.innerText||'').trim().slice(0,3));});return o.join('|');"))

click_btn("save & continue", 6)
wait_for_load(); wait_ready(); time.sleep(2)

print("=== STEP 3: GALLERY ===")
goto_url(f"https://www.upwork.com/nx/project-dashboard/{pid}?step=Gallery")
wait_for_load(); wait_ready(); time.sleep(3)
wait_for_btn("continue")
time.sleep(2)
cdp("Page.enable"); cdp("DOM.enable")
cdp("Page.setInterceptFileChooserDialog", enabled=True)
fc = []
for attempt in range(6):
    drain_events()
    click_xy_expr("return [...document.querySelectorAll('button,label,a,span')].filter(e=>/^browse$/i.test((e.innerText||'').trim()))[0]||null;", 6)
    ev = drain_events()
    fc = [e for e in ev if "fileChooserOpened" in str(e.get("method", ""))]
    if fc:
        break
    print(f"  browse attempt {attempt+1}: no chooser, retrying")
    time.sleep(3)
if not fc:
    print("!! file chooser never opened, aborting gallery"); raise SystemExit(1)
node = fc[0]["params"]["backendNodeId"]
cdp("DOM.setFileInputFiles", files=[IMG], backendNodeId=node)
time.sleep(6)
# Cropper insets the frame and clips our text panel. Snap it to the full canvas.
print("crop:", jse(
    "const im=[...document.querySelectorAll('img')].find(e=>e.cropper); if(!im) return 'no cropper';"
    "const c=im.cropper, cv=c.getCanvasData();"
    "c.setCropBoxData({left:cv.left,top:cv.top,width:cv.width,height:cv.height});"
    "return JSON.stringify(c.getCropBoxData());"))
time.sleep(1)
click_btn("upload", 10)
click_expr("return [...document.querySelectorAll('button,a,label,span')].find(e=>/set as project cover/i.test((e.innerText||'').trim()))||null;", 3)
print("thumbs:", jse("return document.querySelectorAll('.gallery-item img, .up-image-preview img').length;"))
click_btn("continue", 6)
wait_for_load(); wait_ready(); time.sleep(2)

print("=== STEP 4: REQUIREMENTS ===")
wait_for_btn("add a requirement")
for i, r in enumerate(CFG["reqs"]):
    if i:
        click_btn("add a requirement", 3)
    set_val("requirement-textarea", r)
    time.sleep(1)
    add_in_form("requirement-textarea")
print("reqs added:", jse(
    "const t=document.body.innerText; const m=t.match(/\\n5\\. /); return m?'5 present':'CHECK';"))
click_btn("save & continue", 6)
wait_for_load(); wait_ready(); time.sleep(2)

print("=== STEP 5: DESCRIPTION ===")
wait_for_id("project-description", label="description field")
print("summary:", set_val("project-description", CFG["summary"]))
time.sleep(2)
for i, (name, detail) in enumerate(CFG["steps"]):
    click_btn("add a step", 3)
    set_val("input-title", name)
    set_val("textarea-detail", detail)
    time.sleep(1)
    add_in_form("textarea-detail")
for i, (q, a) in enumerate(CFG["faqs"]):
    click_btn("add a question", 3)
    set_val("input-questions", q)
    set_val("textarea-answer", a)
    time.sleep(1)
    add_in_form("textarea-answer")
print("summary still:", jse("const e=document.getElementById('project-description'); return e?e.value.length:-1;"))
click_btn("save & continue", 7)
wait_for_load(); wait_ready(); time.sleep(2)

print("=== DONE ===")
print("final url:", page_info()["url"])
print("PROJECT ID:", pid, "left as DRAFT, not submitted")
