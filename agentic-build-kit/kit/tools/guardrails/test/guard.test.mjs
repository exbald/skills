import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { SCRIPTS, createFixture, expectDeny, expectSilent } from "./fixture.mjs";

describe("guard: rules that apply with or without a task", () => {
  let fx;
  before(() => {
    fx = createFixture();
  });
  after(() => fx.cleanup());

  describe(".env files", () => {
    it("denies reading, writing and editing them anywhere", () => {
      expectDeny(fx.guard("Read", { file_path: fx.path(".env") }), /\.env/);
      expectDeny(fx.guard("Read", { file_path: fx.path(".env.local") }), /\.env/);
      expectDeny(fx.guard("Write", { file_path: fx.path(".env"), content: "A=1" }), /\.env/);
      expectDeny(fx.guard("Edit", { file_path: fx.path("config/.env.production"), old_string: "a", new_string: "b" }), /\.env/);
      expectDeny(fx.guard("MultiEdit", { file_path: fx.path(".env.local"), edits: [] }), /\.env/);
    });

    it("lets other files be read", () => {
      expectSilent(fx.guard("Read", { file_path: fx.path("src/app.ts") }));
    });

    it("denies Grep searches aimed at them, by path or glob", () => {
      expectDeny(fx.guard("Grep", { pattern: "KEY", path: fx.path(".env.local") }), /\.env/);
      expectDeny(fx.guard("Grep", { pattern: "KEY", path: fx.path("."), glob: ".env*" }), /\.env/);
      expectSilent(fx.guard("Grep", { pattern: "KEY", path: fx.path("src") }));
      expectSilent(fx.guard("Grep", { pattern: "KEY", glob: "*.ts" }));
    });

    it("denies shell commands that read, copy or write them", () => {
      const commands = [
        "cat .env.local",
        "grep KEY .env",
        "head -n 3 config/.env.production",
        "source .env.local && node x.mjs",
        ". ./.env.local",
        "cp .env.local /tmp/x",
        "sort < .env",
        "echo A=1 >> .env.local",
        "tee .env < values.txt",
        "cat .env*",
      ];
      for (const command of commands) expectDeny(fx.bash(command), /\.env/);
    });

    it("denies printing the environment", () => {
      for (const command of ["printenv", "printenv OPENAI_API_KEY", "env", "env | grep KEY", "FOO=1 env"]) {
        expectDeny(fx.bash(command), /environment/i);
      }
    });

    it("allows loading them into a process with --env-file, and searching for the name", () => {
      expectSilent(fx.bash("node --env-file=.env.local x.mjs"));
      expectSilent(fx.bash("env NODE_ENV=test node --env-file=.env.local x.mjs"));
      expectSilent(fx.bash("grep -rn .env.local docs/"));
    });
  });

  describe("protected paths", () => {
    it("denies writes to the folder the config protects, saying where the rule comes from", () => {
      const reason = expectDeny(fx.guard("Write", { file_path: fx.path("design/screens/S02-home/screen.png"), content: "x" }));
      assert.match(reason, /design\/screens\/ is protected \(agentkit\.config\.json, protectedPaths\)/);
      expectSilent(fx.guard("Write", { file_path: fx.path("design/notes.md"), content: "x" }));
      expectSilent(fx.guard("Write", { file_path: fx.path("design/screens-old/a.png"), content: "x" }));
    });

    it("denies writes to frozen design screens", () => {
      expectDeny(fx.guard("Write", { file_path: fx.path("design/screens/S01-welcome/screen.html"), content: "x" }), /design\/screens/);
      expectDeny(fx.guard("Edit", { file_path: fx.path("design/screens/S01-welcome/meta.json"), old_string: "a", new_string: "b" }), /design\/screens/);
      expectDeny(fx.bash("echo x > design/screens/S01-welcome/screen.html"), /design\/screens/);
      expectDeny(fx.bash("rm -rf design/screens/S01-welcome"), /design\/screens/);
    });

    it("denies hand edits of lockfiles but not npm installs", () => {
      expectDeny(fx.guard("Edit", { file_path: fx.path("package-lock.json"), old_string: "a", new_string: "b" }), /package-lock\.json/);
      expectDeny(fx.guard("Write", { file_path: fx.path("apps/mobile/yarn.lock"), content: "" }), /yarn\.lock/);
      expectDeny(fx.guard("Write", { file_path: fx.path("pnpm-lock.yaml"), content: "" }), /pnpm-lock\.yaml/);
      expectDeny(fx.bash("sed -i '' 's/a/b/' package-lock.json"), /package-lock\.json/);
      expectSilent(fx.bash("npm install"));
      expectSilent(fx.bash("npm ci"));
    });

    it("denies writes inside .git", () => {
      expectDeny(fx.guard("Write", { file_path: fx.path(".git/hooks/pre-commit"), content: "" }), /\.git/);
      expectDeny(fx.bash("echo x > .git/config"), /\.git/);
      expectDeny(fx.bash("cp hook.sh .git/hooks/pre-push"), /\.git/);
    });

    it("lets protected paths be read", () => {
      expectSilent(fx.guard("Read", { file_path: fx.path("design/screens/S01-welcome/screen.html") }));
      expectSilent(fx.bash("cat package-lock.json .git/HEAD"));
    });
  });

  describe("forbidden commands", () => {
    const denied = [
      ["git push --force", /force/i],
      ["git push -f origin feat/demo", /force/i],
      ["git push --force-with-lease origin feat/demo", /force/i],
      ["git push origin +feat/demo", /force/i],
      ["git push -uf origin feat/demo", /force/i],
      ["git push origin main", /main/],
      ["git push origin HEAD:main", /main/],
      ["git push origin feat/demo:refs/heads/master", /master/],
      ["git push --all origin", /main/],
      ["FOO=1 git push --force", /force/i],
      ["git status && (git push --force)", /force/i],
      ["echo $(git push --force)", /force/i],
      ["bash -c 'git push --force'", /force/i],
      ["git -C . push --force", /force/i],
      ["git reset --hard", /reset --hard/],
      ["git reset --hard HEAD~1", /reset --hard/],
      ["git rebase main", /history/i],
      ["git filter-branch --tree-filter x HEAD", /history/i],
      ["git filter-repo --path secrets.txt --invert-paths", /history/i],
      ["bfg --delete-files secrets.txt", /history/i],
      ["git commit --amend", /history/i],
      ["git commit --amend --no-edit", /history/i],
      ["git commit -m wip --no-verify", /hook/i],
      ["git commit -nm wip", /hook/i],
      ["git push --no-verify", /hook/i],
      ["git -c core.hooksPath=/dev/null commit -m x", /hook/i],
      ["git clean -fdx", /\.env\.local/],
      ["gh pr merge 1", /merge-approved\.mjs/],
      ["gh pr merge 12 --squash --delete-branch", /merge-approved\.mjs/],
      ["gh repo delete owner/repo --yes", /repository/i],
      ["fly deploy", /deploy-approved\.mjs/],
      ["flyctl deploy -a acme", /deploy-approved\.mjs/],
      ["fly deploy --image registry.fly.io/acme:deployment-01M5", /deploy-approved\.mjs/],
      ["fly secrets deploy", /deploy-approved\.mjs/],
      ["fly image update -a acme", /only read state/],
      ["fly machine update 48ee712fd796d8 --image registry.fly.io/acme:old", /only read state/],
      ["fly m run nginx", /only read state/],
      ["fly machines clone 48ee712fd796d8", /only read state/],
      ["fly machine stop 48ee712fd796d8", /only read state/],
      ["fly -a acme machine suspend 48ee712fd796d8", /only read state/],
      ["fly machine kill 48ee712fd796d8", /only read state/],
      ["fly machine exec 48ee712fd796d8 printenv", /only read state/],
      ["fly scale count 2 -a acme", /only read state/],
      ["flyctl scale memory 2048", /only read state/],
      ["fly ssh console -C printenv", /only read state/],
      ["fly console", /only read state/],
      ["fly proxy 8080", /only read state/],
      ["fly ips release 1.2.3.4", /only read state/],
      ["fly certs add example.com", /only read state/],
      ["fly volumes create data --size 1", /only read state/],
      ["fly storage create", /only read state/],
      ["fly auth token", /only read state/],
      ["fly releases rollback v1", /only read state/],
      ["fly version upgrade", /only read state/],
      ["fly status extra-word", /only read state/],
      ["fly secrets set X=1", /secret/i],
      ["fly secrets unset X", /secret/i],
      ["fly secrets import < secrets.txt", /secret/i],
      ["fly apps destroy acme", /destroy/i],
      ["fly volumes destroy vol_123", /destroy/i],
      ["fly machine destroy 123 --force", /destroy/i],
      ["fly machines destroy 123", /destroy/i],
      ["npm run deploy", /deploy/i],
      ["npx vercel deploy --prod", /vercel deploy is reserved for Alex \(agentkit\.config\.json, deniedCommands\)/],
      ["pkill node", /PID/],
      ["killall node", /PID/],
      ["lsof -ti:3000 | xargs kill", /PID/],
      ["lsof -nP -ti tcp:3000 -sTCP:LISTEN | xargs -r kill -INT", /PID/],
      ["kill $(lsof -ti:3000)", /PID/],
      ["kill -9 `lsof -t -i:3000`", /PID/],
      ["pgrep -f next | xargs kill", /PID/],
      ["kill -9 -1", /PID/],
      ["fuser -k 3000/tcp", /PID/],
      ["sudo rm x", /sudo/],
      ["sudo -u root ls", /sudo/],
      ["rm -rf /", /delete/i],
      ["rm -fr /", /delete/i],
      ["rm -Rf /", /delete/i],
      ["rm -r -f /*", /delete/i],
      ["rm -rf ~", /delete/i],
      ["rm -rf ~/", /delete/i],
      ["rm -rf $HOME", /delete/i],
      ['rm -rf "$HOME"/*', /delete/i],
      ["rm -rf .", /delete/i],
      ["rm -rf ..", /delete/i],
      ["rm -rf *", /delete/i],
      ["cd src && rm -rf ..", /delete/i],
      ["stripe products list --live", /live/i],
      ["curl https://api.stripe.com/v1/charges -u sk_live_abc123:", /live/i],
      ["echo rk_live_abc", /live/i],
      ["npm publish", /release/i],
      ["eas submit -p android", /release/i],
      ["npx eas-cli submit --platform ios", /release/i],
      ["gh api -X PUT repos/acme/acme/pulls/3/merge", /merge-approved\.mjs/],
      ["gh api --method=PUT /repos/o/r/pulls/3/merge -f merge_method=merge", /merge-approved\.mjs/],
      ["gh api repos/o/r/pulls/3/merge -f merge_method=squash", /merge-approved\.mjs/],
      ["gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"PR_1\"}) { clientMutationId } }'", /merge-approved\.mjs/],
      ["gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {pullRequestId: \"PR_1\"}) { clientMutationId } }'", /merge-approved\.mjs/],
      ["gh api -X POST repos/o/r/merges -f base=main -f head=feat/x", /merge-approved\.mjs/],
      ["gh api repos/o/r/merges -f base=main -f head=feat/x", /merge-approved\.mjs/],
      ["gh api graphql -f query='mutation { mergeBranch(input: {repositoryId: \"R_1\", base: \"main\", head: \"feat/x\"}) { clientMutationId } }'", /merge-approved\.mjs/],
      ["echo q | gh api graphql --input -", /GraphQL/],
      ["gh api graphql --input query.json", /GraphQL/],
      ["gh api graphql -F query=@merge.graphql", /GraphQL/],
      ["gh api /graphql --input query.json", /GraphQL/],
      ["gh api /graphql -F query=@merge.graphql", /GraphQL/],
      ["gh api https://api.github.com/graphql/ --input=query.json", /GraphQL/],
      ["gh api graphql --field=query=@merge.graphql", /GraphQL/],
      ["gh api graphql -Fquery=@-", /GraphQL/],
      ['gh api graphql -f query="$(cat merge.graphql)"', /GraphQL/],
      ["gh api graphql -f query=$QUERY", /GraphQL/],
      ['gh api graphql -F "$FIELD"', /GraphQL/],
      ['gh api -X PUT "repos/o/r/pulls/$PR/merge"', /merge-approved\.mjs/],
      ["gh api -X PUT REPOS/O/R/PULLS/3/MERGE", /merge-approved\.mjs/],
      ["gh alias set mm 'pr merge'", /alias/],
      ["gh alias import aliases.yml", /alias/],
    ];
    for (const [command, pattern] of denied) {
      it(`denies: ${command}`, () => {
        expectDeny(fx.bash(command), pattern);
      });
    }

    it("denies rm -rf of the repository root, also from outside it", () => {
      expectDeny(fx.bash(`rm -rf ${fx.dir}`), /delete/i);
      expectDeny(fx.bash("rm -rf src/.."), /delete/i);
      const input = { cwd: tmpdir(), hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `rm -rf ${fx.dir}` } };
      expectDeny(fx.hook(SCRIPTS.guard, input, tmpdir(), { CLAUDE_PROJECT_DIR: fx.dir }), /delete/i);
    });

    const allowed = [
      "ls",
      "npm run verify",
      "npm test",
      "npx tsc --noEmit -p .",
      'node --test "tools/guardrails/test/*.test.mjs"',
      "git status && git log --oneline -10",
      "git push origin feat/demo",
      "git push -u origin HEAD",
      "git push",
      'git commit -m "docs: never use git push --force or --no-verify"',
      "git commit -F - <<'EOF'\nfix: explain why git push --force is banned\nEOF",
      "git commit -m \"$(cat <<'EOF'\nfix: don't push --force to main\nEOF\n)\"",
      "ls # git push --force",
      "kill 12345",
      "lsof -ti:3000",
      "rm -rf node_modules",
      "rm -rf /tmp/guardrails-test-scratch",
      "fly status",
      "fly secrets list",
      "fly logs -a acme",
      "fly releases -a acme --image",
      "fly image show -a acme",
      "fly scale show",
      "fly machine list",
      "fly machine restart 48ee712fd796d8",
      "fly machine start 48ee712fd796d8",
      "fly -a acme status",
      "fly status --app=acme",
      "fly apps restart acme",
      "fly volumes list -a acme",
      "fly certs list",
      "fly auth whoami",
      "fly version",
      "fly deploy --help",
      "fly releases",
      "fly releases --json --image -a acme",
      "fly logs --machine 48ee712fd796d8 -a acme",
      "fly logs -i 48ee712fd796d8",
      "fly vol list",
      "fly app list",
      "fly cert show example.com",
      "fly platform regions",
      "node tools/guardrails/deploy-approved.mjs",
      "node tools/guardrails/deploy-approved.mjs --dry-run",
      "stripe products list",
      "gh pr view 1",
      "gh pr create --fill",
      "gh api repos/o/r/pulls/3/reviews",
      "gh api repos/o/r/pulls/3/merge",
      "gh api -X GET repos/o/r/pulls/3/merge",
      "gh api repos/o/r/merges",
      "gh api graphql -f query='query { viewer { login } }'",
      "gh api graphql -f query='query { viewer { login } }' -f note='a=@b'",
      "gh api graphql -f query='query($n: Int!) { viewer { login } }' -F n=$N",
      "gh api graphql -F login=@login.txt -f query='query { viewer { login } }'",
      "gh alias list",
      "grep -rn TODO src",
    ];
    for (const command of allowed) {
      it(`stays silent for: ${command.split("\n")[0]}`, () => {
        expectSilent(fx.bash(command));
      });
    }
  });

  describe("failing open", () => {
    it("ignores events other than PreToolUse", () => {
      const input = { cwd: fx.dir, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git push --force" } };
      expectSilent(fx.hook(SCRIPTS.guard, input));
    });

    it("lets the call through on invalid JSON, with a note on stderr", () => {
      const result = fx.rawHook(SCRIPTS.guard, "{not json");
      expectSilent(result);
      assert.match(result.stderr, /guardrails/);
    });

    it("ignores tools it does not check", () => {
      expectSilent(fx.guard("WebFetch", { url: "https://example.com/.env" }));
    });

    it("works without cwd in the input, from the process directory", () => {
      expectDeny(fx.hook(SCRIPTS.guard, { tool_name: "Write", tool_input: { file_path: ".env" } }), /\.env/);
    });
  });
});

describe("guard: what the config adds", () => {
  it("denies a command the config reserves for the owner, however it's run, and nothing beside it", () => {
    const fx = createFixture();
    try {
      for (const command of ["vercel deploy", "npx vercel deploy --prod", "FOO=1 vercel deploy --token x", "sh -c 'vercel deploy'"]) {
        expectDeny(fx.bash(command), /vercel deploy is reserved for Alex/);
      }
      for (const command of ["vercel dev", "vercel --version", "vercel ls deploy"]) expectSilent(fx.bash(command));
    } finally {
      fx.cleanup();
    }
  });

  it("gives a denied command's own reason when the config has one", () => {
    const fx = createFixture({ config: { deniedCommands: [{ command: "eve deploy", reason: "Deploy with node tools/guardrails/deploy-approved.mjs." }] } });
    try {
      expectDeny(fx.bash("npx eve deploy"), /^Deploy with node tools\/guardrails\/deploy-approved\.mjs\.$/);
      expectSilent(fx.bash("npx eve dev"));
    } finally {
      fx.cleanup();
    }
  });

  it("treats the configured default branch as a release branch, beside main and master", () => {
    const fx = createFixture({ config: { defaultBranch: "trunk" } });
    try {
      expectDeny(fx.bash("git push origin trunk"), /Never push to main or master or trunk directly/);
      expectDeny(fx.bash("git push origin main"), /main/);
      expectSilent(fx.bash("git push origin feat/demo"));
    } finally {
      fx.cleanup();
    }
  });

  it("keeps the rules that need no config when the config is broken", () => {
    const fx = createFixture({ config: { protectedPaths: "design/screens/" } });
    try {
      expectDeny(fx.guard("Read", { file_path: fx.path(".env") }), /\.env/);
      expectDeny(fx.bash("git push --force"), /force/i);
      expectDeny(fx.bash("git push origin main"), /main/);
      expectSilent(fx.guard("Write", { file_path: fx.path("design/screens/S01-welcome/screen.html"), content: "x" }));
    } finally {
      fx.cleanup();
    }
  });

  it("works with no config at all, on the defaults", () => {
    const fx = createFixture({ config: null });
    try {
      expectDeny(fx.bash("pkill node"), /the project owner's editor/);
      expectSilent(fx.guard("Write", { file_path: fx.path("design/screens/S01-welcome/screen.html"), content: "x" }));
    } finally {
      fx.cleanup();
    }
  });
});

describe("guard: pushing from main", () => {
  let fx;
  before(() => {
    fx = createFixture();
    fx.git("switch", "-q", "main");
  });
  after(() => fx.cleanup());

  it("denies any push while the current branch is main", () => {
    expectDeny(fx.bash("git push"), /main/);
    expectDeny(fx.bash("git push origin feat/demo"), /main/);
  });
});
