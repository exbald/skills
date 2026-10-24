import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { TASK, createFixture, expectDeny, expectSilent, taskText } from "./fixture.mjs";

describe("guard: with an active task", () => {
  let fx;
  before(() => {
    fx = createFixture();
    fx.setTask();
  });
  after(() => fx.cleanup());

  const write = (rel, cwd) => fx.guard("Write", { file_path: rel.startsWith("/") ? rel : fx.path(rel), content: "x" }, { cwd });

  it("stays silent for files the task lists", () => {
    expectSilent(write("src/app.ts"));
    expectSilent(fx.guard("Edit", { file_path: fx.path("README.md"), old_string: "a", new_string: "b" }));
    expectSilent(write("src/new-module.ts"));
    expectSilent(write("src/new-module.test.ts"));
    expectSilent(write("docs/notes/today.md"));
  });

  it("denies other files, naming the file, the task and BLOCKED.md", () => {
    const reason = expectDeny(write("src/other.ts"));
    assert.match(reason, /src\/other\.ts/);
    assert.match(reason, /task-01-demo\.md/);
    assert.match(reason, /BLOCKED\.md/);
    expectDeny(fx.guard("Edit", { file_path: fx.path("package.json"), old_string: "a", new_string: "b" }), /package\.json/);
    expectDeny(fx.guard("NotebookEdit", { notebook_path: fx.path("notebooks/x.ipynb"), new_source: "" }), /notebooks\/x\.ipynb/);
    expectDeny(write("specs/02-other/README.md"), /specs\/02-other/);
  });

  it("treats tests the task doesn't list as the contract", () => {
    expectDeny(write("src/x.test.ts"), /tests are the contract/i);
    expectDeny(fx.guard("Edit", { file_path: fx.path("src/app.test.ts"), old_string: "a", new_string: "b" }), /tests are the contract/i);
    expectDeny(write("docs/notes/notes.spec.ts"), /tests are the contract/i);
    expectDeny(fx.bash("rm src/app.test.ts"), /tests are the contract/i);
    expectDeny(fx.bash("git rm -q src/app.test.ts"), /tests are the contract/i);
  });

  it("checks shell writes against the lists", () => {
    expectDeny(fx.bash("echo hi > unlisted.txt"), /unlisted\.txt/);
    expectDeny(fx.bash("echo hi >> src/other.ts"), /src\/other\.ts/);
    expectDeny(fx.bash("sed -i s/a/b/ unlisted.ts"), /unlisted\.ts/);
    expectDeny(fx.bash("sed -i '' -e 's/a/b/' src/other.ts"), /src\/other\.ts/);
    expectDeny(fx.bash("node build.mjs | tee -a build.log"), /build\.log/);
    expectDeny(fx.bash("cp src/app.ts src/copy.ts"), /src\/copy\.ts/);
    expectDeny(fx.bash("mv src/other.ts src/new-module.ts"), /src\/other\.ts/);
    expectDeny(fx.bash("cp README.md src/"), /src\/README\.md/);
    expectDeny(fx.bash("rm src/other.ts"), /src\/other\.ts/);
    expectDeny(fx.bash("touch src/extra.ts"), /src\/extra\.ts/);
    expectDeny(fx.bash("cd src && echo x > other.ts"), /src\/other\.ts/);
  });

  it("stays silent for shell writes to listed files", () => {
    expectSilent(fx.bash("echo hi > src/app.ts"));
    expectSilent(fx.bash("sed -i '' 's/a/b/' src/app.ts README.md"));
    expectSilent(fx.bash("cp src/app.ts src/new-module.ts"));
    expectSilent(fx.bash("echo note > docs/notes/a.md 2>/dev/null"));
    expectSilent(fx.bash("cd src && echo x > app.ts"));
  });

  it("resolves relative paths from the session directory", () => {
    const writeRelative = (rel) => fx.guard("Write", { file_path: rel, content: "x" }, { cwd: fx.path("src") });
    expectDeny(writeRelative("other.ts"), /src\/other\.ts/);
    expectSilent(writeRelative("app.ts"));
  });

  it("checks a write against the repository it lands in, even from a session directory outside it", () => {
    const outside = tmpdir();
    expectDeny(write(fx.path("src/other.ts"), outside), /src\/other\.ts/);
    expectDeny(fx.bash(`echo x > ${fx.path("src/other.ts")}`, { cwd: outside }), /src\/other\.ts/);
    expectDeny(write(fx.path("design/screens/S01-welcome/screen.html"), outside), /design\/screens/);
    expectSilent(write(fx.path("src/app.ts"), outside));
  });

  it("treats another spelling of the same absolute path alike", () => {
    if (!fx.dir.startsWith("/private/")) return;
    const alias = fx.dir.slice("/private".length);
    expectDeny(write(`${alias}/src/other.ts`), /src\/other\.ts/);
    expectSilent(write(`${alias}/src/app.ts`));
  });

  it("always allows the task file, its spec README and BLOCKED.md, the ledger, the marker and the stamp", () => {
    const always = [TASK, "specs/01-demo/README.md", "specs/01-demo/BLOCKED.md", "specs/LEDGER.md", "specs/.current-task", "specs/.verified"];
    for (const rel of always) expectSilent(write(rel));
    expectSilent(fx.bash("echo specs/01-demo/tasks/task-02-next.md > specs/.current-task"));
    expectSilent(fx.bash("echo '| 01-demo/task-01 | done | 2026-10-21 | test |' >> specs/LEDGER.md"));
  });

  it("denies dependency changes when package.json isn't listed", () => {
    for (const command of ["npm install left-pad", "npm i -D left-pad@1.3.0", "npm add left-pad", "npm uninstall zod", "npm rm zod"]) {
      expectDeny(fx.bash(command), /package\.json/);
    }
    expectSilent(fx.bash("npm install"));
    expectSilent(fx.bash("npm ci"));
  });

  it("never limits reads", () => {
    expectSilent(fx.guard("Read", { file_path: fx.path("src/other.ts") }));
    expectSilent(fx.bash("cat src/other.ts package.json"));
  });

  it("leaves files outside the repository and ignored files alone", () => {
    expectSilent(write(join(tmpdir(), "guardrails-scratch.txt")));
    expectSilent(fx.bash("rm -rf node_modules/.cache"));
    expectSilent(write("node_modules/left-pad/index.js"));
  });
});

describe("guard: task marker states", () => {
  let fx;
  before(() => {
    fx = createFixture();
  });
  after(() => fx.cleanup());

  const unlistedWrites = () => {
    expectSilent(fx.guard("Write", { file_path: fx.path("src/other.ts"), content: "x" }));
    expectSilent(fx.bash("echo hi > unlisted.txt"));
    expectSilent(fx.bash("npm install left-pad"));
  };

  it("applies no boundary when no task is active", () => {
    unlistedWrites();
  });

  it("applies no boundary when the marker is empty or names a missing file", () => {
    fx.write("specs/.current-task", "\n");
    unlistedWrites();
    fx.setTask("specs/01-demo/tasks/task-09-missing.md");
    unlistedWrites();
  });

  it("allows dependency changes when the task lists package.json", () => {
    fx.write(TASK, taskText().replace("- `README.md`", "- `README.md`\n- `package.json`"));
    fx.setTask();
    expectSilent(fx.bash("npm install left-pad"));
    expectDeny(fx.bash("echo hi > unlisted.txt"), /unlisted\.txt/);
  });
});

describe("guard: npm workspaces", () => {
  let fx;
  before(() => {
    fx = createFixture();
    const root = JSON.parse(fx.read("package.json"));
    fx.write("package.json", `${JSON.stringify({ ...root, workspaces: ["apps/*", "packages/*"] })}\n`);
    fx.write("apps/agent/package.json", `${JSON.stringify({ name: "@demo/agent" })}\n`);
    fx.write("packages/shared/package.json", `${JSON.stringify({ name: "@demo/shared" })}\n`);
    fx.write(TASK, taskText().replace("- `README.md`", "- `README.md`\n- `apps/agent/package.json`\n- `package-lock.json`"));
    fx.setTask();
  });
  after(() => fx.cleanup());

  it("reads -w by package name as well as by folder, as npm does", () => {
    for (const command of [
      "npm install left-pad -w @demo/agent",
      "npm install left-pad --workspace=@demo/agent",
      "npm install left-pad -w apps/agent",
      "npm install left-pad -w ./apps/agent/",
      "npm uninstall left-pad --workspace @demo/agent",
    ]) {
      expectSilent(fx.bash(command));
    }
    expectSilent(fx.bash("cd apps/agent && npm install left-pad"));
  });

  it("reads the object form of workspaces and a folder named without /*", () => {
    const root = JSON.parse(fx.read("package.json"));
    try {
      fx.write("package.json", `${JSON.stringify({ ...root, workspaces: { packages: ["apps/agent", "packages/*"] } })}\n`);
      expectSilent(fx.bash("npm install left-pad -w @demo/agent"));
      expectDeny(fx.bash("npm install left-pad -w @demo/shared"), /packages\/shared\/package\.json/);
    } finally {
      fx.write("package.json", `${JSON.stringify(root)}\n`);
    }
  });

  it("still denies a workspace the task doesn't list, and a name it can't find", () => {
    expectDeny(fx.bash("npm install left-pad -w @demo/shared"), /packages\/shared\/package\.json/);
    expectDeny(fx.bash("npm install left-pad -w @demo/agent -w @demo/shared"), /packages\/shared\/package\.json/);
    expectDeny(fx.bash("npm install left-pad -w @demo/missing"), /@demo\/missing\/package\.json/);
    // A package name never ends in a slash, so this one isn't resolved.
    expectDeny(fx.bash("npm install left-pad -w @demo/agent/"), /@demo\/agent\/package\.json/);
    expectDeny(fx.bash("npm install left-pad"), /changes package\.json/);
  });
});

