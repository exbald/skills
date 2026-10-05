#!/usr/bin/env python3
"""Mechanical checks for create-agentic-spec specs and worker results.

  python3 spec_guard.py lint <spec_dir>
      Check every tasks/*.md: required sections, valid wave and tier, literal
      verification commands, no placeholders, no model names, no two tasks in
      one wave owning the same file. Exit 1 on any error.

  python3 spec_guard.py diff <task_file> --base <ref> --head <ref> [--repo <dir>]
      Check a worker's branch: every changed file is in the task's allowlist,
      no test lines were deleted, and something changed. Exit 1 on failure.
"""

import argparse
import fnmatch
import glob
import os
import re
import subprocess
import sys

REQUIRED_SECTIONS = [
    "Wave",
    "Tier",
    "Goal",
    "Files you may modify",
    "Files you may create",
    "Verification",
    "Acceptance criteria",
    "Do not",
    "Stop and ask",
    "When done",
]
FILE_SECTIONS = ("Files you may modify", "Files you may create")
SPEC_FILES = ("requirements.md", "team.md", "plan.md", "action-required.md", "run-state.md")

MODEL_NAMES = re.compile(
    r"\b(claude|opus|sonnet|fable|haiku|gpt-?\d[\w.-]*|codex|gemini|glm-?\d[\w.-]*|"
    r"muse[- ]spark|deepseek|grok-?\d[\w.-]*|composer-?\d[\w.-]*|llama-?\d*|qwen\w*|kimi)\b",
    re.IGNORECASE,
)
PLACEHOLDERS = re.compile(
    r"\b(TBD|TODO|FIXME|XXX)\b|as discussed|see (the )?(conversation|chat|above)|like before",
    re.IGNORECASE,
)
VAGUE = re.compile(
    r"make sure|ensure (that )?it works|verify it works|should work|as needed|if necessary",
    re.IGNORECASE,
)
DEP_COMMANDS = re.compile(
    r"\b(pnpm|npm|yarn|bun) (add|install|i|remove)\b|\bpip install\b|\bpoetry add\b|"
    r"\bcargo add\b|\bgo get\b|db:generate|drizzle-kit generate|prisma migrate|"
    r"alembic revision|rails generate migration",
    re.IGNORECASE,
)
DEP_FILES = re.compile(
    r"(^|/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|"
    r"requirements\.txt|poetry\.lock|pyproject\.toml|Cargo\.(toml|lock)|go\.(mod|sum))$|"
    r"(^|/)migrations?(/|$)|(^|/)prisma(/|$)"
)
TEST_PATH = re.compile(r"(^|/)(__tests__|tests?|e2e|spec)/|\.(test|spec)\.[A-Za-z]+$")
HARNESS_FILES = re.compile(
    r"[\w./-]*\b(CLAUDE|GEMINI|AGENTS)\.md\b|\.(claude|codex|gemini|cursor|opencode|zcode)/[\w./-]*",
    re.IGNORECASE,
)
ALLOW_MODEL = "guard:allow-model-name"


def parse_sections(text):
    """Map '## Heading' -> body text."""
    sections, current, lines = {}, None, []
    for line in text.splitlines():
        match = re.match(r"^##\s+(.+?)\s*$", line)
        if match:
            if current is not None:
                sections[current] = "\n".join(lines).strip()
            current, lines = match.group(1), []
        elif current is not None:
            lines.append(line)
    if current is not None:
        sections[current] = "\n".join(lines).strip()
    return sections


def find_section(sections, name):
    for heading, body in sections.items():
        if heading.lower().startswith(name.lower()):
            return body
    return None


def owned_paths(sections):
    paths = []
    for name in FILE_SECTIONS:
        body = find_section(sections, name) or ""
        paths.extend(re.findall(r"`([^`\s]+)`", body))
    return paths


def overlaps(a, b):
    def norm(p):
        return p.rstrip("*").rstrip("/") if p.endswith(("/", "/**")) else p

    def is_dir(p):
        return p.endswith(("/", "/**"))

    if a == b:
        return True
    if is_dir(a) and (b + "/").startswith(norm(a) + "/"):
        return True
    if is_dir(b) and (a + "/").startswith(norm(b) + "/"):
        return True
    return fnmatch.fnmatch(a, b) or fnmatch.fnmatch(b, a)


def lint_task(path):
    """Return (task_id, wave, owned paths, errors, warnings)."""
    task_id = os.path.splitext(os.path.basename(path))[0]
    with open(path, encoding="utf-8") as f:
        text = f.read()
    sections = parse_sections(text)
    errors, warnings = [], []

    for name in REQUIRED_SECTIONS:
        if find_section(sections, name) is None:
            errors.append(f"{task_id}: missing section '{name}...'")

    wave = None
    wave_body = find_section(sections, "Wave")
    if wave_body is not None:
        match = re.search(r"\d+", wave_body)
        if match:
            wave = int(match.group())
        else:
            errors.append(f"{task_id}: Wave has no number")

    tier_body = find_section(sections, "Tier")
    if tier_body is not None and not re.search(r"\bT[123]\b", tier_body):
        errors.append(f"{task_id}: Tier must be T1, T2 or T3")

    verification = find_section(sections, "Verification")
    if verification is not None and not re.search(r"`[^`]+`", verification):
        errors.append(f"{task_id}: Verification has no literal command in backticks")
    if verification and VAGUE.search(verification):
        warnings.append(f"{task_id}: Verification uses vague wording ('{VAGUE.search(verification).group()}')")

    scrubbed = [HARNESS_FILES.sub("", l) for l in text.splitlines() if ALLOW_MODEL not in l]
    model_lines = [l for l in scrubbed if MODEL_NAMES.search(l)]
    if model_lines:
        hit = MODEL_NAMES.search(model_lines[0]).group()
        errors.append(f"{task_id}: names a model or vendor ('{hit}'); worker files must be model-agnostic")

    placeholder = PLACEHOLDERS.search(text)
    if placeholder:
        errors.append(f"{task_id}: placeholder or conversation reference ('{placeholder.group()}')")

    paths = owned_paths(sections)
    for p in paths:
        if re.match(r"^/[a-z0-9-]+(/[a-z0-9\[\]-]+)*/?$", p) and p.count("/") <= 3:
            errors.append(f"{task_id}: '{p}' looks like a URL route, not a repo path")
        elif p.startswith(("/", "~")):
            errors.append(f"{task_id}: '{p}' is absolute; use a repo-relative path")

    commands = " ".join(re.findall(r"`([^`]+)`", (verification or "") + "\n" + (find_section(sections, "Steps") or "")))
    if DEP_COMMANDS.search(commands) and not any(DEP_FILES.search(p) for p in paths):
        warnings.append(
            f"{task_id}: runs a dependency or generator command but owns no manifest, lockfile or migrations path"
        )

    if not paths and find_section(sections, "Files you may modify") is not None:
        warnings.append(f"{task_id}: owns no files (read-only task?)")

    return task_id, wave, paths, errors, warnings


def cmd_lint(spec_dir):
    task_files = sorted(glob.glob(os.path.join(spec_dir, "tasks", "*.md")))
    errors, warnings = [], []
    if not task_files:
        errors.append(f"no task files under {spec_dir}/tasks/")
    for name in SPEC_FILES:
        if not os.path.exists(os.path.join(spec_dir, name)):
            warnings.append(f"spec: {name} is missing")

    waves = {}
    for path in task_files:
        task_id, wave, paths, errs, warns = lint_task(path)
        errors.extend(errs)
        warnings.extend(warns)
        waves.setdefault(wave, []).append((task_id, paths))

    for wave, tasks in sorted(waves.items(), key=lambda kv: (kv[0] is None, kv[0] or 0)):
        for i, (a_id, a_paths) in enumerate(tasks):
            for b_id, b_paths in tasks[i + 1:]:
                shared = sorted({a for a in a_paths for b in b_paths if overlaps(a, b)})
                if shared:
                    errors.append(f"wave {wave}: {a_id} and {b_id} both own {', '.join(shared)}")

    for wave, tasks in sorted(waves.items(), key=lambda kv: (kv[0] is None, kv[0] or 0)):
        print(f"wave {wave}: " + ", ".join(t for t, _ in tasks))
    for line in errors:
        print(f"ERROR   {line}")
    for line in warnings:
        print(f"WARNING {line}")
    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


def git(repo, *args):
    proc = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"git {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout


def allowed(path, patterns):
    for pattern in patterns:
        if pattern.endswith("/") and path.startswith(pattern):
            return True
        if pattern.endswith("/**") and path.startswith(pattern[:-2]):
            return True
        if path == pattern or fnmatch.fnmatch(path, pattern):
            return True
    return False


def cmd_diff(task_file, base, head, repo):
    with open(task_file, encoding="utf-8") as f:
        patterns = owned_paths(parse_sections(f.read()))
    changed = [p for p in git(repo, "diff", "--name-only", f"{base}...{head}").splitlines() if p]
    problems = []
    if not changed:
        problems.append("no changes between base and head")
    outside = [p for p in changed if not allowed(p, patterns)]
    if outside:
        problems.append("outside the allowlist: " + ", ".join(outside))
    deleted = 0
    for row in git(repo, "diff", "--numstat", f"{base}...{head}").splitlines():
        parts = row.split("\t")
        if len(parts) == 3 and TEST_PATH.search(parts[2]) and parts[1].isdigit():
            deleted += int(parts[1])
    if deleted:
        problems.append(f"deletes test lines ({deleted}); a task may add tests but never remove or weaken them")

    print(f"changed: {', '.join(changed) or '(none)'}")
    if problems:
        for line in problems:
            print(f"FAIL {line}")
        return 1
    print("PASS diff is inside the allowlist and deletes no test lines")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    lint = sub.add_parser("lint")
    lint.add_argument("spec_dir")
    diff = sub.add_parser("diff")
    diff.add_argument("task_file")
    diff.add_argument("--base", required=True)
    diff.add_argument("--head", required=True)
    diff.add_argument("--repo", default=".")
    args = parser.parse_args()
    if args.cmd == "lint":
        return cmd_lint(args.spec_dir)
    return cmd_diff(args.task_file, args.base, args.head, args.repo)


if __name__ == "__main__":
    sys.exit(main())
