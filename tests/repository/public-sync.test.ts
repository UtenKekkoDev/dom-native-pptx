import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auditPublicEntries,
  listPublicFiles,
  materializePublicTree,
  PublicSyncError,
} from "../../scripts/lib/public-sync.mjs";

const execFile = promisify(execFileCallback);
const fixtureRoot = path.resolve(".tmp", "tests", "public-sync");
const testRoots: string[] = [];

async function git(repo: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", args, {
    cwd: repo,
    encoding: "utf8",
  });
  return result.stdout.trim();
}

function gitWithInput(
  repo: string,
  args: string[],
  input: string | Buffer,
): string {
  const result = spawnSync("git", args, {
    cwd: repo,
    input,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function addIndexEntry(
  repo: string,
  indexPath: string,
  content: string | Buffer,
  mode = "100644",
): Promise<void> {
  const objectId = gitWithInput(
    repo,
    ["hash-object", "-w", "--stdin"],
    content,
  );
  gitWithInput(
    repo,
    ["update-index", "-z", "--index-info"],
    Buffer.from(`${mode} ${objectId}\t${indexPath}\0`),
  );
}

async function commitIndex(
  repo: string,
  message = "index fixture",
): Promise<string> {
  await git(repo, "commit", "--quiet", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

async function createTreeCommitWithPath(
  repo: string,
  treePath: string,
  content: string,
): Promise<string> {
  const objectId = gitWithInput(
    repo,
    ["hash-object", "-w", "--stdin"],
    content,
  );
  const segments = treePath.split("/");
  let childId = objectId;
  let childType = "blob";
  let childMode = "100644";
  for (const segment of segments.reverse()) {
    childId = gitWithInput(
      repo,
      ["mktree", "-z"],
      Buffer.from(`${childMode} ${childType} ${childId}\t${segment}\0`),
    );
    childType = "tree";
    childMode = "040000";
  }
  return git(repo, "commit-tree", childId, "-m", "unusual path fixture");
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readIndexSnapshot(repo: string): Promise<{
  path: string;
  bytes: Buffer;
  mode: number;
  digest: string;
}> {
  const indexPath = await git(
    repo,
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  );
  const [bytes, stat] = await Promise.all([
    fs.readFile(indexPath),
    fs.stat(indexPath),
  ]);
  return {
    path: indexPath,
    bytes,
    mode: stat.mode & 0o777,
    digest: sha256(bytes),
  };
}

function destinationLockPath(destination: string): string {
  return path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.public-sync.lock`,
  );
}

async function findRecoveryWorkspaces(destination: string): Promise<string[]> {
  const parent = path.dirname(destination);
  const prefix = `.${path.basename(destination)}.public-sync-recovery-`;
  return (await fs.readdir(parent))
    .filter(
      (name) => name.startsWith(prefix) && !name.endsWith(".finalized.json"),
    )
    .map((name) => path.join(parent, name));
}

async function findFinalizedTombstones(destination: string): Promise<string[]> {
  const parent = path.dirname(destination);
  const prefix = `.${path.basename(destination)}.public-sync-recovery-`;
  return (await fs.readdir(parent))
    .filter(
      (name) => name.startsWith(prefix) && name.endsWith(".finalized.json"),
    )
    .map((name) => path.join(parent, name));
}

async function write(
  repo: string,
  relativePath: string,
  content: string | Buffer,
): Promise<void> {
  const target = path.join(repo, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function read(repo: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(repo, ...relativePath.split("/")), "utf8");
}

async function exists(repo: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repo, ...relativePath.split("/")));
    return true;
  } catch {
    return false;
  }
}

async function createRepo(kind: string): Promise<string> {
  const repo = path.join(fixtureRoot, `${kind}-${randomUUID()}`);
  testRoots.push(repo);
  await fs.mkdir(repo, { recursive: true });
  await git(repo, "init", "--quiet");
  await git(repo, "config", "user.name", "Public Sync Test");
  await git(repo, "config", "user.email", "public-sync@example.invalid");
  return repo;
}

async function commitAll(repo: string, message = "fixture"): Promise<string> {
  await git(repo, "add", "--all");
  await git(repo, "commit", "--quiet", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

async function createDestination(): Promise<string> {
  const repo = await createRepo("public");
  await write(repo, "README.md", "old public tree\n");
  await commitAll(repo, "public baseline");
  return repo;
}

async function crashIntoPendingRecovery(
  privateRepo: string,
  publicRepo: string,
  phase: "after-revalidate" | "after-durable-rename",
): Promise<{ recoveryPath: string; lockPath: string }> {
  const moduleUrl = pathToFileURL(
    path.resolve("scripts/lib/public-sync.mjs"),
  ).href;
  const crashScript = `
    import { materializePublicTree } from ${JSON.stringify(moduleUrl)};
    await materializePublicTree({
      sourceRepo: ${JSON.stringify(privateRepo)},
      sourceRef: "HEAD",
      destination: ${JSON.stringify(publicRepo)},
      faultInjector(context) {
        if (
          context.phase === ${JSON.stringify(phase)} &&
          context.operation === "backup" &&
          context.index === 1
        ) process.exit(74);
      },
    });
  `;
  const crashed = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", crashScript],
    { encoding: "utf8" },
  );
  expect(crashed.status, crashed.stderr).toBe(74);
  const recoveries = await findRecoveryWorkspaces(publicRepo);
  expect(recoveries).toHaveLength(1);
  const recoveryPath = recoveries[0]!;
  const lockPath = destinationLockPath(publicRepo);
  testRoots.push(recoveryPath, lockPath);
  return { recoveryPath, lockPath };
}

async function crashIntoRecoveryPhase(
  privateRepo: string,
  publicRepo: string,
  phase: string,
  exitCode: number,
): Promise<{ recoveryPath: string; lockPath: string }> {
  const moduleUrl = pathToFileURL(
    path.resolve("scripts/lib/public-sync.mjs"),
  ).href;
  const crashScript = `
    import { materializePublicTree } from ${JSON.stringify(moduleUrl)};
    await materializePublicTree({
      sourceRepo: ${JSON.stringify(privateRepo)},
      sourceRef: "HEAD",
      destination: ${JSON.stringify(publicRepo)},
      faultInjector(context) {
        if (context.phase === ${JSON.stringify(phase)}) process.exit(${exitCode});
      },
    });
  `;
  const crashed = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", crashScript],
    { encoding: "utf8" },
  );
  expect(crashed.status, crashed.stderr).toBe(exitCode);
  const recoveries = await findRecoveryWorkspaces(publicRepo);
  expect(recoveries).toHaveLength(1);
  const recoveryPath = recoveries[0]!;
  const lockPath = destinationLockPath(publicRepo);
  testRoots.push(recoveryPath, lockPath);
  return { recoveryPath, lockPath };
}

async function crashIntoTerminalPhase(
  privateRepo: string,
  publicRepo: string,
  phase: string,
  exitCode: number,
): Promise<{
  recoveryPath: string;
  lockPath: string;
  tombstonePath: string;
}> {
  const moduleUrl = pathToFileURL(
    path.resolve("scripts/lib/public-sync.mjs"),
  ).href;
  const crashScript = `
    import { materializePublicTree } from ${JSON.stringify(moduleUrl)};
    await materializePublicTree({
      sourceRepo: ${JSON.stringify(privateRepo)},
      sourceRef: "HEAD",
      destination: ${JSON.stringify(publicRepo)},
      faultInjector(context) {
        if (context.phase === ${JSON.stringify(phase)}) process.exit(${exitCode});
      },
    });
  `;
  const crashed = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", crashScript],
    { encoding: "utf8" },
  );
  expect(crashed.status, crashed.stderr).toBe(exitCode);

  const tombstones = await findFinalizedTombstones(publicRepo);
  const recoveries = await findRecoveryWorkspaces(publicRepo);
  expect(tombstones.length).toBeLessThanOrEqual(1);
  expect(recoveries.length).toBeLessThanOrEqual(1);
  let recoveryPath = recoveries[0];
  let tombstonePath = tombstones[0];
  if (tombstonePath) {
    const tombstone = JSON.parse(await fs.readFile(tombstonePath, "utf8"));
    recoveryPath = tombstone.recoveryPath;
  } else if (recoveryPath) {
    tombstonePath = `${recoveryPath}.finalized.json`;
  }
  expect(recoveryPath).toBeTruthy();
  expect(tombstonePath).toBeTruthy();
  const lockPath = destinationLockPath(publicRepo);
  testRoots.push(recoveryPath!, tombstonePath!, lockPath);
  return {
    recoveryPath: recoveryPath!,
    lockPath,
    tombstonePath: tombstonePath!,
  };
}

async function runRecovery(recoveryPath: string): Promise<{
  status: string;
  destinationRoot: string;
  recoveryPath: string;
  finalized?: boolean;
  verified?: boolean;
}> {
  const module = (await import("../../scripts/lib/public-sync.mjs")) as Record<
    string,
    unknown
  >;
  expect(module.recoverPublicSync).toEqual(expect.any(Function));
  return (
    module.recoverPublicSync as (options: { recoveryPath: string }) => Promise<{
      status: string;
      destinationRoot: string;
      recoveryPath: string;
      finalized?: boolean;
      verified?: boolean;
    }>
  )({ recoveryPath });
}

async function runRecoveryWithFault(
  recoveryPath: string,
  faultInjector: (context: {
    phase: string;
    operation?: string;
    unit?: string;
  }) => void | Promise<void>,
): ReturnType<typeof runRecovery> {
  const module = (await import("../../scripts/lib/public-sync.mjs")) as Record<
    string,
    unknown
  >;
  return (
    module.recoverPublicSync as (options: {
      recoveryPath: string;
      faultInjector: typeof faultInjector;
    }) => ReturnType<typeof runRecovery>
  )({ recoveryPath, faultInjector });
}

async function createPendingFinalizedTombstone(): Promise<{
  privateRepo: string;
  publicRepo: string;
  recoveryPath: string;
  tombstonePath: string;
}> {
  const privateRepo = await createRepo("private");
  const publicRepo = await createDestination();
  await write(privateRepo, "README.md", "new public tree\n");
  await commitAll(privateRepo);
  const { recoveryPath, tombstonePath } = await crashIntoTerminalPhase(
    privateRepo,
    publicRepo,
    "terminal-after-lock-release-recorded",
    82,
  );
  return { privateRepo, publicRepo, recoveryPath, tombstonePath };
}

async function rewriteFinalizedDurability(
  tombstonePath: string,
  durability: Record<string, unknown>,
): Promise<void> {
  const tombstone = JSON.parse(
    await fs.readFile(tombstonePath, "utf8"),
  ) as Record<string, unknown>;
  tombstone.durability = durability;
  await fs.writeFile(tombstonePath, `${JSON.stringify(tombstone, null, 2)}\n`);
  await fs.chmod(tombstonePath, 0o600);
}

afterEach(async () => {
  const orphanedTransactionPaths = await fs
    .readdir(fixtureRoot)
    .then((names) =>
      names
        .filter((name) =>
          /^\.public-.*\.public-sync(?:\.lock|-recovery-)/u.test(name),
        )
        .map((name) => path.join(fixtureRoot, name)),
    )
    .catch(() => []);
  const cleanupPaths = [
    ...new Set([...testRoots.splice(0), ...orphanedTransactionPaths]),
  ];
  await Promise.all(
    cleanupPaths.map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("committed public tree synchronization", () => {
  it("materializes committed content and ignores working-tree dirt and denied paths", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(
      privateRepo,
      "src/index.ts",
      "export const state = 'COMMITTED';\n",
    );
    await write(privateRepo, "docs/superpowers/private.md", "private plan\n");
    await commitAll(privateRepo);
    await write(privateRepo, "src/index.ts", "export const state = 'DIRTY';\n");
    await write(
      privateRepo,
      "outputs/customer.pptx",
      "untracked customer file\n",
    );

    const result = await materializePublicTree({
      sourceRepo: privateRepo,
      sourceRef: "HEAD",
      destination: publicRepo,
    });

    expect(await read(publicRepo, "src/index.ts")).toContain("COMMITTED");
    expect(await read(publicRepo, "src/index.ts")).not.toContain("DIRTY");
    expect(await exists(publicRepo, "docs/superpowers/private.md")).toBe(false);
    expect(await exists(publicRepo, "outputs/customer.pptx")).toBe(false);
    expect(result.ignored).toContain("docs/superpowers/private.md");
  });

  it("uses the exact requested commit instead of a newer commit", async () => {
    const privateRepo = await createRepo("private");
    await write(privateRepo, "src/index.ts", "FIRST\n");
    const firstCommit = await commitAll(privateRepo, "first");
    await write(privateRepo, "src/index.ts", "SECOND\n");
    await commitAll(privateRepo, "second");

    const listed = await listPublicFiles({
      sourceRepo: privateRepo,
      sourceRef: firstCommit,
    });

    expect(listed.sourceCommit).toBe(firstCommit);
    expect(listed.entries.map((entry) => entry.path)).toEqual(["src/index.ts"]);
    expect(listed.entries[0]?.content.toString("utf8")).toBe("FIRST\n");
  });

  it("includes root quality configs in the public file list", async () => {
    const privateRepo = await createRepo("private");
    await write(privateRepo, ".gitattributes", "*.mjs text eol=lf\n");
    await write(privateRepo, ".prettierignore", "dist/\ncoverage/\n");
    await write(privateRepo, "eslint.config.js", "export default [];\n");
    await commitAll(privateRepo, "quality configs");

    const listed = await listPublicFiles({
      sourceRepo: privateRepo,
      sourceRef: "HEAD",
    });

    expect(listed.entries.map((entry) => entry.path)).toEqual([
      ".gitattributes",
      ".prettierignore",
      "eslint.config.js",
    ]);
  });

  it("reports a dry run without changing the destination", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "src/index.ts", "replacement\n");
    await commitAll(privateRepo);
    const before = await read(publicRepo, "README.md");

    const result = await materializePublicTree({
      sourceRepo: privateRepo,
      sourceRef: "HEAD",
      destination: publicRepo,
      dryRun: true,
    });

    expect(result.added).toEqual(["src/index.ts"]);
    expect(result.removed).toEqual(["README.md"]);
    expect(await read(publicRepo, "README.md")).toBe(before);
    expect(await exists(publicRepo, "src/index.ts")).toBe(false);
    expect(await git(publicRepo, "status", "--porcelain")).toBe("");
  });

  it.each([
    "docs/superpowers/private.md",
    "src/.tmp/cache.txt",
    "docs/attachments/reference.txt",
    "docs/logs/debug.txt",
    "docs/customer-notes.txt",
    "scripts/tool.log",
    "src/node_modules/dependency.js",
    "src/build/generated.js",
    "docs/cache/state.json",
    "tests/.cache/state.json",
    "scripts/vendor/tool.js",
    "src/deps/library.js",
    "docs/attachment/reference.txt",
    "examples/download/reference.txt",
  ])("rejects denied entry %s with a stable audit code", async (deniedPath) => {
    await expect(
      auditPublicEntries([
        { path: deniedPath, content: Buffer.from("private material") },
      ]),
    ).rejects.toMatchObject({ code: "DENIED_PATH" });
  });

  it.each([
    [
      "MAINTAINER_ABSOLUTE_PATH",
      ["const home = 'C:", "Users", "ROG", "secret';\n"].join("\\"),
    ],
    [
      "CREDENTIAL_PATTERN",
      ["api_key = '", "sk-", "abcdefghijklmnopqrstuvwxyz123456", "';\n"].join(
        "",
      ),
    ],
  ])(
    "rejects unsafe text with %s without changing the destination",
    async (code, unsafe) => {
      const privateRepo = await createRepo("private");
      const publicRepo = await createDestination();
      await write(privateRepo, "src/index.ts", unsafe);
      await commitAll(privateRepo);
      const before = await read(publicRepo, "README.md");

      await expect(
        materializePublicTree({
          sourceRepo: privateRepo,
          sourceRef: "HEAD",
          destination: publicRepo,
        }),
      ).rejects.toMatchObject({ code });

      expect(await read(publicRepo, "README.md")).toBe(before);
      expect(await git(publicRepo, "status", "--porcelain")).toBe("");
    },
  );

  it("rejects an unregistered binary with a stable audit code", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(
      privateRepo,
      "docs/assets/example.png",
      Buffer.from([137, 80, 78, 71, 0, 1]),
    );
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      }),
    ).rejects.toMatchObject({ code: "UNREGISTERED_BINARY" });
  });

  it("allows a binary with complete generated-asset provenance", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    const asset = Buffer.from([137, 80, 78, 71, 0, 1]);
    const provenance = {
      version: 1,
      assets: [
        {
          path: "docs/assets/example.png",
          type: "generated",
          sourceFixture: "examples/demo/slides.html",
          command: "npm run capture-demo",
          license: "MIT",
          sha256: sha256(asset),
        },
      ],
    };
    await write(privateRepo, "docs/assets/example.png", asset);
    await write(
      privateRepo,
      "examples/demo/slides.html",
      "<main>demo</main>\n",
    );
    await write(
      privateRepo,
      "docs/asset-provenance.json",
      `${JSON.stringify(provenance, null, 2)}\n`,
    );
    await commitAll(privateRepo);

    const result = await materializePublicTree({
      sourceRepo: privateRepo,
      sourceRef: "HEAD",
      destination: publicRepo,
    });

    expect(result.added).toContain("docs/assets/example.png");
    expect(
      await fs.readFile(path.join(publicRepo, "docs", "assets", "example.png")),
    ).toEqual(asset);
  });

  it("rejects incomplete provenance before changing the destination", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(
      privateRepo,
      "docs/assets/example.png",
      Buffer.from([137, 80, 78, 71, 0, 1]),
    );
    await write(
      privateRepo,
      "docs/asset-provenance.json",
      '{"version":1,"assets":[{"path":"docs/assets/example.png","type":"generated"}]}\n',
    );
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVENANCE" });
    expect(await git(publicRepo, "status", "--porcelain")).toBe("");
  });

  it("cleanly replaces managed files while preserving the repository metadata", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "src/index.ts", "new source\n");
    await write(privateRepo, "scripts/new-tool.mjs", "export {};\n");
    await commitAll(privateRepo);
    await write(publicRepo, "src/stale.ts", "stale\n");
    await write(publicRepo, "scripts/old-tool.mjs", "old\n");
    await commitAll(publicRepo, "old managed tree");

    const result = await materializePublicTree({
      sourceRepo: privateRepo,
      sourceRef: "HEAD",
      destination: publicRepo,
    });

    expect(result.removed).toEqual([
      "README.md",
      "scripts/old-tool.mjs",
      "src/stale.ts",
    ]);
    expect(await exists(publicRepo, "src/stale.ts")).toBe(false);
    expect(await exists(publicRepo, "scripts/old-tool.mjs")).toBe(false);
    expect(await exists(publicRepo, ".git/HEAD")).toBe(true);
    expect(await read(publicRepo, "src/index.ts")).toBe("new source\n");
  });

  it("refuses a dirty destination before modifying managed files", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "src/index.ts", "new source\n");
    await commitAll(privateRepo);
    await write(publicRepo, "README.md", "user edit\n");

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      }),
    ).rejects.toMatchObject({ code: "DIRTY_DESTINATION" });
    expect(await read(publicRepo, "README.md")).toBe("user edit\n");
    expect(await exists(publicRepo, "src/index.ts")).toBe(false);
  });

  it("CLI emits a secret-free JSON dry-run report and does not mutate", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "src/index.ts", "safe source\n");
    await commitAll(privateRepo);

    const result = spawnSync(
      process.execPath,
      [
        path.resolve("scripts/sync-public-release.mjs"),
        "--source-repo",
        privateRepo,
        "--source-ref",
        "HEAD",
        "--destination",
        publicRepo,
        "--dry-run",
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      dryRun: true,
      added: ["src/index.ts"],
      removed: ["README.md"],
    });
    expect(await exists(publicRepo, "src/index.ts")).toBe(false);
  });

  it("formats rollback recovery metadata for CLI output without serializing causes", async () => {
    const module = await import("../../scripts/lib/public-sync.mjs");
    const hiddenValue = ["never", "-serialize-this-value"].join("");
    const failure = new module.PublicSyncError(
      "APPLY_ROLLBACK_FAILED",
      "Public tree apply and rollback both failed",
      {
        cause: new Error(hiddenValue),
        rollbackError: new Error(hiddenValue),
        recoveryPath: "C:/safe/recovery",
        lockPath: "C:/safe/lock",
        journalPath: "C:/safe/recovery/journal.json",
        originalIndexPath: "C:/safe/recovery/original-index",
      },
    );

    const formatted = module.formatPublicSyncFailure(failure);
    expect(formatted).toEqual({
      error: {
        code: "APPLY_ROLLBACK_FAILED",
        message: "Public tree apply and rollback both failed",
        recoveryPath: "C:/safe/recovery",
        lockPath: "C:/safe/lock",
        journalPath: "C:/safe/recovery/journal.json",
        originalIndexPath: "C:/safe/recovery/original-index",
      },
    });
    expect(JSON.stringify(formatted)).not.toContain(hiddenValue);
  });

  it("rejects a clean managed-root junction without touching its external target", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    const outside = await createRepo("outside");
    await write(privateRepo, "src/index.ts", "new source\n");
    await commitAll(privateRepo);
    await write(publicRepo, "src/sentinel.txt", "outside sentinel\n");
    await commitAll(publicRepo, "tracked managed root");
    await write(outside, "sentinel.txt", "outside sentinel\n");
    await fs.rm(path.join(publicRepo, "src"), { recursive: true, force: true });
    await fs.symlink(outside, path.join(publicRepo, "src"), "junction");
    expect(await git(publicRepo, "status", "--porcelain")).toBe("");

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_DESTINATION_ENTRY" });
    expect(await read(outside, "sentinel.txt")).toBe("outside sentinel\n");
  });

  it("revalidates managed roots immediately before mutation", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    const outside = await createRepo("outside");
    await write(privateRepo, "src/index.ts", "new source\n");
    await commitAll(privateRepo);
    await write(publicRepo, "src/index.ts", "old source\n");
    await commitAll(publicRepo, "tracked source");
    await write(outside, "index.ts", "old source\n");

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: async ({ phase }: { phase: string }) => {
          if (phase === "before-revalidate") {
            await fs.rm(path.join(publicRepo, "src"), {
              recursive: true,
              force: true,
            });
            await fs.symlink(outside, path.join(publicRepo, "src"), "junction");
          }
        },
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_DESTINATION_ENTRY" });
    expect(await read(outside, "index.ts")).toBe("old source\n");
  });

  it("revalidates tracked bytes after final validation and immediately before the first rename", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: async ({ phase }: { phase: string }) => {
          if (phase === "after-revalidate") {
            await write(publicRepo, "README.md", "concurrent final bytes\n");
          }
        },
      }),
    ).rejects.toMatchObject({ code: "DESTINATION_CHANGED" });
    expect(await read(publicRepo, "README.md")).toBe(
      "concurrent final bytes\n",
    );
  });

  it("revalidates index bytes after final validation and immediately before the first rename", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: async ({ phase }: { phase: string }) => {
          if (phase === "after-revalidate") {
            await git(publicRepo, "update-index", "--chmod=+x", "README.md");
          }
        },
      }),
    ).rejects.toMatchObject({ code: "DESTINATION_CHANGED" });
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
  });

  it("rolls back bytes and modes after a mid-apply failure", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new readme\n");
    await write(privateRepo, "src/index.ts", "new source\n");
    await commitAll(privateRepo);
    await write(publicRepo, "src/index.ts", "old source\n");
    await commitAll(publicRepo, "old source");
    const beforeReadme = await fs.readFile(path.join(publicRepo, "README.md"));
    const beforeSource = await fs.readFile(
      path.join(publicRepo, "src", "index.ts"),
    );
    const beforeReadmeMode = (await fs.stat(path.join(publicRepo, "README.md")))
      .mode;
    const beforeSourceMode = (
      await fs.stat(path.join(publicRepo, "src", "index.ts"))
    ).mode;

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: ({ phase, index }: { phase: string; index: number }) => {
          if (phase === "install" && index === 1) {
            throw new Error("injected mid-apply failure");
          }
        },
      }),
    ).rejects.toMatchObject({ code: "APPLY_FAILED" });

    expect(await fs.readFile(path.join(publicRepo, "README.md"))).toEqual(
      beforeReadme,
    );
    expect(await fs.readFile(path.join(publicRepo, "src", "index.ts"))).toEqual(
      beforeSource,
    );
    expect((await fs.stat(path.join(publicRepo, "README.md"))).mode).toBe(
      beforeReadmeMode,
    );
    expect((await fs.stat(path.join(publicRepo, "src", "index.ts"))).mode).toBe(
      beforeSourceMode,
    );
    expect(await git(publicRepo, "status", "--porcelain")).toBe("");
  });

  it.each([
    ["120000", "src/link.ts", "../outside"],
    ["160000", "src/submodule", null],
  ])("rejects unsupported Git mode %s", async (mode, indexPath, content) => {
    const privateRepo = await createRepo("private");
    if (content === null) {
      await write(privateRepo, "README.md", "base\n");
      const objectId = await commitAll(privateRepo, "gitlink target");
      gitWithInput(
        privateRepo,
        ["update-index", "-z", "--index-info"],
        Buffer.from(`${mode} ${objectId}\t${indexPath}\0`),
      );
    } else {
      await addIndexEntry(privateRepo, indexPath, content, mode);
    }
    await commitIndex(privateRepo);

    await expect(
      listPublicFiles({ sourceRepo: privateRepo, sourceRef: "HEAD" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_GIT_ENTRY" });
  });

  it("preserves supported executable metadata", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "scripts/tool.mjs", "#!/usr/bin/env node\n");
    await git(privateRepo, "add", "scripts/tool.mjs");
    await git(privateRepo, "update-index", "--chmod=+x", "scripts/tool.mjs");
    await commitIndex(privateRepo);

    const listed = await listPublicFiles({
      sourceRepo: privateRepo,
      sourceRef: "HEAD",
    });
    expect(listed.entries[0]).toMatchObject({
      path: "scripts/tool.mjs",
      mode: "100755",
      type: "blob",
    });

    await materializePublicTree({
      sourceRepo: privateRepo,
      sourceRef: "HEAD",
      destination: publicRepo,
    });
    expect(await git(publicRepo, "ls-files", "-s", "scripts/tool.mjs")).toMatch(
      /^100755\s/,
    );
    if (process.platform !== "win32") {
      expect(
        (await fs.stat(path.join(publicRepo, "scripts", "tool.mjs"))).mode &
          0o777,
      ).toBe(0o755);
    }
  });

  it.runIf(process.platform !== "win32")(
    "repairs a wrong physical executable mode even when core.filemode is false",
    async () => {
      const privateRepo = await createRepo("private");
      const publicRepo = await createDestination();
      await write(privateRepo, "scripts/tool.mjs", "#!/usr/bin/env node\n");
      await git(privateRepo, "add", "scripts/tool.mjs");
      await git(privateRepo, "update-index", "--chmod=+x", "scripts/tool.mjs");
      await commitIndex(privateRepo);
      await write(publicRepo, "scripts/tool.mjs", "#!/usr/bin/env node\n");
      await git(publicRepo, "add", "scripts/tool.mjs");
      await git(publicRepo, "update-index", "--chmod=+x", "scripts/tool.mjs");
      await git(publicRepo, "commit", "--quiet", "-m", "executable baseline");
      await git(publicRepo, "config", "core.filemode", "false");
      await fs.chmod(path.join(publicRepo, "scripts", "tool.mjs"), 0o644);
      expect(await git(publicRepo, "status", "--porcelain")).toBe("");

      const result = await materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      });

      expect(result.changed).toContain("scripts/tool.mjs");
      expect(
        (await fs.stat(path.join(publicRepo, "scripts", "tool.mjs"))).mode &
          0o111,
      ).toBe(0o111);
    },
  );

  it("rejects case-folding path collisions", async () => {
    const privateRepo = await createRepo("private");
    await addIndexEntry(privateRepo, "src/Name.ts", "first\n");
    await addIndexEntry(privateRepo, "src/name.ts", "second\n");
    await commitIndex(privateRepo);

    await expect(
      listPublicFiles({ sourceRepo: privateRepo, sourceRef: "HEAD" }),
    ).rejects.toMatchObject({ code: "PATH_COLLISION" });
  });

  it.each(["src\\alias.ts", "src/CON.ts", "src/trailing. "])(
    "rejects non-portable Git path %s",
    async (indexPath) => {
      const privateRepo = await createRepo("private");
      const sourceCommit = await createTreeCommitWithPath(
        privateRepo,
        indexPath,
        "unsafe path\n",
      );

      await expect(
        listPublicFiles({ sourceRepo: privateRepo, sourceRef: sourceCommit }),
      ).rejects.toMatchObject({ code: "NON_PORTABLE_PATH" });
    },
  );

  it("treats invalid UTF-8 without NUL bytes as unregistered binary data", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(
      privateRepo,
      "docs/data/sample.dat",
      Buffer.from([0xff, 0xfe, 0xfd]),
    );
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      }),
    ).rejects.toMatchObject({ code: "UNREGISTERED_BINARY" });
  });

  it.each([
    [
      "empty fields",
      { sourceFixture: "", command: "", license: "", sha256: "" },
    ],
    [
      "missing source fixture",
      {
        sourceFixture: "examples/missing.html",
        command: "npm run capture-demo",
        license: "MIT",
        sha256: "HASH",
      },
    ],
    [
      "stale digest",
      {
        sourceFixture: "examples/demo/slides.html",
        command: "npm run capture-demo",
        license: "MIT",
        sha256: "0".repeat(64),
      },
    ],
  ])("rejects generated provenance with %s", async (_label, fields) => {
    const asset = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "docs/assets/example.png", asset);
    await write(
      privateRepo,
      "examples/demo/slides.html",
      "<main>demo</main>\n",
    );
    await write(
      privateRepo,
      "docs/asset-provenance.json",
      `${JSON.stringify({
        version: 1,
        assets: [
          {
            path: "docs/assets/example.png",
            type: "generated",
            ...fields,
            sha256: fields.sha256 === "HASH" ? sha256(asset) : fields.sha256,
          },
        ],
      })}\n`,
    );
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVENANCE" });
  });

  it("requires affirmative third-party redistribution permission", async () => {
    const asset = Buffer.from([137, 80, 78, 71, 4, 5, 6]);
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "docs/assets/external.png", asset);
    await write(
      privateRepo,
      "docs/asset-provenance.json",
      `${JSON.stringify({
        version: 1,
        assets: [
          {
            path: "docs/assets/external.png",
            type: "third-party",
            sourceUrl: "https://example.invalid/asset.png",
            author: "Example Author",
            license: "Example License",
            redistributionPermission: "denied",
            sha256: sha256(asset),
          },
        ],
      })}\n`,
    );
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVENANCE" });
  });

  it("rejects ignored untracked files under managed roots without deleting them", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "src/index.ts", "new source\n");
    await commitAll(privateRepo);
    await write(publicRepo, ".gitignore", "src/*.cache\n");
    await commitAll(publicRepo, "ignore managed cache");
    await write(publicRepo, "src/local.cache", "keep me\n");
    expect(await git(publicRepo, "status", "--porcelain")).toBe("");

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      }),
    ).rejects.toMatchObject({ code: "UNTRACKED_MANAGED_ENTRY" });
    expect(await read(publicRepo, "src/local.cache")).toBe("keep me\n");
  });

  it.each([
    ["quoted password", ['{"pass', 'word":"ordinary-secret"}'].join("")],
    [
      "quoted YAML client secret",
      ['"client_', 'secret": ordinary-value'].join(""),
    ],
    ["short password assignment", ["pass", 'word = "short12"'].join("")],
    ["plain token assignment", ["to", "ken: ordinary-value"].join("")],
    ["raw Slack token", ["xox", "b-123456789012-abcdefghijklmnop"].join("")],
  ])("rejects %s without echoing its value", async (_label, unsafe) => {
    let caught: unknown;
    try {
      await auditPublicEntries([
        { path: "src/config.ts", content: Buffer.from(unsafe) },
      ]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "CREDENTIAL_PATTERN" });
    expect((caught as Error).message).not.toContain(unsafe);
  });

  it("does not treat a local token expression as a credential value", async () => {
    await expect(
      auditPublicEntries([
        {
          path: "src/report.ts",
          content: Buffer.from(
            "const token = value.slice(start, end);\n" +
              "return suffixStart === undefined\n" +
              "  ? token\n" +
              "  : sanitizeResourceLocation(token.slice(0, suffixStart));\n",
          ),
        },
      ]),
    ).resolves.toMatchObject({ registeredAssets: [] });
  });

  it("rejects a swapped clean Git destination root before mutation", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    const displaced = `${publicRepo}-displaced`;
    testRoots.push(displaced);
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: async ({ phase }: { phase: string }) => {
          if (phase !== "before-revalidate") return;
          await fs.rename(publicRepo, displaced);
          await fs.mkdir(publicRepo, { recursive: true });
          await git(publicRepo, "init", "--quiet");
          await git(publicRepo, "config", "user.name", "Root Swap Test");
          await git(
            publicRepo,
            "config",
            "user.email",
            "root-swap@example.invalid",
          );
          await write(publicRepo, "README.md", "swapped clean root\n");
          await commitAll(publicRepo, "swapped root");
        },
      }),
    ).rejects.toMatchObject({ code: "DESTINATION_CHANGED" });
    expect(await read(publicRepo, "README.md")).toBe("swapped clean root\n");
  });

  it("rejects tracked byte changes made after the initial snapshot", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: async ({ phase }: { phase: string }) => {
          if (phase === "before-revalidate") {
            await write(publicRepo, "README.md", "concurrent user bytes\n");
          }
        },
      }),
    ).rejects.toMatchObject({ code: "DESTINATION_CHANGED" });
    expect(await read(publicRepo, "README.md")).toBe("concurrent user bytes\n");
  });

  it("rejects index mode changes made after the initial snapshot", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: async ({ phase }: { phase: string }) => {
          if (phase === "before-revalidate") {
            await git(publicRepo, "update-index", "--chmod=+x", "README.md");
          }
        },
      }),
    ).rejects.toMatchObject({ code: "DESTINATION_CHANGED" });
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
  });

  it("uses an exclusive cooperative destination lock", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const lockPath = path.join(
      path.dirname(publicRepo),
      `.${path.basename(publicRepo)}.public-sync.lock`,
    );
    await fs.mkdir(lockPath);
    testRoots.push(lockPath);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      }),
    ).rejects.toMatchObject({ code: "DESTINATION_LOCKED" });
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
  });

  it("fails closed when the destination root has no stable inode identity", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const realStat = fs.stat.bind(fs);
    const statSpy = vi
      .spyOn(fs, "stat")
      .mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
        const result = await realStat(...args);
        const options = args[1] as { bigint?: boolean } | undefined;
        if (
          path.resolve(String(args[0])) === path.resolve(publicRepo) &&
          options?.bigint === true
        ) {
          return { ...result, ino: 0n } as Awaited<ReturnType<typeof fs.stat>>;
        }
        return result;
      });

    try {
      await expect(
        materializePublicTree({
          sourceRepo: privateRepo,
          sourceRef: "HEAD",
          destination: publicRepo,
        }),
      ).rejects.toMatchObject({ code: "UNSTABLE_DESTINATION_IDENTITY" });
    } finally {
      statSpy.mockRestore();
    }
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
  });

  it("removes a newly created lock when lock identity capture fails", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const lockPath = destinationLockPath(publicRepo);
    testRoots.push(lockPath);
    const realStat = fs.stat.bind(fs);
    const statSpy = vi
      .spyOn(fs, "stat")
      .mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
        const options = args[1] as { bigint?: boolean } | undefined;
        if (
          path.resolve(String(args[0])) === path.resolve(lockPath) &&
          options?.bigint === true
        ) {
          throw Object.assign(new Error("injected lock identity failure"), {
            code: "EACCES",
          });
        }
        return realStat(...args);
      });

    try {
      await expect(
        materializePublicTree({
          sourceRepo: privateRepo,
          sourceRef: "HEAD",
          destination: publicRepo,
        }),
      ).rejects.toMatchObject({ code: "DESTINATION_LOCK_FAILED" });
    } finally {
      statSpy.mockRestore();
    }
    expect(await exists(path.dirname(lockPath), path.basename(lockPath))).toBe(
      false,
    );
  });

  it("restores the Git index snapshot when apply fails after index update", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "scripts/tool.mjs", "#!/usr/bin/env node\n");
    await git(privateRepo, "add", "scripts/tool.mjs");
    await git(privateRepo, "update-index", "--chmod=+x", "scripts/tool.mjs");
    await commitIndex(privateRepo);
    const beforeIndex = await readIndexSnapshot(publicRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: ({ phase }: { phase: string }) => {
          if (phase === "after-index-update") {
            throw new Error("fail after index update");
          }
        },
      }),
    ).rejects.toMatchObject({ code: "APPLY_FAILED" });
    const afterIndex = await readIndexSnapshot(publicRepo);
    expect(afterIndex.bytes).toEqual(beforeIndex.bytes);
    expect(afterIndex.digest).toBe(beforeIndex.digest);
    expect(afterIndex.mode).toBe(beforeIndex.mode);
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
    expect(await git(publicRepo, "status", "--porcelain")).toBe("");
  });

  it("uses index-lock replacement and preserves the on-disk index copy when restore is blocked", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const beforeIndex = await readIndexSnapshot(publicRepo);
    let caught:
      | (Error & {
          code?: string;
          recoveryPath?: string;
          lockPath?: string;
          originalIndexPath?: string;
        })
      | undefined;

    try {
      await materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: async ({ phase }: { phase: string }) => {
          if (phase === "after-index-update") {
            await fs.writeFile(`${beforeIndex.path}.lock`, "occupied\n");
            throw new Error("fail while index lock is occupied");
          }
        },
      });
    } catch (error) {
      caught = error as typeof caught;
    }

    expect(caught).toMatchObject({ code: "APPLY_ROLLBACK_FAILED" });
    expect(caught?.recoveryPath).toBeTruthy();
    expect(caught?.originalIndexPath).toBeTruthy();
    const recoveryIndex = await fs.readFile(caught!.originalIndexPath!);
    expect(recoveryIndex).toEqual(beforeIndex.bytes);
    expect(sha256(recoveryIndex)).toBe(beforeIndex.digest);
    expect((await fs.stat(caught!.originalIndexPath!)).mode & 0o777).toBe(
      beforeIndex.mode,
    );
    expect(caught?.lockPath).toBeTruthy();
    testRoots.push(caught!.recoveryPath!);
    testRoots.push(caught!.lockPath!);
  });

  it("stages only exact managed paths when an unrelated top-level file appears during apply", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);

    await materializePublicTree({
      sourceRepo: privateRepo,
      sourceRef: "HEAD",
      destination: publicRepo,
      faultInjector: async ({ phase }: { phase: string }) => {
        if (phase === "before-index-update") {
          await write(publicRepo, "LOCAL_NOTES.txt", "concurrent local note\n");
        }
      },
    });

    expect(await git(publicRepo, "diff", "--cached", "--name-only")).toBe(
      "README.md",
    );
    expect(await git(publicRepo, "ls-files", "LOCAL_NOTES.txt")).toBe("");
    expect(await read(publicRepo, "LOCAL_NOTES.txt")).toBe(
      "concurrent local note\n",
    );
  });

  it("preserves the last recovery copy when rollback itself fails", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await write(privateRepo, "src/index.ts", "new source\n");
    await commitAll(privateRepo);
    let caught:
      | (Error & { code?: string; recoveryPath?: string; lockPath?: string })
      | undefined;

    try {
      await materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: ({ phase, index }: { phase: string; index: number }) => {
          if (phase === "install" && index === 1) {
            throw new Error("apply failure");
          }
          if (phase === "rollback" && index === 1) {
            throw new Error("rollback failure");
          }
        },
      });
    } catch (error) {
      caught = error as Error & {
        code?: string;
        recoveryPath?: string;
        lockPath?: string;
      };
    }

    expect(caught).toMatchObject({ code: "APPLY_ROLLBACK_FAILED" });
    expect(caught?.recoveryPath).toBeTruthy();
    expect(await exists(caught!.recoveryPath!, "backup/README.md")).toBe(true);
    expect(caught?.lockPath).toBeTruthy();
    expect(await fs.stat(caught!.lockPath!)).toBeTruthy();
    testRoots.push(caught!.recoveryPath!);
    testRoots.push(caught!.lockPath!);
  });

  it("fails before mutation when a staged file cannot be fsynced", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const realOpen = fs.open.bind(fs);
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const target = path.resolve(String(args[0]));
      if (
        target.includes(".public-sync-recovery-") &&
        target.endsWith(path.join("staged", "README.md"))
      ) {
        vi.spyOn(handle, "sync").mockRejectedValueOnce(
          Object.assign(new Error("injected staged fsync failure"), {
            code: "EIO",
          }),
        );
      }
      return handle;
    });

    try {
      await expect(
        materializePublicTree({
          sourceRepo: privateRepo,
          sourceRef: "HEAD",
          destination: publicRepo,
        }),
      ).rejects.toMatchObject({ code: "STAGING_FAILED" });
    } finally {
      openSpy.mockRestore();
    }
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
    expect(await git(publicRepo, "status", "--porcelain")).toBe("");
  });

  it("keeps Windows-style apply usable and reports unsupported directory fsync", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const realOpen = fs.open.bind(fs);
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (args[1] === "r") {
        const stat = await fs.stat(args[0]).catch(() => null);
        if (stat?.isDirectory()) {
          throw Object.assign(new Error("directory sync unsupported"), {
            code: "ENOTSUP",
          });
        }
      }
      return realOpen(...args);
    });

    let result: Awaited<ReturnType<typeof materializePublicTree>> | undefined;
    try {
      result = await materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      });
    } finally {
      openSpy.mockRestore();
    }
    expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
    expect(result?.durability).toMatchObject({
      stagedFiles: "fsynced",
      directoryFsync: "unsupported",
      recoveryProtocol: "hash-reconcile-v1",
    });
  });

  it("fsyncs every nested staged directory and its recovery parents", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await write(
      privateRepo,
      "src/generated/deep/nested/index.ts",
      "export const committed = true;\n",
    );
    await commitAll(privateRepo);
    const syncedDirectories = new Set<string>();
    const realOpen = fs.open.bind(fs);
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const target = path.resolve(String(args[0]));
      const stat = await fs.stat(target).catch(() => null);
      if (args[1] === "r" && stat?.isDirectory()) {
        const realSync = handle.sync.bind(handle);
        vi.spyOn(handle, "sync").mockImplementation(async () => {
          syncedDirectories.add(target);
          await realSync();
        });
      }
      return handle;
    });

    try {
      await materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      });
    } finally {
      openSpy.mockRestore();
    }

    const stagedRoot = [...syncedDirectories].find(
      (directory) =>
        directory.includes(".public-sync-recovery-") &&
        path.basename(directory) === "staged",
    );
    expect(stagedRoot).toBeTruthy();
    for (const expectedDirectory of [
      path.dirname(stagedRoot!),
      stagedRoot!,
      path.join(stagedRoot!, "src"),
      path.join(stagedRoot!, "src", "generated"),
      path.join(stagedRoot!, "src", "generated", "deep"),
      path.join(stagedRoot!, "src", "generated", "deep", "nested"),
    ]) {
      expect(syncedDirectories.has(expectedDirectory)).toBe(true);
    }
  });

  it("recovers a crash after the prepared journal and before apply setup", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await write(privateRepo, "src/index.ts", "new source\n");
    await commitAll(privateRepo);
    const { recoveryPath, lockPath } = await crashIntoRecoveryPhase(
      privateRepo,
      publicRepo,
      "after-prepare",
      75,
    );

    expect(
      JSON.parse(
        await fs.readFile(path.join(recoveryPath, "journal.json"), "utf8"),
      ),
    ).toMatchObject({ phase: "prepared", pending: null });
    expect(await fs.stat(path.join(recoveryPath, "backup"))).toBeTruthy();
    const recovered = await runRecovery(recoveryPath);
    expect(recovered).toMatchObject({
      status: "rolled-back",
      verified: true,
    });
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
    expect(await read(recoveryPath, "staged/README.md")).toBe(
      "new public tree\n",
    );
    expect(await exists(path.dirname(lockPath), path.basename(lockPath))).toBe(
      false,
    );
  });

  it("verifies and finalizes a committed journal with a stale lock", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await write(privateRepo, "src/index.ts", "new source\n");
    await commitAll(privateRepo);
    const { recoveryPath, lockPath } = await crashIntoRecoveryPhase(
      privateRepo,
      publicRepo,
      "after-commit",
      76,
    );

    expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
    expect(
      JSON.parse(
        await fs.readFile(path.join(recoveryPath, "journal.json"), "utf8"),
      ),
    ).toMatchObject({ phase: "committed", pending: null });
    const finalized = await runRecovery(recoveryPath);
    expect(finalized).toMatchObject({
      status: "committed",
      finalized: true,
      verified: true,
    });
    const tombstonePath = `${recoveryPath}.finalized.json`;
    testRoots.push(tombstonePath);
    expect(JSON.parse(await fs.readFile(tombstonePath, "utf8"))).toMatchObject({
      phase: "finalized",
      outcome: "committed",
      recoveryPath,
      destinationRoot: path.resolve(publicRepo),
      lockState: "released",
      cleanupState: "complete",
      destinationIdentity: {
        root: expect.objectContaining({ inode: expect.any(String) }),
        git: expect.objectContaining({ inode: expect.any(String) }),
      },
      lockIdentity: expect.objectContaining({ inode: expect.any(String) }),
      terminalFiles: expect.arrayContaining([
        expect.objectContaining({
          path: "README.md",
          sha256: sha256(Buffer.from("new public tree\n")),
        }),
      ]),
      terminalIndex: expect.objectContaining({
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        mode: expect.any(Number),
      }),
    });
    expect(await exists(path.dirname(lockPath), path.basename(lockPath))).toBe(
      false,
    );
    expect(
      await exists(path.dirname(recoveryPath), path.basename(recoveryPath)),
    ).toBe(false);

    await expect(runRecovery(recoveryPath)).resolves.toMatchObject({
      status: "committed",
      finalized: true,
      verified: true,
    });
    await commitAll(publicRepo, "accept recovered public tree");
    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      }),
    ).resolves.toMatchObject({ added: [], changed: [], removed: [] });
  });

  it("finalizes a verified committed journal when cleanup already removed its lock", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const { recoveryPath, lockPath } = await crashIntoRecoveryPhase(
      privateRepo,
      publicRepo,
      "after-commit",
      77,
    );
    await fs.rmdir(lockPath);

    await expect(runRecovery(recoveryPath)).resolves.toMatchObject({
      status: "committed",
      finalized: true,
      verified: true,
    });
    const tombstonePath = `${recoveryPath}.finalized.json`;
    testRoots.push(tombstonePath);
    expect(JSON.parse(await fs.readFile(tombstonePath, "utf8"))).toMatchObject({
      phase: "finalized",
      outcome: "committed",
      lockState: "released",
      cleanupState: "complete",
    });
    expect(
      await exists(path.dirname(recoveryPath), path.basename(recoveryPath)),
    ).toBe(false);
  });

  it("re-runs recovered cleanup as a verified no-op with no lock", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const { recoveryPath } = await crashIntoPendingRecovery(
      privateRepo,
      publicRepo,
      "after-revalidate",
    );
    await runRecovery(recoveryPath);
    await fs.rm(path.join(recoveryPath, "backup"), {
      recursive: true,
      force: true,
    });

    await expect(runRecovery(recoveryPath)).resolves.toMatchObject({
      status: "rolled-back",
      finalized: true,
      verified: true,
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(recoveryPath, "journal.json"), "utf8"),
      ),
    ).toMatchObject({ phase: "recovered", pending: null });
  });

  it.each([
    ["terminal-after-tombstone", true, true, "held", "pending"],
    ["terminal-after-lock-release", false, true, "held", "pending"],
    [
      "terminal-after-lock-release-recorded",
      false,
      true,
      "released",
      "pending",
    ],
    ["terminal-before-workspace-cleanup", false, true, "released", "pending"],
    ["terminal-after-workspace-cleanup", false, false, "released", "pending"],
  ] as const)(
    "idempotently finalizes a normal success crash at %s",
    async (
      phase,
      lockPresentBeforeRecovery,
      workspacePresentBeforeRecovery,
      lockStateBeforeRecovery,
      cleanupStateBeforeRecovery,
    ) => {
      const privateRepo = await createRepo("private");
      const publicRepo = await createDestination();
      await write(privateRepo, "README.md", "new public tree\n");
      await commitAll(privateRepo);
      const { recoveryPath, lockPath, tombstonePath } =
        await crashIntoTerminalPhase(privateRepo, publicRepo, phase, 80);

      expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
      expect(
        await exists(path.dirname(lockPath), path.basename(lockPath)),
      ).toBe(lockPresentBeforeRecovery);
      expect(
        await exists(path.dirname(recoveryPath), path.basename(recoveryPath)),
      ).toBe(workspacePresentBeforeRecovery);
      expect(
        JSON.parse(await fs.readFile(tombstonePath, "utf8")),
      ).toMatchObject({
        phase: "finalized",
        outcome: "committed",
        recoveryPath,
        lockState: lockStateBeforeRecovery,
        cleanupState: cleanupStateBeforeRecovery,
      });

      await expect(runRecovery(recoveryPath)).resolves.toMatchObject({
        status: "committed",
        finalized: true,
        verified: true,
      });
      expect(
        JSON.parse(await fs.readFile(tombstonePath, "utf8")),
      ).toMatchObject({
        phase: "finalized",
        outcome: "committed",
        lockState: "released",
        cleanupState: "complete",
      });
      expect(
        await exists(path.dirname(lockPath), path.basename(lockPath)),
      ).toBe(false);
      expect(
        await exists(path.dirname(recoveryPath), path.basename(recoveryPath)),
      ).toBe(false);
      await expect(runRecovery(recoveryPath)).resolves.toMatchObject({
        status: "committed",
        finalized: true,
        verified: true,
      });
    },
  );

  it("fails closed rather than removing a new lock while replaying a finalized tombstone", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const { recoveryPath, lockPath } = await crashIntoTerminalPhase(
      privateRepo,
      publicRepo,
      "terminal-after-lock-release-recorded",
      81,
    );
    await fs.mkdir(lockPath);

    await expect(runRecovery(recoveryPath)).rejects.toMatchObject({
      code: "RECOVERY_LOCK_CHANGED",
    });
    expect(await fs.stat(lockPath)).toBeTruthy();
    expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
  });

  it("fails closed when the finalized tombstone is corrupted immediately after its atomic rename", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const lockPath = destinationLockPath(publicRepo);
    const realRename = fs.rename.bind(fs);
    let injected = false;
    let recoveryPath: string | undefined;
    let tombstonePath: string | undefined;
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
        await realRename(...args);
        const target = path.resolve(String(args[1]));
        if (injected || !target.endsWith(".finalized.json")) return;
        injected = true;
        tombstonePath = target;
        const tombstone = JSON.parse(await fs.readFile(target, "utf8"));
        recoveryPath = tombstone.recoveryPath;
        testRoots.push(recoveryPath, tombstonePath, lockPath);
        await fs.rm(target, { force: true });
        await fs.writeFile(target, '{"version":1}\n', { mode: 0o600 });
      });
    let caught: unknown;

    try {
      await materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      });
    } catch (error) {
      caught = error;
    } finally {
      renameSpy.mockRestore();
    }

    expect(injected).toBe(true);
    expect(caught).toMatchObject({ code: "INVALID_RECOVERY_TOMBSTONE" });
    expect(recoveryPath).toBeTruthy();
    expect(tombstonePath).toBeTruthy();
    expect(await fs.readFile(tombstonePath!, "utf8")).toBe('{"version":1}\n');
    expect(await fs.stat(recoveryPath!)).toBeTruthy();
    expect(await fs.stat(lockPath)).toBeTruthy();
    expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
  });

  it("fails closed and preserves a replacement recovery workspace before terminal cleanup", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    let injected = false;
    let recoveryPath: string | undefined;
    let tombstonePath: string | undefined;
    let caught: unknown;

    try {
      await materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: async ({ phase }: { phase: string }) => {
          if (injected || phase !== "terminal-before-workspace-cleanup") {
            return;
          }
          injected = true;
          const tombstones = await findFinalizedTombstones(publicRepo);
          expect(tombstones).toHaveLength(1);
          tombstonePath = tombstones[0]!;
          const tombstone = JSON.parse(
            await fs.readFile(tombstonePath, "utf8"),
          );
          recoveryPath = tombstone.recoveryPath;
          testRoots.push(recoveryPath, tombstonePath);
          await fs.rm(recoveryPath, { recursive: true, force: true });
          await fs.mkdir(recoveryPath);
          await fs.writeFile(
            path.join(recoveryPath, "replacement-sentinel.txt"),
            "foreign workspace\n",
          );
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(injected).toBe(true);
    expect(caught).toMatchObject({ code: "RECOVERY_STATE_CHANGED" });
    expect(await read(recoveryPath!, "replacement-sentinel.txt")).toBe(
      "foreign workspace\n",
    );
    expect(JSON.parse(await fs.readFile(tombstonePath!, "utf8"))).toMatchObject(
      {
        lockState: "released",
        cleanupState: "pending",
      },
    );
    expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
  });

  it("fails closed when a new lock appears after released state is recorded", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const lockPath = destinationLockPath(publicRepo);
    let injected = false;
    let recoveryPath: string | undefined;
    let tombstonePath: string | undefined;
    let caught: unknown;

    try {
      await materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: async ({ phase }: { phase: string }) => {
          if (injected || phase !== "terminal-after-lock-release-recorded") {
            return;
          }
          injected = true;
          const tombstones = await findFinalizedTombstones(publicRepo);
          expect(tombstones).toHaveLength(1);
          tombstonePath = tombstones[0]!;
          const tombstone = JSON.parse(
            await fs.readFile(tombstonePath, "utf8"),
          );
          recoveryPath = tombstone.recoveryPath;
          testRoots.push(recoveryPath, tombstonePath, lockPath);
          await fs.mkdir(lockPath);
          await fs.writeFile(
            path.join(lockPath, "replacement-sentinel.txt"),
            "foreign lock\n",
          );
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(injected).toBe(true);
    expect(caught).toMatchObject({ code: "RECOVERY_LOCK_CHANGED" });
    expect(await read(lockPath, "replacement-sentinel.txt")).toBe(
      "foreign lock\n",
    );
    expect(await fs.stat(recoveryPath!)).toBeTruthy();
    expect(JSON.parse(await fs.readFile(tombstonePath!, "utf8"))).toMatchObject(
      {
        lockState: "released",
        cleanupState: "pending",
      },
    );
    expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
  });

  it.each([
    ["missing", undefined],
    ["empty", []],
    ["unsorted", ["EPERM", "EINVAL"]],
    ["duplicated", ["EINVAL", "EINVAL"]],
    ["unapproved", ["EACCES"]],
  ] as const)(
    "rejects %s unsupported directory fsync metadata during tombstone replay",
    async (_label, codes) => {
      const { publicRepo, recoveryPath, tombstonePath } =
        await createPendingFinalizedTombstone();
      const durability: Record<string, unknown> = {
        stagedFiles: "fsynced",
        directoryFsync: "unsupported",
        recoveryProtocol: "hash-reconcile-v1",
      };
      if (codes !== undefined) {
        durability.unsupportedDirectorySyncCodes = [...codes];
      }
      await rewriteFinalizedDurability(tombstonePath, durability);

      await expect(runRecovery(recoveryPath)).rejects.toMatchObject({
        code: "INVALID_RECOVERY_TOMBSTONE",
      });
      expect(await fs.stat(recoveryPath)).toBeTruthy();
      expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
    },
  );

  it.each(["not-attempted", "supported"] as const)(
    "rejects unsupportedDirectorySyncCodes when directory fsync is %s",
    async (directoryFsync) => {
      const { publicRepo, recoveryPath, tombstonePath } =
        await createPendingFinalizedTombstone();
      await rewriteFinalizedDurability(tombstonePath, {
        stagedFiles: "fsynced",
        directoryFsync,
        recoveryProtocol: "hash-reconcile-v1",
        unsupportedDirectorySyncCodes: ["EINVAL"],
      });

      await expect(runRecovery(recoveryPath)).rejects.toMatchObject({
        code: "INVALID_RECOVERY_TOMBSTONE",
      });
      expect(await fs.stat(recoveryPath)).toBeTruthy();
      expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
    },
  );

  it("replays a valid unsupported directory fsync tombstone", async () => {
    const { publicRepo, recoveryPath, tombstonePath } =
      await createPendingFinalizedTombstone();
    await rewriteFinalizedDurability(tombstonePath, {
      stagedFiles: "fsynced",
      directoryFsync: "unsupported",
      recoveryProtocol: "hash-reconcile-v1",
      unsupportedDirectorySyncCodes: ["EINVAL", "ENOTSUP"],
    });

    await expect(runRecovery(recoveryPath)).resolves.toMatchObject({
      status: "committed",
      finalized: true,
      verified: true,
    });
    expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
    expect(JSON.parse(await fs.readFile(tombstonePath, "utf8"))).toMatchObject({
      cleanupState: "complete",
      durability: {
        directoryFsync: "unsupported",
        unsupportedDirectorySyncCodes: expect.arrayContaining([
          "EINVAL",
          "ENOTSUP",
        ]),
      },
    });
  });

  it("uses the durable terminal protocol after a successful rollback", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await write(privateRepo, "src/index.ts", "new source\n");
    await commitAll(privateRepo);

    await expect(
      materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: ({ phase, index }: { phase: string; index: number }) => {
          if (phase === "install" && index === 1) {
            throw new Error("force a verified rollback");
          }
        },
      }),
    ).rejects.toMatchObject({ code: "APPLY_FAILED" });

    const tombstones = await findFinalizedTombstones(publicRepo);
    expect(tombstones).toHaveLength(1);
    const tombstonePath = tombstones[0]!;
    testRoots.push(tombstonePath);
    const tombstone = JSON.parse(await fs.readFile(tombstonePath, "utf8"));
    expect(tombstone).toMatchObject({
      phase: "finalized",
      outcome: "rolled-back",
      lockState: "released",
      cleanupState: "complete",
      destinationRoot: path.resolve(publicRepo),
    });
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
    expect(await exists(publicRepo, "src/index.ts")).toBe(false);
    expect(await git(publicRepo, "status", "--porcelain")).toBe("");
    expect(
      await exists(
        path.dirname(tombstone.recoveryPath),
        path.basename(tombstone.recoveryPath),
      ),
    ).toBe(false);
    expect(
      await exists(
        path.dirname(destinationLockPath(publicRepo)),
        path.basename(destinationLockPath(publicRepo)),
      ),
    ).toBe(false);
    await expect(runRecovery(tombstone.recoveryPath)).resolves.toMatchObject({
      status: "rolled-back",
      verified: true,
    });
  });

  it.each(["source", "target", "lock"] as const)(
    "fails closed when the recovery %s changes after adjacent validation",
    async (mutation) => {
      const privateRepo = await createRepo("private");
      const publicRepo = await createDestination();
      await write(privateRepo, "README.md", "new public tree\n");
      await commitAll(privateRepo);
      const { recoveryPath, lockPath } = await crashIntoPendingRecovery(
        privateRepo,
        publicRepo,
        "after-durable-rename",
      );
      let injected = false;

      await expect(
        runRecoveryWithFault(recoveryPath, async (context) => {
          if (
            injected ||
            context.phase !== "recovery-after-revalidate" ||
            context.operation !== "restore-old"
          ) {
            return;
          }
          injected = true;
          if (mutation === "source") {
            await fs.writeFile(
              path.join(recoveryPath, "backup", "README.md"),
              "concurrent backup bytes\n",
            );
          } else if (mutation === "target") {
            await fs.writeFile(
              path.join(publicRepo, "README.md"),
              "concurrent destination bytes\n",
            );
          } else {
            await fs.rmdir(lockPath);
            await fs.mkdir(lockPath);
          }
        }),
      ).rejects.toMatchObject({
        code:
          mutation === "lock"
            ? "RECOVERY_LOCK_CHANGED"
            : "RECOVERY_STATE_CHANGED",
      });
      expect(injected).toBe(true);
      if (mutation === "source") {
        expect(await read(recoveryPath, "backup/README.md")).toBe(
          "concurrent backup bytes\n",
        );
        expect(await exists(publicRepo, "README.md")).toBe(false);
      } else if (mutation === "target") {
        expect(await read(publicRepo, "README.md")).toBe(
          "concurrent destination bytes\n",
        );
      }
    },
  );

  it("revalidates a recovery tree rename after pre-rename fsync and before the rename syscall", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const { recoveryPath } = await crashIntoPendingRecovery(
      privateRepo,
      publicRepo,
      "after-durable-rename",
    );
    const backupPath = path.join(recoveryPath, "backup", "README.md");
    let injected = false;

    await expect(
      runRecoveryWithFault(recoveryPath, async (context) => {
        if (
          injected ||
          context.phase !== "recovery-before-rename-final-validation" ||
          context.operation !== "restore-old"
        ) {
          return;
        }
        injected = true;
        await fs.writeFile(backupPath, "changed after pre-rename fsync\n");
      }),
    ).rejects.toMatchObject({ code: "RECOVERY_STATE_CHANGED" });

    expect(injected).toBe(true);
    expect(await exists(publicRepo, "README.md")).toBe(false);
    expect(await read(recoveryPath, "backup/README.md")).toBe(
      "changed after pre-rename fsync\n",
    );
    expect(
      JSON.parse(
        await fs.readFile(path.join(recoveryPath, "journal.json"), "utf8"),
      ),
    ).toMatchObject({
      phase: "recovering",
      pending: { operation: "restore-old", unit: "README.md" },
    });

    await fs.writeFile(backupPath, "old public tree\n");
    await expect(runRecovery(recoveryPath)).resolves.toMatchObject({
      status: "rolled-back",
      verified: true,
    });
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
  });

  it.each(["prepared index lock", "live index"] as const)(
    "revalidates %s after pre-rename fsync and before the index-restore rename syscall",
    async (mutation) => {
      const privateRepo = await createRepo("private");
      const publicRepo = await createDestination();
      await write(privateRepo, "README.md", "new public tree\n");
      await commitAll(privateRepo);
      const { recoveryPath } = await crashIntoRecoveryPhase(
        privateRepo,
        publicRepo,
        "after-index-update",
        79,
      );
      const beforeRecoveryIndex = await readIndexSnapshot(publicRepo);
      const indexLockPath = `${beforeRecoveryIndex.path}.lock`;
      let injected = false;

      await expect(
        runRecoveryWithFault(recoveryPath, async (context) => {
          if (
            injected ||
            context.phase !== "recovery-before-rename-final-validation" ||
            context.operation !== "restore-index"
          ) {
            return;
          }
          injected = true;
          if (mutation === "prepared index lock") {
            await fs.appendFile(indexLockPath, "changed-index-lock");
          } else {
            await fs.appendFile(beforeRecoveryIndex.path, "changed-live-index");
          }
        }),
      ).rejects.toMatchObject({
        code:
          mutation === "prepared index lock"
            ? "INDEX_RESTORE_FAILED"
            : "RECOVERY_STATE_CHANGED",
      });

      expect(injected).toBe(true);
      expect(await exists(recoveryPath, "original-index")).toBe(true);
      if (mutation === "live index") {
        expect(await fs.readFile(beforeRecoveryIndex.path)).not.toEqual(
          beforeRecoveryIndex.bytes,
        );
        await fs.writeFile(beforeRecoveryIndex.path, beforeRecoveryIndex.bytes);
      }
      await fs.rm(indexLockPath, { force: true });
      await expect(runRecovery(recoveryPath)).resolves.toMatchObject({
        status: "rolled-back",
        verified: true,
      });
      expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
    },
  );

  it("does not overwrite a concurrently changed index during recovery", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const { recoveryPath } = await crashIntoRecoveryPhase(
      privateRepo,
      publicRepo,
      "after-index-update",
      78,
    );
    const indexPath = (await readIndexSnapshot(publicRepo)).path;
    let injectedIndex = Buffer.alloc(0);

    await expect(
      runRecoveryWithFault(recoveryPath, async (context) => {
        if (
          injectedIndex.length === 0 &&
          context.phase === "recovery-after-revalidate" &&
          context.operation === "restore-index"
        ) {
          injectedIndex = Buffer.concat([
            await fs.readFile(indexPath),
            Buffer.from("concurrent-index"),
          ]);
          await fs.writeFile(indexPath, injectedIndex);
        }
      }),
    ).rejects.toMatchObject({ code: "RECOVERY_STATE_CHANGED" });
    expect(injectedIndex.length).toBeGreaterThan(0);
    expect(await fs.readFile(indexPath)).toEqual(injectedIndex);
  });

  it("durably journals moved units and the original index before a simulated process crash", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await write(privateRepo, "src/index.ts", "new source\n");
    await commitAll(privateRepo);
    const beforeIndex = await readIndexSnapshot(publicRepo);
    const moduleUrl = pathToFileURL(
      path.resolve("scripts/lib/public-sync.mjs"),
    ).href;
    const crashScript = `
      import { materializePublicTree } from ${JSON.stringify(moduleUrl)};
      await materializePublicTree({
        sourceRepo: ${JSON.stringify(privateRepo)},
        sourceRef: "HEAD",
        destination: ${JSON.stringify(publicRepo)},
        faultInjector({ phase, index }) {
          if (phase === "backup" && index === 1) process.exit(73);
        },
      });
    `;

    const crashed = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", crashScript],
      { encoding: "utf8" },
    );
    expect(crashed.status, crashed.stderr).toBe(73);

    const recoveries = await findRecoveryWorkspaces(publicRepo);
    expect(recoveries).toHaveLength(1);
    const recoveryPath = recoveries[0]!;
    const lockPath = destinationLockPath(publicRepo);
    testRoots.push(recoveryPath, lockPath);
    const journalPath = path.join(recoveryPath, "journal.json");
    const originalIndexPath = path.join(recoveryPath, "original-index");
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
    expect(journal).toMatchObject({
      version: 2,
      destinationRoot: path.resolve(publicRepo),
      phase: "backing-up",
      movedOld: ["README.md"],
      installedNew: [],
      indexState: "original",
      pending: null,
      originalIndex: {
        relativePath: "original-index",
        sha256: beforeIndex.digest,
        mode: beforeIndex.mode,
      },
      destinationIdentity: {
        root: expect.objectContaining({ inode: expect.any(String) }),
        git: expect.objectContaining({ inode: expect.any(String) }),
      },
      lockIdentity: expect.objectContaining({ inode: expect.any(String) }),
      originalFiles: [
        {
          path: "README.md",
          sha256: sha256(Buffer.from("old public tree\n")),
          mode: expect.any(Number),
        },
      ],
      desiredFiles: expect.arrayContaining([
        {
          path: "README.md",
          sha256: sha256(Buffer.from("new public tree\n")),
          mode: expect.any(Number),
        },
        {
          path: "src/index.ts",
          sha256: sha256(Buffer.from("new source\n")),
          mode: expect.any(Number),
        },
      ]),
      durability: expect.objectContaining({
        stagedFiles: "fsynced",
        directoryFsync: expect.stringMatching(/^(?:supported|unsupported)$/),
        recoveryProtocol: "hash-reconcile-v1",
      }),
    });
    const recoveryIndex = await fs.readFile(originalIndexPath);
    expect(recoveryIndex).toEqual(beforeIndex.bytes);
    expect((await fs.stat(originalIndexPath)).mode & 0o777).toBe(
      beforeIndex.mode,
    );
    expect(await fs.stat(lockPath)).toBeTruthy();
    expect(await exists(recoveryPath, "backup/README.md")).toBe(true);
  });

  it("preserves recovery authority when rename succeeds but post-rename parent fsync fails", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const realOpen = fs.open.bind(fs);
    let injected = false;
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const target = path.resolve(String(args[0]));
      if (args[1] === "r" && target === path.resolve(publicRepo)) {
        const realSync = handle.sync.bind(handle);
        vi.spyOn(handle, "sync").mockImplementation(async () => {
          const renameAlreadyHappened = !(await exists(
            publicRepo,
            "README.md",
          ));
          if (!injected && renameAlreadyHappened) {
            injected = true;
            throw Object.assign(
              new Error("post-rename directory fsync failed"),
              {
                code: "EIO",
              },
            );
          }
          await realSync();
        });
      }
      return handle;
    });
    let caught:
      | (Error & { code?: string; recoveryPath?: string; lockPath?: string })
      | undefined;

    try {
      await materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
      });
    } catch (error) {
      caught = error as typeof caught;
    } finally {
      openSpy.mockRestore();
    }

    expect(injected).toBe(true);
    expect(caught).toMatchObject({ code: "APPLY_ROLLBACK_FAILED" });
    expect(caught?.recoveryPath).toBeTruthy();
    expect(caught?.lockPath).toBeTruthy();
    expect(await exists(caught!.recoveryPath!, "journal.json")).toBe(true);
    expect(await exists(caught!.recoveryPath!, "backup/README.md")).toBe(true);
    expect(await exists(publicRepo, "README.md")).toBe(false);
    testRoots.push(caught!.recoveryPath!, caught!.lockPath!);

    await expect(runRecovery(caught!.recoveryPath!)).resolves.toMatchObject({
      status: "rolled-back",
      verified: true,
    });
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
    expect(await git(publicRepo, "status", "--porcelain")).toBe("");
  });

  it.each([
    ["pre-rename", "after-revalidate"],
    ["post-rename", "after-durable-rename"],
    ["mixed post-install", "after-revalidate"],
  ] as const)(
    "deterministically reconciles a pending %s transition without data loss",
    async (state, crashPhase) => {
      const privateRepo = await createRepo("private");
      const publicRepo = await createDestination();
      await write(privateRepo, "README.md", "new public tree\n");
      await write(privateRepo, "src/index.ts", "new source\n");
      await commitAll(privateRepo);
      const beforeIndex = await readIndexSnapshot(publicRepo);
      const { recoveryPath, lockPath } = await crashIntoPendingRecovery(
        privateRepo,
        publicRepo,
        crashPhase,
      );

      if (state === "mixed post-install") {
        await fs.rename(
          path.join(publicRepo, "README.md"),
          path.join(recoveryPath, "backup", "README.md"),
        );
        await fs.rename(
          path.join(recoveryPath, "staged", "README.md"),
          path.join(publicRepo, "README.md"),
        );
      }

      const beforeRecoveryJournal = JSON.parse(
        await fs.readFile(path.join(recoveryPath, "journal.json"), "utf8"),
      );
      expect(beforeRecoveryJournal.pending).toEqual({
        operation: "backup",
        unit: "README.md",
      });
      const recovered = await runRecovery(recoveryPath);

      expect(recovered).toMatchObject({
        status: "rolled-back",
        destinationRoot: path.resolve(publicRepo),
        recoveryPath,
      });
      expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
      expect(await exists(publicRepo, "src/index.ts")).toBe(false);
      expect(await read(recoveryPath, "staged/README.md")).toBe(
        "new public tree\n",
      );
      expect(await read(recoveryPath, "staged/src/index.ts")).toBe(
        "new source\n",
      );
      const afterIndex = await readIndexSnapshot(publicRepo);
      expect(afterIndex.bytes).toEqual(beforeIndex.bytes);
      expect(await git(publicRepo, "status", "--porcelain")).toBe("");
      expect(
        await exists(path.dirname(lockPath), path.basename(lockPath)),
      ).toBe(false);
      expect(
        JSON.parse(
          await fs.readFile(path.join(recoveryPath, "journal.json"), "utf8"),
        ),
      ).toMatchObject({ phase: "recovered", pending: null });
    },
  );

  it("exposes deterministic recovery through the CLI", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const { recoveryPath } = await crashIntoPendingRecovery(
      privateRepo,
      publicRepo,
      "after-revalidate",
    );

    const recovered = spawnSync(
      process.execPath,
      ["scripts/sync-public-release.mjs", "--recover", recoveryPath],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      status: "rolled-back",
      destinationRoot: path.resolve(publicRepo),
      recoveryPath,
    });
    expect(await read(publicRepo, "README.md")).toBe("old public tree\n");
  });

  it("returns a post-commit warning when cleanup fails", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);

    const result = await materializePublicTree({
      sourceRepo: privateRepo,
      sourceRef: "HEAD",
      destination: publicRepo,
      faultInjector: ({ phase }: { phase: string }) => {
        if (phase === "cleanup") {
          throw new Error("cleanup failure");
        }
      },
    });

    expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "CLEANUP_FAILED" }),
    ]);
    const recoveryPath = result.warnings[0]?.recoveryPath;
    expect(recoveryPath).toBeTruthy();
    expect(await exists(recoveryPath!, "backup/README.md")).toBe(true);
    testRoots.push(recoveryPath!);
  });

  it("propagates a cleanup integrity error unchanged", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);
    const injected = new PublicSyncError(
      "RECOVERY_STATE_CHANGED",
      "Injected cleanup integrity failure",
    );
    let caught: unknown;
    let returned: Awaited<ReturnType<typeof materializePublicTree>> | undefined;

    try {
      returned = await materializePublicTree({
        sourceRepo: privateRepo,
        sourceRef: "HEAD",
        destination: publicRepo,
        faultInjector: ({ phase }: { phase: string }) => {
          if (phase === "cleanup") throw injected;
        },
      });
    } catch (error) {
      caught = error;
    }

    expect({
      outcome: caught ? "rejected" : "resolved",
      errorCode: (caught as { code?: string } | undefined)?.code,
      warningCodes: returned?.warnings.map((warning) => warning.code),
    }).toEqual({
      outcome: "rejected",
      errorCode: "RECOVERY_STATE_CHANGED",
      warningCodes: undefined,
    });
    expect(caught).toBe(injected);
    const tombstones = await findFinalizedTombstones(publicRepo);
    expect(tombstones).toHaveLength(1);
    const tombstonePath = tombstones[0]!;
    const tombstone = JSON.parse(await fs.readFile(tombstonePath, "utf8"));
    testRoots.push(tombstone.recoveryPath, tombstonePath);
    expect(tombstone).toMatchObject({
      lockState: "released",
      cleanupState: "pending",
    });
    expect(await fs.stat(tombstone.recoveryPath)).toBeTruthy();
    expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
  });

  it("keeps an ordinary cleanup integrity-neutral failure replayable as a warning", async () => {
    const privateRepo = await createRepo("private");
    const publicRepo = await createDestination();
    await write(privateRepo, "README.md", "new public tree\n");
    await commitAll(privateRepo);

    const result = await materializePublicTree({
      sourceRepo: privateRepo,
      sourceRef: "HEAD",
      destination: publicRepo,
      faultInjector: ({ phase }: { phase: string }) => {
        if (phase === "cleanup") throw new Error("ordinary cleanup failure");
      },
    });

    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "CLEANUP_FAILED",
        recoveryPath: expect.any(String),
        tombstonePath: expect.any(String),
      }),
    ]);
    const recoveryPath = result.warnings[0]!.recoveryPath;
    const tombstonePath = result.warnings[0]!.tombstonePath;
    testRoots.push(recoveryPath, tombstonePath);
    expect(JSON.parse(await fs.readFile(tombstonePath, "utf8"))).toMatchObject({
      lockState: "released",
      cleanupState: "pending",
    });

    await expect(runRecovery(recoveryPath)).resolves.toMatchObject({
      status: "committed",
      finalized: true,
      verified: true,
    });
    expect(JSON.parse(await fs.readFile(tombstonePath, "utf8"))).toMatchObject({
      lockState: "released",
      cleanupState: "complete",
    });
    expect(
      await exists(path.dirname(recoveryPath), path.basename(recoveryPath)),
    ).toBe(false);
    expect(await read(publicRepo, "README.md")).toBe("new public tree\n");
  });

  it.each([
    ["short password", ["pass", "word: x"].join("")],
    ["punctuation YAML", ["client_", "secret: p@$$!"].join("")],
    [
      "GitHub fine-grained token",
      ["github_", "pat_11AA22BB33CC44DD55EE66FF77GG88HH"].join(""),
    ],
    ["Slack app token", ["xa", "pp-1-A1234567890-abcdef"].join("")],
  ])("rejects %s without exposing the value", async (_label, unsafe) => {
    let caught: unknown;
    try {
      await auditPublicEntries([
        { path: "src/config.ts", content: Buffer.from(unsafe) },
      ]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "CREDENTIAL_PATTERN" });
    expect((caught as Error).message).not.toContain(unsafe);
  });

  it.each([
    ["placeholder"],
    ["example"],
    ["changeme"],
    ["[redacted]"],
    ["********"],
    ["${PUBLIC_SYNC_TOKEN}"],
    ["process.env.PUBLIC_SYNC_TOKEN"],
  ])("allows the documented credential placeholder %s", async (placeholder) => {
    await expect(
      auditPublicEntries([
        {
          path: "docs/config-example.yml",
          content: Buffer.from(`password: ${placeholder}\n`),
        },
      ]),
    ).resolves.toMatchObject({ registeredAssets: [] });
  });

  it.each([
    ["YAML list mapping", ["- pass", "word: p@$$;#[]{}"].join("")],
    ["dotted assignment", ["service.auth.pass", 'word = "q!"'].join("")],
    ["nested JSON field", ['{"service":{"client_', 'secret":"!x"}}'].join("")],
    [
      "nested YAML field",
      ["service:\n  auth:\n    access_", "token: z"].join(""),
    ],
    [
      "quoted hash punctuation",
      ["pass", 'word: "abc#[]{};!," # trailing note'].join(""),
    ],
  ])("rejects line-oriented credential form %s", async (_label, unsafe) => {
    let caught: unknown;
    try {
      await auditPublicEntries([
        { path: "src/config.yml", content: Buffer.from(unsafe) },
      ]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "CREDENTIAL_PATTERN",
      path: "src/config.yml",
    });
    expect(JSON.stringify(caught)).not.toContain(unsafe);
  });

  it("ignores comment-only credential examples and nested empty mappings", async () => {
    const benign = [
      ["# pass", "word: real-looking-comment"].join(""),
      ["// to", "ken = real-looking-comment"].join(""),
      ["/* client_", "secret: real-looking-comment */"].join(""),
      ["to", "ken:", "  placeholder: true"].join("\n"),
    ].join("\n");

    await expect(
      auditPublicEntries([
        { path: "docs/config-example.yml", content: Buffer.from(benign) },
      ]),
    ).resolves.toMatchObject({ registeredAssets: [] });
  });

  it.each([
    ["${PASSWORD:-changeme}"],
    ["${PASSWORD:-${DEFAULT_PASSWORD}}"],
    ["${NAME}"],
    ["process.env.NAME"],
    ["%NAME%"],
    ["$env:NAME"],
    ["<masked>"],
    ["[example]"],
  ])("allows field-aware environment placeholder %s", async (placeholder) => {
    await expect(
      auditPublicEntries([
        {
          path: "docs/config-example.yml",
          content: Buffer.from(`password: ${placeholder}\n`),
        },
      ]),
    ).resolves.toMatchObject({ registeredAssets: [] });
  });

  it.each([
    [
      "multiline nested object",
      ['{\n  "service": {\n    "client_', 'secret":\n      "q!"\n  }\n}'].join(
        "",
      ),
    ],
    [
      "array of nested objects",
      [
        '[\n  {"service": {"enabled": true}},\n  {"auth": {"access_',
        'token": "z"}}\n]',
      ].join(""),
    ],
  ])(
    "rejects structurally parsed JSON credential %s",
    async (_label, unsafe) => {
      let caught: unknown;
      try {
        await auditPublicEntries([
          { path: "src/config.json", content: Buffer.from(unsafe) },
        ]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: "CREDENTIAL_PATTERN",
        path: "src/config.json",
      });
      expect(JSON.stringify(caught)).not.toContain("q!");
      expect(JSON.stringify(caught)).not.toContain('"z"');
    },
  );

  it.each([
    [
      "root duplicate",
      ['{"pass', 'word":"q!","password":"placeholder"}'].join(""),
    ],
    [
      "multiline nested duplicate",
      [
        '{\n  "service": {\n    "access_',
        'token": "q!",\n    "access_token": "placeholder"\n  }\n}',
      ].join(""),
    ],
    [
      "array object duplicate",
      [
        '[\n  {\n    "client_',
        'secret": "q!",\n    "client_secret": "masked"\n  }\n]',
      ].join(""),
    ],
  ])(
    "rejects every JSON property occurrence for %s",
    async (_label, unsafe) => {
      let caught: unknown;
      try {
        await auditPublicEntries([
          { path: "src/config.json", content: Buffer.from(unsafe) },
        ]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: "CREDENTIAL_PATTERN",
        path: "src/config.json",
      });
      expect(JSON.stringify(caught)).not.toContain("q!");
      expect(Object.keys(caught as object).sort()).toEqual([
        "code",
        "name",
        "path",
      ]);
    },
  );

  it.each([
    ["typed annotation", ["const to", "ken: string = 'q!';"].join("")],
    [
      "union annotation",
      ["const access_", "token: string | undefined = 'q!';"].join(""),
    ],
    [
      "generic annotation",
      ["const client_", "secret: Secret<string> = 'q!';"].join(""),
    ],
    [
      "class property annotation",
      ["class Config { pass", "word: string = 'q!'; }"].join(""),
    ],
    [
      "typed multiline call literal",
      ["const to", "ken: string = auth.getToken(\n  options,\n  'q!'\n);"].join(
        "",
      ),
    ],
    [
      "typed nested object literal",
      [
        "const api_",
        "key: Secret<string> = build({\n  fallback: 'q!'\n});",
      ].join(""),
    ],
  ])("rejects typed credential literal %s", async (_label, unsafe) => {
    let caught: unknown;
    try {
      await auditPublicEntries([
        { path: "src/config.ts", content: Buffer.from(unsafe) },
      ]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "CREDENTIAL_PATTERN",
      path: "src/config.ts",
    });
    expect(JSON.stringify(caught)).not.toContain("q!");
  });

  it.each([
    [
      "typed multiline member call",
      [
        "const to",
        "ken: string | undefined = auth\n  .session\n  .getToken<string>(\n    options\n  );",
      ].join(""),
    ],
    [
      "typed multiline member expression",
      ["const access_", "token: Token<string> = credentials\n  .current;"].join(
        "",
      ),
    ],
    [
      "multiline object member call",
      [
        "const config = {\n  client_",
        "secret: auth\n    .resolveSecret(\n      options\n    )\n};",
      ].join(""),
    ],
    [
      "comments around typed computed value",
      [
        "const /* field */ to",
        "ken /* type */: string = /* value */ auth.getToken();",
      ].join(""),
    ],
  ])("allows balanced computed TypeScript %s", async (_label, source) => {
    await expect(
      auditPublicEntries([
        { path: "src/config.ts", content: Buffer.from(source) },
      ]),
    ).resolves.toMatchObject({ registeredAssets: [] });
  });

  it("allows credential-looking syntax in comments and unrelated literals", async () => {
    const source = [
      ["// const to", "ken: string = 'q!';"].join(""),
      ["/* const pass", "word: string = 'q!'; */"].join(""),
      ["const documentation = `const access_", "token: string = 'q!';`;"].join(
        "",
      ),
      ["const to", "ken: string = auth.getToken();"].join(""),
    ].join("\n");

    await expect(
      auditPublicEntries([
        { path: "src/config.ts", content: Buffer.from(source) },
      ]),
    ).resolves.toMatchObject({ registeredAssets: [] });
  });

  it.each([
    ["direct call", "const token = getToken();"],
    ["member call", "const token = auth.getToken();"],
    ["member expression", "const token = credentials.current;"],
    [
      "function expression",
      "const token = function resolveToken() { return getToken(); };",
    ],
    ["arrow function", "const token = () => getToken();"],
    ["object member call", "const config = { token: getToken() };"],
  ])(
    "allows safe computed credential expression %s",
    async (_label, source) => {
      await expect(
        auditPublicEntries([
          { path: "src/config.ts", content: Buffer.from(`${source}\n`) },
        ]),
      ).resolves.toMatchObject({ registeredAssets: [] });
    },
  );

  it.each([
    ["direct literal", ["const to", 'ken = "q!";'].join("")],
    ["literal call argument", ["const to", 'ken = getToken("q!");'].join("")],
    ["object literal", ["const config = { to", 'ken: "q!" };'].join("")],
  ])("rejects actual credential string literal %s", async (_label, unsafe) => {
    await expect(
      auditPublicEntries([
        {
          path: "src/config.ts",
          content: Buffer.from(`// token = getToken();\n${unsafe}\n`),
        },
      ]),
    ).rejects.toMatchObject({
      code: "CREDENTIAL_PATTERN",
      path: "src/config.ts",
    });
  });

  it.each([
    [
      "private typed field",
      ["class Config { private pass", 'word: string = "q!"; }'].join(""),
    ],
    [
      "computed private field",
      ['class Config { private ["pass', 'word"]: string = "q!"; }'].join(""),
    ],
    [
      "private identifier field",
      ["class Config { #pass", 'word: string = "q!"; }'].join(""),
    ],
    [
      "destructuring property alias default",
      ["const { to", 'ken: alias = "q!" } = source;'].join(""),
    ],
    ["nullish assignment", ["to", 'ken ??= "q!";'].join("")],
    ["logical-or assignment", ["to", 'ken ||= "q!";'].join("")],
    ["logical-and assignment", ["to", 'ken &&= "q!";'].join("")],
    [
      "typed literal before unrelated parse error",
      [
        "const client_",
        'secret: Secret<string> = "q!";\nconst broken: Array< = [];',
      ].join(""),
    ],
  ])(
    "rejects TypeScript credential bypass %s without exposing literals or diagnostics",
    async (_label, unsafe) => {
      let caught: unknown;
      try {
        await auditPublicEntries([
          { path: "src/config.ts", content: Buffer.from(unsafe) },
        ]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: "CREDENTIAL_PATTERN",
        path: "src/config.ts",
      });
      expect(Object.keys(caught as object).sort()).toEqual([
        "code",
        "name",
        "path",
      ]);
      expect(JSON.stringify(caught)).not.toContain("q!");
      expect(JSON.stringify(caught)).not.toContain("Expression expected");
    },
  );

  it.each([
    [
      "private typed field",
      [
        "class Config { private pass",
        "word: string = auth.getPassword(); }",
      ].join(""),
    ],
    [
      "computed private field",
      [
        'class Config { private ["pass',
        'word"]: string = auth.getPassword(); }',
      ].join(""),
    ],
    [
      "private identifier field",
      ["class Config { #pass", "word: string = auth.getPassword(); }"].join(""),
    ],
    [
      "destructuring property alias default",
      ["const { to", "ken: alias = auth.getToken() } = source;"].join(""),
    ],
    ["nullish assignment", ["to", "ken ??= auth.getToken();"].join("")],
    ["logical-or assignment", ["to", "ken ||= auth.getToken();"].join("")],
    ["logical-and assignment", ["to", "ken &&= auth.getToken();"].join("")],
    [
      "computed value before unrelated parse error",
      [
        "const client_",
        "secret: Secret<string> = auth.getSecret();\nconst broken: Array< = [];",
      ].join(""),
    ],
  ])("allows computed TypeScript counterpart %s", async (_label, source) => {
    await expect(
      auditPublicEntries([
        { path: "src/config.ts", content: Buffer.from(source) },
      ]),
    ).resolves.toMatchObject({ registeredAssets: [] });
  });
});
