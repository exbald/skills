"""Tests for team_facts.py. Run: python3 -m unittest test_team_facts -v"""
import os, subprocess, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "team_facts.py")
FIXTURE = os.path.join(HERE, "fixtures", "accounts.json")
NOW_MS = "1791176735230"  # 2026-10-05 ~12:45 local, matches the fixture


def run(*args):
    p = subprocess.run([sys.executable, SCRIPT, "--accounts-json", FIXTURE, "--now-ms", NOW_MS, "--no-models", *args],
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


class Quota(unittest.TestCase):
    def test_exhausted_meters(self):
        _, out = run("--hours", "6")
        self.assertRegex(out, r"claude\s+weekly\s+99%.*EXHAUSTED")
        self.assertRegex(out, r"codex\s+weekly\s+100%.*EXHAUSTED")
        self.assertRegex(out, r"cursor\s+Other Models\s+100%.*EXHAUSTED")

    def test_ok_meters(self):
        _, out = run("--hours", "6")
        self.assertRegex(out, r"cursor\s+Cursor Models\s+19%.*ok")
        self.assertRegex(out, r"antigravity\s+Gemini Models\s+0%.*ok")

    def test_fable_meter_is_blocked_by_full_weekly(self):
        # The all-models weekly meter caps every claude model, fable included.
        _, out = run("--hours", "6")
        self.assertRegex(out, r"claude\s+fableWeekly\s+2%\s+EXHAUSTED \(weekly")

    def test_fable_meter_follows_weekly_reset(self):
        _, out = run("--hours", "12")
        self.assertRegex(out, r"claude\s+fableWeekly\s+2%\s+resets during run")

    def test_reset_before_run_end_is_not_exhausted(self):
        # Claude weekly resets ~9h after NOW; a 12h run outlives it.
        _, out = run("--hours", "12")
        self.assertRegex(out, r"claude\s+weekly\s+99%.*resets during run")

    def test_untracked_and_unavailable(self):
        _, out = run()
        self.assertRegex(out, r"zcode.*unknown")
        self.assertIn("untracked by Orca: opencode, opencode2, muse", out)

    def test_agent_mapping_hints(self):
        _, out = run()
        self.assertIn("Other Models = third-party models in cursor", out)


ROSTER = os.path.join(HERE, "fixtures", "roster", "roster.md")
DAY_MS = 86400 * 1000
AS_OF_MS = 1791158400000  # 2026-10-05T00:00:00Z


def run_roster(now_ms):
    p = subprocess.run([sys.executable, SCRIPT, "--accounts-json", FIXTURE, "--now-ms", str(now_ms),
                        "--no-models", "--roster", ROSTER], capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


class RosterAge(unittest.TestCase):
    def test_fresh_roster_is_ok(self):
        _, out = run_roster(AS_OF_MS + 3 * DAY_MS)
        self.assertRegex(out, r"ROSTER as of 2026-10-05 \(3 days old\): ok")

    def test_stale_roster_warns(self):
        _, out = run_roster(AS_OF_MS + 20 * DAY_MS)
        self.assertRegex(out, r"ROSTER as of 2026-10-05 \(20 days old\): STALE")
        self.assertIn("refresh references/roster.md or get the user's OK", out)

    def test_missing_date_warns(self):
        p = subprocess.run([sys.executable, SCRIPT, "--accounts-json", FIXTURE, "--no-models",
                            "--roster", FIXTURE], capture_output=True, text=True)
        self.assertIn("ROSTER has no roster_as_of date", p.stdout + p.stderr)


if __name__ == "__main__":
    unittest.main()
