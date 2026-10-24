// Helpers for reading command-line arguments: options may appear anywhere before "--", and some
// options take the next word as their value.

const NO_VALUES = new Set();

/**
 * Splits arguments into options and operands. `values` lists [option, value] pairs for options in
 * `valueOptions` (value in the next word) and for long options written as --name=value.
 */
export function splitOptions(args, valueOptions = NO_VALUES) {
  const options = [];
  const operands = [];
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      operands.push(arg);
      continue;
    }
    options.push(arg);
    const equals = arg.indexOf("=");
    if (arg.startsWith("--") && equals > 0) values.push([arg.slice(0, equals), arg.slice(equals + 1)]);
    else if (valueOptions.has(arg)) {
      values.push([arg, args[index + 1] ?? ""]);
      index += 1;
    }
  }
  return { options, operands, values };
}

/** Values given for any of `names` in a splitOptions result. */
export function valuesOf(parsed, ...names) {
  return parsed.values.filter(([name]) => names.includes(name)).map(([, value]) => value);
}

/** True when a short option cluster such as -rf contains one of `letters`. */
export function hasShortFlag(options, letters) {
  return options.some((option) => /^-[A-Za-z]+$/.test(option) && [...option.slice(1)].some((letter) => letters.includes(letter)));
}

const GIT_GLOBAL_VALUES = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env", "--super-prefix"]);

/** A git command line split into its global options (-C dir, -c key=value) and its subcommand. */
export function gitInvocation(args) {
  let index = 0;
  let dir = null;
  const configs = [];
  while (index < args.length && args[index].startsWith("-")) {
    const arg = args[index];
    if (arg === "-C") dir = args[index + 1] ?? null;
    if (arg === "-c") configs.push(args[index + 1] ?? "");
    index += GIT_GLOBAL_VALUES.has(arg) ? 2 : 1;
  }
  return { sub: args[index] ?? "", rest: args.slice(index + 1), dir, configs };
}
