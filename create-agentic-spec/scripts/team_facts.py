#!/usr/bin/env python3
"""Print the facts needed to pick an agent team: quota per meter and models per agent.

  python3 team_facts.py [--hours N] [--no-models] [--probe-clis]

--hours N     expected run length; a meter that resets inside it is not blocking (default 4)
--no-models   skip the model listing
--probe-clis  also ask agy, cursor-agent and opencode for their model lists (slow)

Quota comes from `orca account list --json` (result.rateLimits). Verdicts:
EXHAUSTED (>= 90% and no reset before the run ends), low (>= 70%), ok, unknown.
It first prints the age of references/roster.md (its `roster_as_of:` line);
over 14 days old is STALE.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys

BLOCK_PCT = 90
LOW_PCT = 70
ROSTER_TTL_DAYS = 14
ROSTER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "references", "roster.md")
UNTRACKED = ["opencode", "opencode2", "muse"]
BUCKET_HINTS = {
    ("cursor", "Cursor Models"): "Cursor Models = composer-* and auto in cursor",
    ("cursor", "Other Models"): "Other Models = third-party models in cursor (claude-*, gpt-*, gemini-*, grok-*)",
    ("antigravity", "Gemini Models"): "Gemini Models = gemini-* in antigravity",
    ("antigravity", "Claude and GPT models"): "Claude and GPT models = claude-* and gpt-oss-* in antigravity",
    ("claude", "fableWeekly"): "fableWeekly = an extra cap on fable only; the weekly (all models) meter "
    "caps fable too, so a full weekly blocks every claude model",
}
CATALOG = os.path.expanduser("~/Library/Application Support/orca/agent-model-catalog.json")
CLI_PROBES = {
    "antigravity": ["agy", "models"],
    "cursor": ["cursor-agent", "--list-models"],
    "opencode": ["opencode", "models"],
}


def load_accounts(path):
    if path:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    else:
        proc = subprocess.run(["orca", "account", "list", "--json"], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            sys.exit(f"orca account list failed: {proc.stderr.strip() or proc.stdout.strip()}")
        data = json.loads(proc.stdout)
    return data.get("result", data).get("rateLimits", {})


def meters(provider, info):
    """Yield (meter name, usedPercent, resetsAt ms, reset label)."""
    for key, value in info.items():
        if isinstance(value, dict) and "usedPercent" in value:
            yield key, value["usedPercent"], value.get("resetsAt"), value.get("resetDescription")
    for bucket in info.get("buckets") or []:
        yield bucket["name"], bucket.get("usedPercent", 0), bucket.get("resetsAt"), bucket.get("resetDescription")


def verdict(pct, resets_at, now_ms, hours):
    if pct >= BLOCK_PCT:
        if resets_at and resets_at <= now_ms + hours * 3600 * 1000:
            return "resets during run (usable after reset)"
        return "EXHAUSTED"
    return "low" if pct >= LOW_PCT else "ok"


def reset_label(resets_at, label):
    if label:
        return label
    if resets_at:
        return datetime.datetime.fromtimestamp(resets_at / 1000).strftime("%a %H:%M")
    return "-"


def print_quota(limits, now_ms, hours):
    print(f"QUOTA (run length {hours}h; blocked at >= {BLOCK_PCT}%)")
    hints = []
    for provider, info in limits.items():
        if not isinstance(info, dict) or "provider" not in info:
            continue
        if info.get("status") != "ok":
            print(f"  {provider:<12} {'-':<22} {'':>5}  unknown ({info.get('error') or info.get('status')})")
            continue
        rows = list(meters(provider, info))
        bucketed = {b["name"] for b in info.get("buckets") or []}
        weekly = info.get("weekly") if provider == "claude" else None
        weekly_state = verdict(weekly["usedPercent"], weekly.get("resetsAt"), now_ms, hours) if weekly else None
        for name, pct, resets_at, label in rows:
            # A provider total that has per-bucket detail is shown only through its buckets.
            if bucketed and name in ("monthly", "weekly") and provider in ("cursor", "antigravity"):
                continue
            state = verdict(pct, resets_at, now_ms, hours)
            if name == "fableWeekly" and weekly_state not in (None, "ok", "low"):
                state = f"{weekly_state} (weekly caps every claude model)"
            print(f"  {provider:<12} {name:<22} {round(pct):>4}%  {state}"
                  f"  (resets {reset_label(resets_at, label)})")
            hint = BUCKET_HINTS.get((provider, name))
            if hint:
                hints.append(hint)
    print(f"  untracked by Orca: {', '.join(UNTRACKED)} (usable; watch worker output for rate-limit errors)")
    for hint in hints:
        print(f"  note: {hint}")


def print_roster_age(path, now_ms):
    try:
        with open(path, encoding="utf-8") as f:
            match = re.search(r"^roster_as_of:\s*(\d{4}-\d{2}-\d{2})\s*$", f.read(), re.M)
    except OSError as exc:
        print(f"ROSTER unreadable ({exc}); treat the routing data as stale")
        return
    if not match:
        print("ROSTER has no roster_as_of date; treat the routing data as stale")
        return
    as_of = datetime.datetime.fromisoformat(match.group(1)).replace(tzinfo=datetime.timezone.utc)
    age = int((now_ms - as_of.timestamp() * 1000) // (86400 * 1000))
    state = "ok" if age <= ROSTER_TTL_DAYS else (
        f"STALE (over {ROSTER_TTL_DAYS} days): refresh references/roster.md or get the user's OK to use it as is")
    print(f"ROSTER as of {match.group(1)} ({age} days old): {state}")


def print_models(probe):
    print("MODELS")
    try:
        with open(CATALOG, encoding="utf-8") as f:
            catalog = json.load(f)
        for entry in catalog.get("entries", []):
            ids = ", ".join(m["id"] for m in entry.get("models", []))
            print(f"  {entry['agent']:<12} {ids}")
    except (OSError, ValueError) as exc:
        print(f"  catalog unreadable ({exc}); list models with the agent CLIs")
    if not probe:
        print("  (antigravity/cursor/opencode: rerun with --probe-clis, or `agy models`, "
              "`cursor-agent --list-models`, `opencode models`)")
        return
    for agent, argv in CLI_PROBES.items():
        try:
            out = subprocess.run(argv, capture_output=True, text=True, timeout=60).stdout
        except (OSError, subprocess.TimeoutExpired) as exc:
            print(f"  {agent:<12} probe failed: {exc}")
            continue
        ids = [line.split()[0] for line in out.splitlines()
               if line.strip() and not line.lower().startswith(("available", "fetching"))]
        print(f"  {agent:<12} {', '.join(ids[:40])}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hours", type=float, default=4)
    parser.add_argument("--no-models", action="store_true")
    parser.add_argument("--probe-clis", action="store_true")
    parser.add_argument("--accounts-json", help=argparse.SUPPRESS)
    parser.add_argument("--now-ms", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--roster", default=ROSTER, help=argparse.SUPPRESS)
    args = parser.parse_args()
    now_ms = args.now_ms or int(datetime.datetime.now().timestamp() * 1000)
    print_roster_age(args.roster, now_ms)
    print_quota(load_accounts(args.accounts_json), now_ms, args.hours)
    if not args.no_models:
        print_models(args.probe_clis)
    return 0


if __name__ == "__main__":
    sys.exit(main())
