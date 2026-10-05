"""Tests for spec_guard.py. Run: python3 -m unittest test_spec_guard -v"""

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
GUARD = os.environ.get("SPEC_GUARD", os.path.join(HERE, "..", "spec_guard.py"))
FIX = os.path.join(HERE, "fixtures")


def run(*args, cwd=None):
    proc = subprocess.run(
        [sys.executable, GUARD, *args], capture_output=True, text=True, cwd=cwd
    )
    return proc.returncode, proc.stdout + proc.stderr


class LintGood(unittest.TestCase):
    def test_good_spec_passes(self):
        code, out = run("lint", os.path.join(FIX, "good"))
        self.assertEqual(code, 0, out)
        self.assertIn("0 error", out)

    def test_prints_wave_table(self):
        _, out = run("lint", os.path.join(FIX, "good"))
        self.assertRegex(out, r"wave 1: .*w1-email.*w1-schema|wave 1: .*w1-schema.*w1-email")
        self.assertIn("wave 2: w2-api", out)

    def test_dependency_command_with_owned_files_is_not_flagged(self):
        _, out = run("lint", os.path.join(FIX, "good"))
        self.assertNotIn("w1-schema: runs a dependency or generator command", out)


class LintBad(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.code, cls.out = run("lint", os.path.join(FIX, "bad"))

    def test_exit_code_nonzero(self):
        self.assertEqual(self.code, 1, self.out)

    def test_missing_sections(self):
        for section in ("Do not", "Stop and ask", "When done"):
            self.assertIn(f"w1-a: missing section '{section}", self.out)

    def test_overlap_in_wave(self):
        self.assertIn("wave 1: w1-a and w1-b both own", self.out)

    def test_model_name(self):
        self.assertIn("w1-a: names a model or vendor", self.out)

    def test_placeholders(self):
        self.assertIn("w1-a: placeholder or conversation reference", self.out)

    def test_vague_verification(self):
        self.assertIn("w1-a: Verification has no literal command", self.out)

    def test_route_instead_of_path(self):
        self.assertIn("w1-a: '/settings/team' looks like a URL route", self.out)

    def test_bad_tier(self):
        self.assertIn("w1-b: Tier must be T1, T2 or T3", self.out)

    def test_dependency_change_without_owning_manifest(self):
        self.assertIn("w1-b: runs a dependency or generator command", self.out)


class LintEdgeCases(unittest.TestCase):
    TEMPLATE = textwrap.dedent("""\
        # {id}: x

        ## Wave
        1

        ## Tier
        T1

        ## Goal
        {goal}

        ## Files you may modify
        - `{path}`

        ## Files you may create
        none

        ## Verification
        - `pnpm test` passes.

        ## Acceptance criteria
        - [ ] x

        ## Do not
        - Push.

        ## Stop and ask the coordinator if
        - Unsure.

        ## When done
        Send worker_done.
        """)

    def lint_one(self, goal="Do the thing.", path="src/a.ts"):
        spec = tempfile.mkdtemp()
        os.makedirs(os.path.join(spec, "tasks"))
        with open(os.path.join(spec, "tasks", "w1-x.md"), "w") as f:
            f.write(self.TEMPLATE.format(id="w1-x", goal=goal, path=path))
        return run("lint", spec)

    def test_harness_instruction_files_are_not_model_names(self):
        code, out = self.lint_one(goal="Follow `CLAUDE.md`, `AGENTS.md` and `.claude/rules/style.md`.")
        self.assertEqual(code, 0, out)
        self.assertNotIn("names a model", out)

    def test_absolute_path_is_rejected(self):
        code, out = self.lint_one(path="/Users/me/repo/src/a.ts")
        self.assertEqual(code, 1, out)
        self.assertIn("is absolute", out)


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


class Diff(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        git(self.tmp, "init", "-q", "-b", "main")
        git(self.tmp, "config", "user.email", "t@example.com")
        git(self.tmp, "config", "user.name", "t")
        os.makedirs(os.path.join(self.tmp, "src/db/migrations"))
        self.write("src/db/schema.ts", "export const a = 1\n")
        self.write("src/db/schema.test.ts", "test('a', () => {})\ntest('b', () => {})\n")
        self.write("src/other.ts", "x\n")
        git(self.tmp, "add", "-A")
        git(self.tmp, "commit", "-q", "-m", "base")
        git(self.tmp, "checkout", "-q", "-b", "child")
        self.task = os.path.join(self.tmp, "task.md")
        with open(self.task, "w") as f:
            f.write(textwrap.dedent("""\
                # w1-schema: x

                ## Files you may modify
                - `src/db/schema.ts`
                - `src/db/schema.test.ts`

                ## Files you may create
                - `src/db/migrations/`
                """))

    def write(self, rel, content):
        path = os.path.join(self.tmp, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)

    def commit(self):
        git(self.tmp, "add", "-A", "--", ".", ":!task.md")
        git(self.tmp, "commit", "-q", "-m", "change")

    def diff(self):
        return run("diff", self.task, "--base", "main", "--head", "child", "--repo", self.tmp)

    def test_allowed_changes_pass(self):
        self.write("src/db/schema.ts", "export const a = 2\n")
        self.write("src/db/migrations/0007_invites.sql", "create table x();\n")
        self.commit()
        code, out = self.diff()
        self.assertEqual(code, 0, out)
        self.assertIn("PASS", out)

    def test_file_outside_allowlist_fails(self):
        self.write("src/db/schema.ts", "export const a = 2\n")
        self.write("src/other.ts", "y\n")
        self.commit()
        code, out = self.diff()
        self.assertEqual(code, 1, out)
        self.assertIn("outside the allowlist: src/other.ts", out)

    def test_deleted_test_lines_fail(self):
        self.write("src/db/schema.test.ts", "test('a', () => {})\n")
        self.commit()
        code, out = self.diff()
        self.assertEqual(code, 1, out)
        self.assertIn("deletes test lines", out)

    def test_no_changes_fails(self):
        code, out = self.diff()
        self.assertEqual(code, 1, out)
        self.assertIn("no changes", out)


if __name__ == "__main__":
    unittest.main()
