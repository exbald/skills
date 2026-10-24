// The Fly adapter for deploy-approved.mjs: the worked example of a deploy target. It reads the image the app's
// machines run, builds on Fly's remote builder from the exported tree, releases an image tagged with its commit
// (lib/deploy.mjs, imageLabel), and rolls back by redeploying the previous image with the fly.toml of the commit that
// image names. flyctl runs inside the export, with the export's fly.toml and Dockerfile named explicitly, so nothing
// resolves from the agent's checkout. Another target is a module of the same shape (references/adapting.md).
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { commitOfImage, onlyOne } from "./deploy.mjs";

const isText = (value) => typeof value === "string" && value !== "";

/** The one image the app's machines run, as registry/repository:tag, from `flyctl image show --json`. */
export function liveImage(images, app) {
  if (!Array.isArray(images) || images.length === 0) throw new Error(`Fly lists no machines for ${app}, so there is nothing to roll back to.`);
  const refs = images.map((image) => {
    if (!isText(image?.Registry) || !isText(image?.Repository) || !isText(image?.Tag)) {
      throw new Error("flyctl image show returned an image without a registry, repository or tag.");
    }
    return `${image.Registry}/${image.Repository}:${image.Tag}`;
  });
  return onlyOne(refs, `${app}'s machines`);
}

/** flyctl from $FLYCTL, the PATH, or the installer's default folder. */
function findFlyctl() {
  const candidates = [process.env.FLYCTL, "flyctl", join(homedir(), ".fly", "bin", "flyctl")].filter(Boolean);
  const found = candidates.find((candidate) => spawnSync(candidate, ["version"], { stdio: "ignore" }).status === 0);
  if (!found) throw new Error("flyctl isn't installed, or isn't on the PATH or in ~/.fly/bin.");
  return found;
}

/**
 * The adapter: { target, live(), commitOf(live), build(source, label), release(source, label), rollback(before, source) }.
 * `run(command, args)` runs a command and returns its stdout, throwing when it fails. The three deploy steps stream
 * flyctl's output, since a build takes minutes, and return true when flyctl reports success.
 */
export function flyAdapter(config, run) {
  const app = config.deploy.fly.app;
  const flyctl = findFlyctl();
  // Runs flyctl deploy from `source`: as its working directory, its positional argument and the home of the fly.toml
  // (and, when building, the Dockerfile) it names.
  const deploy = (source, extra) => {
    const build = extra.includes("--image") ? [] : ["--dockerfile", join(source, "Dockerfile"), "--remote-only"];
    const args = ["deploy", source, "--app", app, "--config", join(source, "fly.toml"), ...build, "--yes", ...extra];
    return spawnSync(flyctl, args, { cwd: source, stdio: "inherit" }).status === 0;
  };
  return {
    target: `the Fly app ${app}`,
    live: () => liveImage(JSON.parse(run(flyctl, ["image", "show", "--app", app, "--json"])), app),
    commitOf: commitOfImage,
    build: (source, label) => deploy(source, ["--build-only", "--image-label", label]),
    release: (source, label) => deploy(source, ["--image-label", label]),
    rollback: (before, source) => deploy(source, ["--image", before]),
  };
}
