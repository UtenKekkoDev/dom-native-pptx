import { absolute, requireArgs, runCli } from "./_runner.mjs";

const [pptx, manifest] = process.argv.slice(2);
requireArgs([pptx], "node inspect.mjs <output.pptx> [manifest.json]");
const args = [absolute(pptx)];
if (manifest) args.push("--manifest", absolute(manifest));
runCli("inspect", args);
