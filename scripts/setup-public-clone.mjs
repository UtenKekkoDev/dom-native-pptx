#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export class PublicCloneError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicCloneError";
    this.code = code;
  }
}

function fail(code, message) {
  return new PublicCloneError(code, message);
}

function trimGitSuffix(value) {
  const normalized = value.replace(/^\/+|\/+$/gu, "");
  if (!normalized)
    throw fail("INVALID_PUBLIC_URL", "Public repository path is required");
  return normalized.replace(/\.git$/iu, "");
}

export function normalizePublicRepoUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw fail("INVALID_PUBLIC_URL", "A public repository URL is required");
  }
  const raw = value.trim();
  if (/[?#]/u.test(raw)) {
    throw fail(
      "UNSAFE_PUBLIC_URL",
      "Public repository URLs cannot contain a query or fragment",
    );
  }
  if (path.isAbsolute(raw)) {
    return `file/${path.resolve(raw).replace(/\\/gu, "/")}`;
  }

  const ssh =
    /^(?<user>[^@/:\\\s]+)@(?<host>[^/:\\\s]+):(?<pathname>.+)$/u.exec(raw);
  if (ssh) {
    if (ssh.groups?.user !== "git" || !ssh.groups.pathname) {
      throw fail(
        "UNSAFE_PUBLIC_URL",
        "Public repository URLs cannot contain credentials",
      );
    }
    return `${ssh.groups.host.toLowerCase()}/${trimGitSuffix(ssh.groups.pathname)}`;
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw fail("INVALID_PUBLIC_URL", "Public repository URL is invalid");
    }
    const isHttps = parsed.protocol === "https:" && !parsed.username;
    const isStandardSsh =
      parsed.protocol === "ssh:" && parsed.username === "git";
    if (
      (!isHttps && !isStandardSsh) ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.port ||
      !parsed.hostname
    ) {
      throw fail("UNSAFE_PUBLIC_URL", "Public repository URL is unsafe");
    }
    return `${parsed.hostname.toLowerCase()}/${trimGitSuffix(parsed.pathname)}`;
  }

  if (/[:?#]/u.test(raw)) {
    throw fail("UNSAFE_PUBLIC_URL", "Public repository URL is unsafe");
  }
  return `file/${path.resolve(raw).replace(/\\/gu, "/")}`;
}

async function git(repo, args, code) {
  try {
    const result = await execFile("git", ["-C", repo, ...args], {
      encoding: "utf8",
    });
    return result.stdout.trim();
  } catch {
    throw fail(code, "Git verification failed");
  }
}

async function gitAtRoot(args, code) {
  try {
    const result = await execFile("git", args, { encoding: "utf8" });
    return result.stdout.trim();
  } catch {
    throw fail(code, "Git verification failed");
  }
}

async function configValues(repo, key) {
  try {
    const result = await execFile(
      "git",
      ["-C", repo, "config", "--get-all", key],
      {
        encoding: "utf8",
      },
    );
    return result.stdout.split(/\r?\n/u).filter(Boolean);
  } catch (error) {
    if (error && typeof error === "object" && error.code === 1) return [];
    throw fail(
      "PRIVATE_REPO_INVALID",
      "Private repository remotes cannot be read",
    );
  }
}

async function replaceConfigValues(repo, key, values) {
  try {
    await execFile("git", ["-C", repo, "config", "--unset-all", key], {
      encoding: "utf8",
    });
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== 5) {
      throw fail(
        "PRIVATE_REMOTE_UPDATE_FAILED",
        "Private repository remotes cannot be updated",
      );
    }
  }
  for (const value of values) {
    await git(
      repo,
      ["config", "--add", key, value],
      "PRIVATE_REMOTE_UPDATE_FAILED",
    );
  }
}

async function destinationExists(destination) {
  try {
    return (await fs.stat(destination)).isDirectory();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT")
      return false;
    throw fail("DESTINATION_UNAVAILABLE", "Destination cannot be inspected");
  }
}

async function privateState(privateRepo) {
  const [branch, status] = await Promise.all([
    git(privateRepo, ["branch", "--show-current"], "PRIVATE_REPO_INVALID"),
    git(
      privateRepo,
      ["status", "--porcelain=v1", "--untracked-files=all"],
      "PRIVATE_REPO_INVALID",
    ),
  ]);
  return { branch, dirtyFileCount: status ? status.split(/\r?\n/u).length : 0 };
}

function assertBranch(branch) {
  if (
    typeof branch !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch)
  ) {
    throw fail(
      "INVALID_DEFAULT_BRANCH",
      "expectedDefaultBranch must be a safe Git branch name",
    );
  }
}

async function verifyDestination({
  destination,
  publicRepoUrl,
  normalizedPublicUrl,
  expectedDefaultBranch,
}) {
  if (await destinationExists(destination)) {
    const status = await git(
      destination,
      ["status", "--porcelain=v1", "--untracked-files=all"],
      "DESTINATION_NOT_GIT_REPOSITORY",
    );
    if (status)
      throw fail(
        "DESTINATION_DIRTY",
        "Public clone destination has uncommitted files",
      );
  } else {
    await gitAtRoot(
      ["clone", "--quiet", publicRepoUrl, destination],
      "CLONE_FAILED",
    );
  }

  const origin = await git(
    destination,
    ["remote", "get-url", "origin"],
    "ORIGIN_MISSING",
  );
  if (normalizePublicRepoUrl(origin) !== normalizedPublicUrl) {
    throw fail(
      "ORIGIN_MISMATCH",
      "Public clone origin does not match the requested repository",
    );
  }
  await git(
    destination,
    ["fetch", "--quiet", "origin", expectedDefaultBranch],
    "DEFAULT_BRANCH_FETCH_FAILED",
  );
  const branch = await git(
    destination,
    ["branch", "--show-current"],
    "DEFAULT_BRANCH_MISMATCH",
  );
  if (branch !== expectedDefaultBranch) {
    throw fail(
      "DEFAULT_BRANCH_MISMATCH",
      "Public clone is not on the expected default branch",
    );
  }
  const status = await git(
    destination,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    "DESTINATION_NOT_GIT_REPOSITORY",
  );
  if (status)
    throw fail(
      "DESTINATION_DIRTY",
      "Public clone destination has uncommitted files",
    );
}

async function planPublicRemoteRemoval(privateRepo, normalizedPublicUrl) {
  const remotes = (await git(privateRepo, ["remote"], "PRIVATE_REPO_INVALID"))
    .split(/\r?\n/u)
    .filter(Boolean);
  const changes = [];
  for (const remote of remotes) {
    const urlKey = `remote.${remote}.url`;
    const pushKey = `remote.${remote}.pushurl`;
    const [urls, explicitPushUrls] = await Promise.all([
      configValues(privateRepo, urlKey),
      configValues(privateRepo, pushKey),
    ]);
    const pushUrls = explicitPushUrls.length ? explicitPushUrls : urls;
    if (
      !pushUrls.some(
        (url) => normalizePublicRepoUrl(url) === normalizedPublicUrl,
      )
    )
      continue;

    if (explicitPushUrls.length) {
      const retainedPushUrls = explicitPushUrls.filter(
        (url) => normalizePublicRepoUrl(url) !== normalizedPublicUrl,
      );
      if (retainedPushUrls.length) {
        changes.push({
          action: "replace",
          remote,
          key: pushKey,
          values: retainedPushUrls,
        });
        continue;
      }
      const retainedUrls = urls.filter(
        (url) => normalizePublicRepoUrl(url) !== normalizedPublicUrl,
      );
      if (retainedUrls.length) {
        changes.push({
          action: "replace",
          remote,
          key: urlKey,
          values: retainedUrls,
        });
        changes.push({ action: "replace", remote, key: pushKey, values: [] });
      } else {
        changes.push({ action: "remove", remote });
      }
      continue;
    }

    const retainedUrls = urls.filter(
      (url) => normalizePublicRepoUrl(url) !== normalizedPublicUrl,
    );
    changes.push(
      retainedUrls.length
        ? { action: "replace", remote, key: urlKey, values: retainedUrls }
        : { action: "remove", remote },
    );
  }
  return changes;
}

async function applyRemoteRemoval(privateRepo, changes) {
  const changed = new Set();
  for (const change of changes) {
    if (change.action === "remove") {
      await git(
        privateRepo,
        ["remote", "remove", change.remote],
        "PRIVATE_REMOTE_UPDATE_FAILED",
      );
    } else {
      await replaceConfigValues(privateRepo, change.key, change.values);
    }
    changed.add(change.remote);
  }
  return [...changed];
}

export async function setupPublicClone({
  privateRepo,
  publicRepoUrl,
  destination,
  expectedDefaultBranch = "main",
}) {
  if (!privateRepo || !publicRepoUrl || !destination) {
    throw fail(
      "INVALID_ARGUMENTS",
      "privateRepo, publicRepoUrl, and destination are required",
    );
  }
  assertBranch(expectedDefaultBranch);
  const normalizedPublicUrl = normalizePublicRepoUrl(publicRepoUrl);
  const state = await privateState(privateRepo);
  await verifyDestination({
    destination,
    publicRepoUrl,
    normalizedPublicUrl,
    expectedDefaultBranch,
  });
  const changes = await planPublicRemoteRemoval(
    privateRepo,
    normalizedPublicUrl,
  );
  const removedRemotes = await applyRemoteRemoval(privateRepo, changes);
  return { ...state, defaultBranch: expectedDefaultBranch, removedRemotes };
}

function parseArguments(argv) {
  const options = { expectedDefaultBranch: "main" };
  const keys = {
    "--private-repo": "privateRepo",
    "--public-url": "publicRepoUrl",
    "--destination": "destination",
    "--expected-default-branch": "expectedDefaultBranch",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = keys[argv[index]];
    if (!key || index + 1 >= argv.length) {
      throw fail(
        "INVALID_ARGUMENTS",
        "Required repository setup arguments are missing",
      );
    }
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

function formatFailure(error) {
  return {
    error: {
      code:
        error instanceof PublicCloneError ? error.code : "PUBLIC_CLONE_FAILED",
      message:
        error instanceof PublicCloneError
          ? error.message
          : "Public clone setup failed",
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.stdout.write(
      `${JSON.stringify(await setupPublicClone(parseArguments(process.argv.slice(2))), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`${JSON.stringify(formatFailure(error), null, 2)}\n`);
    process.exitCode = 1;
  }
}
