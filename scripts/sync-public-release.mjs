#!/usr/bin/env node
import {
  formatPublicSyncFailure,
  materializePublicTree,
  PublicSyncError,
  recoverPublicSync,
} from "./lib/public-sync.mjs";

function parseArguments(argv) {
  if (argv[0] === "--recover") {
    if (argv.length !== 2 || !argv[1]) {
      throw new PublicSyncError(
        "INVALID_ARGUMENTS",
        "Required: --recover <recovery-path>",
      );
    }
    return { recoveryPath: argv[1] };
  }
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const key = {
      "--source-repo": "sourceRepo",
      "--source-ref": "sourceRef",
      "--destination": "destination",
    }[argument];
    if (!key || index + 1 >= argv.length) {
      throw new PublicSyncError(
        "INVALID_ARGUMENTS",
        `Unknown or incomplete argument: ${argument}`,
      );
    }
    options[key] = argv[index + 1];
    index += 1;
  }
  if (!options.sourceRepo || !options.sourceRef || !options.destination) {
    throw new PublicSyncError(
      "INVALID_ARGUMENTS",
      "Required: --source-repo <path> --source-ref <ref> --destination <path> [--dry-run]",
    );
  }
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  const result = options.recoveryPath
    ? await recoverPublicSync(options)
    : await materializePublicTree(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify(formatPublicSyncFailure(error), null, 2)}\n`,
  );
  process.exitCode = 1;
}
