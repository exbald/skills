import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeShell } from "../lib/commands.mjs";
import { DYNAMIC, parseShell } from "../lib/shell.mjs";

const context = { cwd: "/repo", home: "/home/agent" };
const programs = (source) => analyzeShell(source, context).map((command) => command.program).filter(Boolean);
const firstWords = (source) => parseShell(source).map((command) => command.words[0]);

describe("parseShell", () => {
  it("splits on ;, &&, ||, |, & and newlines", () => {
    assert.deepEqual(firstWords("a 1; b && c || d | e & f\ng"), ["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("keeps a pipeline in one group and starts a new group after a separator", () => {
    const [lsof, kill, echo] = parseShell("lsof -ti:3000 | xargs kill; echo done");
    assert.equal(lsof.group, kill.group);
    assert.notEqual(kill.group, echo.group);
  });

  it("removes quotes and keeps quoted operators inside one word", () => {
    const [command] = parseShell(`git commit -m "a; b && c" 'd | e' f\\ g`);
    assert.deepEqual(command.words, ["git", "commit", "-m", "a; b && c", "d | e", "f g"]);
  });

  it("keeps empty quoted words", () => {
    assert.deepEqual(parseShell("sed -i '' s/a/b/ x")[0].words, ["sed", "-i", "", "s/a/b/", "x"]);
  });

  it("reads redirections, with and without file descriptors", () => {
    const [command] = parseShell("node x.mjs > out.log 2>&1 < in.txt >>more.log &>all.log");
    assert.deepEqual(command.words, ["node", "x.mjs"]);
    assert.deepEqual(
      command.redirects.map(({ fd, op, target }) => [fd, op, target]),
      [["", ">", "out.log"], ["2", ">&", "1"], ["", "<", "in.txt"], ["", ">>", "more.log"], ["", "&>", "all.log"]],
    );
  });

  it("returns the commands inside $(...), backticks and process substitution", () => {
    assert.deepEqual(firstWords("echo $(git push -f) `rm x` <(cat y)").sort(), ["cat", "echo", "git", "rm"]);
  });

  it("puts nested commands in the group of the command they appear in", () => {
    const commands = parseShell("kill $(lsof -ti:3000); ls");
    const group = (name) => commands.find((command) => command.words[0] === name).group;
    assert.equal(group("kill"), group("lsof"));
    assert.notEqual(group("ls"), group("kill"));
  });

  it("skips heredoc bodies, also inside $(...) and with an apostrophe in the body", () => {
    const source = "git commit -m \"$(cat <<'EOF'\nfix: don't git push --force\nEOF\n)\" && echo ok";
    assert.deepEqual(firstWords(source).sort(), ["cat", "echo", "git"]);
    assert.deepEqual(firstWords("cat <<-EOF > notes.txt\n\trm -rf /\n\tEOF\nls"), ["cat", "ls"]);
  });

  it("skips comments and joins continued lines", () => {
    assert.deepEqual(parseShell("ls # git push --force").map((command) => command.words), [["ls"]]);
    assert.deepEqual(parseShell("git push \\\n  --force")[0].words, ["git", "push", "--force"]);
  });

  it("expands ~, $HOME and $PWD, and marks other expansions as dynamic", () => {
    const commands = parseShell('rm ~/x "$HOME/y" ${HOME} $PWD/z "$OTHER/w" ~user $(pwd)', { HOME: "/h", PWD: "/p" });
    const rm = commands.find((command) => command.words[0] === "rm");
    assert.deepEqual(rm.words, ["rm", "/h/x", "/h/y", "/h", "/p/z", `${DYNAMIC}/w`, "~user", DYNAMIC]);
  });

  it("does not treat prototype names as variables", () => {
    assert.deepEqual(parseShell("echo $constructor", { HOME: "/h" })[0].words, ["echo", DYNAMIC]);
  });
});

describe("analyzeShell", () => {
  it("drops leading assignments and wrapper commands", () => {
    assert.deepEqual(programs("FOO=1 BAR=2 git status"), ["git"]);
    assert.deepEqual(programs("env -i PATH=/bin git push"), ["git"]);
    assert.deepEqual(
      programs("command git push; nohup node x; time -p npm test; timeout 5 git push; nice -n 5 rm x"),
      ["git", "node", "npm", "git", "rm"],
    );
  });

  it("sees through xargs, npx and npm exec", () => {
    assert.deepEqual(programs("lsof -ti:3000 | xargs -r -n 1 kill -9"), ["lsof", "kill"]);
    assert.deepEqual(programs("npx -y eas-cli@latest submit"), ["eas"]);
    assert.deepEqual(programs("npm exec -- flyctl deploy"), ["fly"]);
  });

  it("reads the command strings of sh -c, bash -lc and eval", () => {
    assert.deepEqual(programs(`bash -lc "git push --force" && sh -c 'rm -rf /'; eval "fly deploy"`), ["git", "rm", "fly"]);
  });

  it("marks a bare env as printing the environment", () => {
    assert.equal(analyzeShell("env", context)[0].bareEnv, true);
    assert.equal(analyzeShell("env | grep KEY", context)[0].bareEnv, true);
    assert.equal(analyzeShell("env NODE_ENV=test node x.mjs", context)[0].program, "node");
  });

  it("follows cd so later commands resolve paths from the new directory", () => {
    const commands = analyzeShell("cd agent && echo x > a.ts; cd /tmp; touch b", context);
    assert.deepEqual(commands.map((command) => command.dir), ["/repo", "/repo/agent", "/repo/agent", "/tmp"]);
  });

  it("normalises program names", () => {
    assert.deepEqual(programs("/usr/bin/GIT push && \\rm x"), ["git", "rm"]);
  });
});
