import { absolute, requireArgs, runCli } from "./_runner.mjs";

const [expected, actual, diff] = process.argv.slice(2);
requireArgs(
  [expected, actual, diff],
  "node compare.mjs <html.png> <powerpoint.png> <diff.png>",
);
runCli("compare", [absolute(expected), absolute(actual), absolute(diff)]);
