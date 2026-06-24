#!/usr/bin/env python3
"""Render a Markdown file (with relative image references) to a polished, client-ready PDF.

Pipeline: Markdown -> styled HTML (python-markdown) -> PDF via headless Chromium (the same
engine browser-harness drives). Self-contained: needs only `python3 -m markdown` and a
Chromium/Chrome binary. Relative image paths (e.g. `screenshots/foo.png`) resolve against the
Markdown file's OWN directory, so screenshots embed with zero path rewriting.

Usage:
    md_to_pdf.py INPUT.md [OUTPUT.pdf]
    # default OUTPUT = INPUT with a .pdf extension, alongside the source.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CHROME_CANDIDATES = [
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
    "/usr/bin/chromium", "/usr/bin/google-chrome",
]

CSS = """
@page { size: A4; margin: 16mm 15mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
       font-size: 10.5pt; line-height: 1.5; color: #1b1b1b; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 6px; }
h2 { font-size: 14pt; margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #e6e6e6;
     page-break-after: avoid; }
h3 { font-size: 12pt; margin: 16px 0 4px; page-break-after: avoid; }
p, li { margin: 6px 0; }
img { max-width: 100%; height: auto; display: block; margin: 10px 0; border: 1px solid #e6e6e6;
      border-radius: 5px; page-break-inside: avoid; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5pt; }
th, td { border: 1px solid #ddd; padding: 6px 9px; text-align: left; vertical-align: top; }
th { background: #f6f6f4; }
code { background: #f4f4f2; padding: 1px 4px; border-radius: 3px; font-size: 9pt; }
pre { background: #f6f6f4; padding: 10px 12px; border-radius: 5px; overflow-x: auto;
      page-break-inside: avoid; font-size: 9pt; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #d0d0d0; margin: 10px 0; padding: 2px 14px; color: #555;
             background: #fafafa; }
hr { border: none; border-top: 1px solid #e6e6e6; margin: 18px 0; }
a { color: #145e2e; text-decoration: none; }
"""

HTML = ('<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head>'
        "<body>{body}</body></html>")


def find_chrome() -> str:
    for c in CHROME_CANDIDATES:
        p = shutil.which(c) or (c if os.path.exists(c) else None)
        if p:
            return p
    sys.exit("No Chrome/Chromium found (tried: %s)" % ", ".join(CHROME_CANDIDATES))


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("usage: md_to_pdf.py INPUT.md [OUTPUT.pdf]")
    src = Path(sys.argv[1]).resolve()
    if not src.exists():
        sys.exit(f"not found: {src}")
    out = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else src.with_suffix(".pdf")

    try:
        import markdown  # python-markdown
    except ImportError:
        sys.exit("python-markdown missing: `pip install --user markdown`")

    body = markdown.markdown(
        src.read_text(encoding="utf-8"),
        extensions=["extra", "tables", "fenced_code", "sane_lists", "toc", "nl2br"],
    )
    html = HTML.format(css=CSS, body=body)

    # Temp HTML written NEXT TO the source so relative image paths resolve; temp Chrome
    # profile so it never clashes with a running browser (singleton lock).
    tmp_html = src.with_name(f".{src.stem}.pdfgen.html")
    tmp_html.write_text(html, encoding="utf-8")
    profile = tempfile.mkdtemp(prefix="md2pdf-")
    chrome = find_chrome()
    try:
        subprocess.run(
            [chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
             f"--user-data-dir={profile}", "--virtual-time-budget=15000",
             f"--print-to-pdf={out}", tmp_html.as_uri()],
            check=True, capture_output=True, text=True, timeout=180,
        )
    except subprocess.CalledProcessError as e:
        sys.exit(f"chromium print-to-pdf failed:\n{e.stderr or e.stdout}")
    finally:
        tmp_html.unlink(missing_ok=True)
        shutil.rmtree(profile, ignore_errors=True)

    if not out.exists() or out.stat().st_size < 1000:
        sys.exit("PDF was not produced (or is suspiciously small)")
    print(f"PDF -> {out}  ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
