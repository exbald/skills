# Upwork listing wizard: mechanics reference

Everything below was established by driving the live wizard. Read before
debugging anything; most "the click did nothing" problems are listed here.

## URLs

| What | URL |
|---|---|
| Dashboard | `https://www.upwork.com/nx/project-dashboard/` |
| Create project | `https://www.upwork.com/nx/project-dashboard/create` |
| Create consultation | `https://www.upwork.com/nx/project-dashboard/create/consultation` |
| Edit any listing, any step | `https://www.upwork.com/nx/project-dashboard/<id>?step=<Step>` |

Steps for projects: `Overview`, `Pricing`, `Gallery`, `Requirements`, `Description`, `Review`.
Steps for consultations: `Overview`, `Pricing`, `Availability`, `Requirements`, `Gallery`, `Policies`.

**Direct step navigation works** and is the fastest way to resume or to skip a
blocked step.

Dead ends: `find-work/services/projects` returns 404. The row menu's "Edit" item
does not navigate reliably; use the URL with the listing id.

## Field limits

| Field | Limit |
|---|---|
| Project title | 75 chars, **minimum 7 words**. Upwork prefixes "You will get" automatically, do not repeat it |
| Search tags | max 5 |
| Custom tier title | 30 chars |
| Custom tier description | **80 chars** |
| Project summary | 1,200 chars, minimum 120 |
| Client requirement | 250 chars, minimum 10 |
| Project step description | 250 chars |
| FAQ answer | 250 chars |
| FAQs | max 5 |
| Consultation description | 1,200 chars |
| Consultation custom topics | max 5 |
| Gallery images | up to 20, 10MB each, under 4,000px per side, jpg/png |

Validate all of these in Python before opening the browser.

## Element ids worth knowing

Stable ids, settable with the native value setter plus `input` and `change` events:

```
project-title-input
Starter-custom-tier-title      Standard-custom-tier-title      Advanced-custom-tier-title
Starter-custom-tier-description  Standard-custom-tier-description  Advanced-custom-tier-description
Starter-days-to-fulfill        Standard-days-to-fulfill        Advanced-days-to-fulfill
currency-input-0 / -1 / -2     Number of Pages-tier0 / 1 / 2
requirement-textarea
project-description
input-title       textarea-detail     (project steps: BOTH are required)
input-questions   textarea-answer     (FAQs)
```

```python
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
```

## Clicking: which method when

Upwork's frontend is **Vue** (air3 design system), not React. DOM nodes carry
`_prevClass` and have no `__reactProps`.

- **Default to DOM `.click()`.** The viewport resizes between steps, so cached
  rects go stale and coordinate clicks land on the wrong element.
- **Use a real mouse event (`click_at_xy`) for anything opening a native OS
  dialog.** Browsers only honour file choosers from trusted user gestures, so a
  DOM click can never open the gallery picker. This is the single most expensive
  trap in the whole flow.
- **Scope "Add" buttons to their own form container**, otherwise the click hits a
  different section's Add:

```python
"const ta=document.getElementById(anchorId);"
"const box=ta.closest('.up-modify')||ta.parentElement.parentElement;"
"return [...box.querySelectorAll('button')].find(b=>/^add$/i.test(b.innerText.trim()));"
```

- **Wait for each step's key element before acting.** Steps render
  asynchronously and acting early silently no-ops.

## Category selection

Auto-suggestions are unusable: a title containing "Lovable or Bolt app" produced
suggestions of Visual Effects, Audio Ads and Match Moving. Always use the
"Browse all categories" modal.

The modal has cascading `[role=combobox]` dropdowns, then a Save button.

Two traps:
1. **An extra empty combobox appears after each selection**, so index-based
   targeting picks the wrong one. Use the first combobox for level 0, then the
   one whose text matches `/narrow down/i` for deeper levels.
2. **The site header's search dropdown also uses `[role=option]`** but renders at
   zero size. Filter options to `getBoundingClientRect().width > 0`.

Long option lists are scrolled; scroll the listbox and retry before failing.

## Revisions dropdowns

Per-tier revisions are `[role=combobox]`, not number inputs, and **every tier's
listbox renders at the same fixed screen position**. Matching an option by text
therefore hits the wrong column. Open with a coordinate click, then keyboard:
`Escape`, click, `ArrowDown` x N, `Enter`. Verify afterwards and retry.

## Gallery upload: the working recipe

A gallery image is **required**; Continue will not advance without one.

Setting the hidden input directly does not work. The dropzone ignores it even
though `input.files.length` becomes 1. Neither do synthetic `drop` events with a
populated `DataTransfer`, at any DOM level.

```python
cdp("Page.enable"); cdp("DOM.enable")
cdp("Page.setInterceptFileChooserDialog", enabled=True)

for attempt in range(6):              # genuinely flaky, retry
    drain_events()
    click_at_xy(x, y)                 # MUST be a real mouse event
    time.sleep(6)                     # 3s is often too short
    ev = drain_events()
    fc = [e for e in ev if "fileChooserOpened" in str(e.get("method",""))]
    if fc: break

cdp("DOM.setFileInputFiles", files=[abs_path], backendNodeId=fc[0]["params"]["backendNodeId"])
```

That opens a crop modal whose default crop box is **inset and clips the left
edge**, destroying any image with a text panel. It is Cropper.js:

```python
js("""
(() => {
  const im=[...document.querySelectorAll('img')].find(e=>e.cropper);
  const c=im.cropper, cv=c.getCanvasData();
  c.setCropBoxData({left:cv.left, top:cv.top, width:cv.width, height:cv.height});
  return JSON.stringify(c.getCropBoxData());
})()
""")
```

Then: modal **Upload** button, then **"Set as project cover"**, then **Continue**.
Screenshot the modal before uploading to confirm framing.

## Other behaviours

- **Project steps need BOTH a name and a description.** Filling only the
  description leaves the Add button inert with no error shown.
- **The project summary can be silently cleared** when the description step
  re-renders after adding steps or FAQs. Re-assert it immediately before saving.
- **Service Tier Options** (Design Customization, Content Upload, Responsive
  Design, Source Code) are website-oriented and optional; skipping them does not
  block saving.
- **Public listing pages cache.** After saving, the live URL may show stale
  content for a while. Verify through the edit wizard, not the public page.
- **Max simultaneous projects** on the Review step defaults to 3.
- Long-text fields **reject domain-shaped strings**. Any token containing a
  dot-TLD, including product names like `Make.com` or `example.art`, is rejected
  from a profile overview with "cannot contain URLs or website addresses". Strip
  the TLD and write the bare brand name instead.
- You may hold **up to 20 published projects**, plus 20 more in review.

## Gallery guidelines vs reality

Upwork's stated guidelines list "text-heavy images" and "Upwork logos or badges"
under what to avoid, and gallery content is documented as the top rejection
reason. In practice, informational text cards with a headline, three labelled
points and a photographic scene **passed review unchanged**, including one
carrying Top Rated Plus badges.

Design for the grid: the thumbnail sits among ~40 competitors and has about a
second to say what is being sold. Atmospheric imagery loses to text there. Check
legibility at thumbnail size, and reroll rather than shipping garbled lettering,
which is the standard failure of image generators.
