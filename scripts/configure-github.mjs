#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  configureGitHub,
  GitHubHardeningError,
} from "./lib/github-hardening.mjs";

function parseArguments(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
      continue;
    }
    if (argument === "--repo" && index + 1 < argv.length) {
      options.repo = argv[index + 1];
      index += 1;
      continue;
    }
    throw new GitHubHardeningError(
      "INVALID_ARGUMENTS",
      "Usage: configure-github.mjs --repo UtenKekkoDev/dom-native-pptx [--apply]",
    );
  }
  if (!options.repo) {
    throw new GitHubHardeningError(
      "INVALID_ARGUMENTS",
      "Usage: configure-github.mjs --repo UtenKekkoDev/dom-native-pptx [--apply]",
    );
  }
  return options;
}

function publicFailure(error) {
  return {
    error: {
      code:
        error instanceof GitHubHardeningError
          ? error.code
          : "GITHUB_HARDENING_FAILED",
      message:
        error instanceof GitHubHardeningError
          ? error.message
          : "GitHub hardening failed",
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  return configureGitHub(parseArguments(argv));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(publicFailure(error), null, 2)}\n`);
    process.exitCode = 1;
  }
}
