import { absolute, requireArgs, runCli } from "./_runner.mjs";

const [input, output] = process.argv.slice(2);
requireArgs([input, output], "node export.mjs <slides.html> <output.pptx>");
runCli("export", [absolute(input), absolute(output)]);
