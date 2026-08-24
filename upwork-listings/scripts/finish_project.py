"""Finish an Upwork project draft from the Requirements step onward.

Run with:  CFG=cfg.json PID=<project id> browser-harness < scripts/finish_project.py

Split out from build_project.py because the gallery step's file chooser is
flaky and often needs a manual assist; once the image is in, everything after
it is deterministic.
"""
import json, os, time

CFG = json.load(open(os.environ["CFG"]))
PID = os.environ["PID"]


def jse(expr):
    return js("(() => { %s })()" % expr)


def click_btn(text, pause=3, scoped_to=None):
    """DOM click. If scoped_to is an element id, only look inside that element's
    own form container, otherwise an 'Add' click lands on a different section."""
    if scoped_to:
        expr = ("const ta=document.getElementById(%s); if(!ta) return null;"
                "const box=ta.closest('.up-modify')||ta.parentElement.parentElement;"
                "return [...box.querySelectorAll('button')].find(b=>(b.innerText||'').trim().toLowerCase()===%s)||null;"
                % (json.dumps(scoped_to), json.dumps(text.lower())))
    else:
        expr = ("return [...document.querySelectorAll('button')].find(e=>(e.innerText||'').trim().toLowerCase()===%s)||null;"
                % json.dumps(text.lower()))
    r = js("""
    (() => {
      const el = (() => { %s })();
      if (!el) return 'none';
      el.scrollIntoView({block:'center'}); el.click(); return 'ok';
    })()
    """ % expr)
    time.sleep(pause)
    return r == "ok"


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


def ready(tries=12):
    for _ in range(tries):
        if "Just a moment" not in page_info()["title"]:
            return
        time.sleep(4)


def wait_for(check, tries=15, what="element"):
    for _ in range(tries):
        if jse(check):
            return True
        time.sleep(2)
    raise SystemExit(f"timed out waiting for {what}")


print("=== REQUIREMENTS ===")
goto_url(f"https://www.upwork.com/nx/project-dashboard/{PID}?step=Requirements")
wait_for_load(); ready(); time.sleep(3)
wait_for("return [...document.querySelectorAll('button')].some(e=>/add a requirement/i.test((e.innerText||'').trim()));",
         what="add-a-requirement button")

for i, r in enumerate(CFG["reqs"]):
    click_btn("add a requirement")
    n = set_val("requirement-textarea", r)
    time.sleep(1)
    ok = click_btn("add", scoped_to="requirement-textarea")
    print(f"  [{i+1}] {n} chars, added={ok}")
present = jse("const t=document.body.innerText; let c=0; for(let i=1;i<=5;i++){ if(t.includes('\\n'+i+'. ')) c++; } return c;")
print("  requirements present:", present)
click_btn("save & continue", 7)
wait_for_load(); ready(); time.sleep(3)

print("=== DESCRIPTION ===")
if "step=Description" not in page_info()["url"]:
    goto_url(f"https://www.upwork.com/nx/project-dashboard/{PID}?step=Description")
    wait_for_load(); ready(); time.sleep(3)
wait_for("return !!document.getElementById('project-description');", what="description field")

print("  summary:", set_val("project-description", CFG["summary"]))
time.sleep(2)
for i, (name, detail) in enumerate(CFG["steps"]):
    click_btn("add a step")
    set_val("input-title", name)
    set_val("textarea-detail", detail)
    time.sleep(1)
    ok = click_btn("add", scoped_to="textarea-detail")
    print(f"  step[{i+1}] {name}: added={ok}")
for i, (q, a) in enumerate(CFG["faqs"]):
    click_btn("add a question")
    set_val("input-questions", q)
    set_val("textarea-answer", a)
    time.sleep(1)
    ok = click_btn("add", scoped_to="textarea-answer")
    print(f"  faq[{i+1}]: added={ok}")

# The summary can be dropped when the page re-renders; re-assert before saving.
if int(jse("const e=document.getElementById('project-description'); return e?e.value.length:0;")) < 100:
    print("  summary was cleared, re-setting:", set_val("project-description", CFG["summary"]))
    time.sleep(2)

click_btn("save & continue", 8)
wait_for_load(); ready(); time.sleep(3)
print("final url:", page_info()["url"])
print("DONE. Project", PID, "left as a DRAFT.")
