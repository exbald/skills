# pa_run.py — driver for the `pa` command (see ../SKILL.md).
# Drives page-agent on a page via the extension page-API (window.PAGE_AGENT_EXT.execute),
# injected once with browser-harness. The EXTENSION does the text-based DOM work; browser-harness
# is only the injection vector. No MCP. Reads config + LLM key from ~/.config/page-agent/.
#
# Env: PA_TASK, PA_URL, PA_MODEL, PA_MAXPOLL, PA_INITIAL=0 (driver-tab: don't act on the initial tab).
# Run via:  browser-harness -c "$(< ~/.config/page-agent/pa_run.py)"

import os, time, json

CFG   = os.path.expanduser('~/.config/page-agent')
KEY   = open(os.path.join(CFG, 'key')).read().strip()
conf  = json.load(open(os.path.join(CFG, 'config.json')))
TOKEN = conf['token']
BASE  = conf['baseURL']
MODEL = os.environ.get('PA_MODEL', conf.get('model', 'glm-5-turbo'))
URL   = os.environ.get('PA_URL', 'https://example.com')
TASK  = os.environ.get('PA_TASK', "Click the 'Learn more' link.")
INCLUDE_INITIAL = os.environ.get('PA_INITIAL', '1') != '0'   # PA_INITIAL=0 -> driver-tab pattern
MAXPOLL = int(os.environ.get('PA_MAXPOLL', '45'))
SHOT = os.path.join(CFG, 'last.png')

new_tab(URL)
wait_for_load()
js('localStorage.setItem("PageAgentExtUserAuthToken","%s")' % TOKEN)
js("location.reload()")   # content script exposes the API only at load, when the token matches
wait_for_load()
time.sleep(1.2)
if js('typeof (window.PAGE_AGENT_EXT||{}).execute') != 'function':
    print("ERROR: page-API not exposed (extension not loaded on this Chrome, or token mismatch)")
    raise SystemExit(1)

cfg = {"baseURL": BASE, "model": MODEL, "apiKey": KEY, "includeInitialTab": INCLUDE_INITIAL}
fire = """
(function(cfg, task){
  window.__pa = {status:'init', acts:0, lastAct:null, result:null, error:null};
  try {
    window.PAGE_AGENT_EXT.execute(task, {
      baseURL: cfg.baseURL, model: cfg.model, apiKey: cfg.apiKey,
      includeInitialTab: cfg.includeInitialTab,
      onStatusChange: function(s){ window.__pa.status = s; },
      onActivity: function(a){ window.__pa.acts++; window.__pa.lastAct = (a&&a.type)||null; }
    }).then(function(r){ window.__pa.result = r; })
      .catch(function(e){ window.__pa.error = String(e); });
  } catch(e){ window.__pa.error = String(e); }
  return 'fired';
})(%s, %s);
""" % (json.dumps(cfg), json.dumps(TASK))
print("model:", MODEL, "| initialTab:", INCLUDE_INITIAL, "| url:", URL)
print("task:", TASK)
print(js(fire))   # 'fired' — apiKey is never echoed

final = None
for i in range(MAXPOLL):
    time.sleep(2)
    raw = js('window.__pa ? JSON.stringify(window.__pa) : null')
    if raw is None:
        print(i, "calling-tab context gone (agent navigated it) -> result callback lost")
        final = {"navigated": True}; break
    d = json.loads(raw)
    print(i, d.get("status"), "acts=", d.get("acts"), "last=", d.get("lastAct"),
          "err=", (d.get("error") or "")[:100])
    if d.get("result") is not None or d.get("error"):
        final = d; break

print("=== RESULT ===")
if final and final.get("result"):
    r = final["result"]
    steps = [h for h in r.get("history", []) if h.get("type") == "step"]
    print("success:", r.get("success"))
    print("data:", r.get("data"))
    print("steps:", len(steps))
    for s in steps:
        a = s.get("action", {})
        print("  -", a.get("name"), json.dumps(a.get("input"))[:80], "->", str(a.get("output"))[:80])
elif final and final.get("navigated"):
    print("agent navigated the calling tab; result callback lost.")
    print("  -> for multi-page flows run with PA_INITIAL=0 (driver-tab), or verify by end-state below.")
elif final and final.get("error"):
    print("error:", final["error"])
else:
    print("no result within timeout (raise PA_MAXPOLL)")

try:
    print("url now:", page_info().get("url"))
    capture_screenshot(SHOT); print("screenshot:", SHOT)
except Exception as e:
    print("end-state capture skipped:", e)
