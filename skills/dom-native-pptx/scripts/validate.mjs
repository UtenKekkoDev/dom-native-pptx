import { absolute, requireArgs, runCli } from "./_runner.mjs";

const [input] = process.argv.slice(2);
requireArgs([input], "node validate.mjs <slides.html>");
runCli("validate", [absolute(input)]);
