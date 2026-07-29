import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizePublicRepoUrl,
  setupPublicClone,
} from "../../scripts/setup-public-clone.mjs";

const execFile = promisify(execFileCallback);
const testRoots: string[] = [];

async function git(repo: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", repo, ...args], {
    encoding: "utf8",
  });
  return result.stdout.trim();
}

async function clone(repoUrl: string, destination: string): Promise<void> {
  await execFile("git", ["clone", "--quiet", repoUrl, destination], {
    encoding: "utf8",
  });
}

async function createFixture(): Promise<{
  root: string;
  privateRepo: string;
  publicBare: string;
  publicUrl: string;
  destination: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "public-clone-"));
  testRoots.push(root);
  const privateRepo = path.join(root, "private");
  const publicBare = path.join(root, "UtenKekkoDev", "dom-native-pptx.git");
  const destination = path.join(root, "public");
  await fs.mkdir(privateRepo, { recursive: true });
  await fs.mkdir(path.dirname(publicBare), { recursive: true });
  await fs.mkdir(publicBare, { recursive: true });
  await git(privateRepo, "init", "--quiet", "--initial-branch=main");
  await git(privateRepo, "config", "user.name", "Public Clone Test");
  await git(
    privateRepo,
    "config",
    "user.email",
    "public-clone@example.invalid",
  );
  await fs.writeFile(path.join(privateRepo, "README.md"), "private source\n");
  await git(privateRepo, "add", "README.md");
  await git(privateRepo, "commit", "--quiet", "-m", "initial source");
  await git(publicBare, "init", "--bare", "--quiet", "--initial-branch=main");
  await git(privateRepo, "remote", "add", "publish", publicBare);
  await git(privateRepo, "push", "--quiet", "publish", "main:main");
  await git(privateRepo, "remote", "set-url", "--push", "publish", publicBare);
  return { root, privateRepo, publicBare, publicUrl: publicBare, destination };
}

async function remoteSnapshot(repo: string): Promise<string> {
  return git(repo, "config", "--get-regexp", "^remote\\.");
}

async function privateSnapshot(repo: string): Promise<{
  branch: string;
  status: string;
  readme: string;
}> {
  return {
    branch: await git(repo, "branch", "--show-current"),
    status: await git(repo, "status", "--porcelain=v1"),
    readme: await fs.readFile(path.join(repo, "README.md"), "utf8"),
  };
}

afterEach(async () => {
  await Promise.all(
    testRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("isolated public clone setup", () => {
  it("clones and validates main before removing only the matching public push remote", async () => {
    const fixture = await createFixture();
    await git(
      fixture.privateRepo,
      "remote",
      "add",
      "upstream",
      path.join(fixture.root, "private-upstream.git"),
    );
    await git(
      fixture.privateRepo,
      "remote",
      "set-url",
      "--push",
      "upstream",
      path.join(fixture.root, "private-push.git"),
    );
    const privateBefore = await privateSnapshot(fixture.privateRepo);

    const result = await setupPublicClone({
      privateRepo: fixture.privateRepo,
      publicRepoUrl: fixture.publicUrl,
      destination: fixture.destination,
    });

    expect(result.defaultBranch).toBe("main");
    expect(await git(fixture.destination, "branch", "--show-current")).toBe(
      "main",
    );
    expect(await git(fixture.destination, "status", "--porcelain=v1")).toBe("");
    expect(await git(fixture.destination, "remote", "get-url", "origin")).toBe(
      fixture.publicUrl,
    );
    expect(await git(fixture.privateRepo, "remote")).not.toContain("publish");
    expect(await git(fixture.privateRepo, "remote")).toContain("upstream");
    expect(await privateSnapshot(fixture.privateRepo)).toEqual(privateBefore);
  });

  it("normalizes equivalent HTTPS and scp-style SSH public URLs", () => {
    const https = "https://github.com/UtenKekkoDev/dom-native-pptx.git";
    const identity = normalizePublicRepoUrl(https);

    expect(
      normalizePublicRepoUrl("git@github.com:UtenKekkoDev/dom-native-pptx.git"),
    ).toBe(identity);
  });

  it("normalizes standard SSH public URLs with HTTPS", () => {
    expect(
      normalizePublicRepoUrl(
        "ssh://git@github.com/UtenKekkoDev/dom-native-pptx.git",
      ),
    ).toBe(
      normalizePublicRepoUrl(
        "https://github.com/UtenKekkoDev/dom-native-pptx.git",
      ),
    );
  });

  it("rejects standard SSH public URLs with an explicit port", () => {
    expect(() =>
      normalizePublicRepoUrl(
        "ssh://git@github.com:2222/UtenKekkoDev/dom-native-pptx.git",
      ),
    ).toThrow(expect.objectContaining({ code: "UNSAFE_PUBLIC_URL" }));
  });

  it("rejects HTTP public URLs instead of treating them as HTTPS", () => {
    expect(() =>
      normalizePublicRepoUrl(
        "http://github.com/UtenKekkoDev/dom-native-pptx.git",
      ),
    ).toThrow(expect.objectContaining({ code: "UNSAFE_PUBLIC_URL" }));
  });

  it("keeps a different repository path distinct from the expected identity", () => {
    const identity = normalizePublicRepoUrl(
      "https://github.com/UtenKekkoDev/dom-native-pptx.git",
    );
    expect(
      normalizePublicRepoUrl(
        "https://github.com/UtenKekkoDev/another-repo.git",
      ),
    ).not.toBe(identity);
  });

  it("keeps a different host distinct from the expected identity", () => {
    const identity = normalizePublicRepoUrl(
      "https://github.com/UtenKekkoDev/dom-native-pptx.git",
    );
    expect(
      normalizePublicRepoUrl(
        "https://example.invalid/UtenKekkoDev/dom-native-pptx.git",
      ),
    ).not.toBe(identity);
  });

  it("fails on a dirty destination without changing private remotes or files", async () => {
    const fixture = await createFixture();
    await clone(fixture.publicBare, fixture.destination);
    await fs.writeFile(
      path.join(fixture.destination, "README.md"),
      "dirty public clone\n",
    );
    const remotesBefore = await remoteSnapshot(fixture.privateRepo);
    const privateBefore = await privateSnapshot(fixture.privateRepo);

    await expect(
      setupPublicClone({
        privateRepo: fixture.privateRepo,
        publicRepoUrl: fixture.publicUrl,
        destination: fixture.destination,
      }),
    ).rejects.toMatchObject({ code: "DESTINATION_DIRTY" });

    expect(await remoteSnapshot(fixture.privateRepo)).toBe(remotesBefore);
    expect(await privateSnapshot(fixture.privateRepo)).toEqual(privateBefore);
  });

  it("fails on a wrong owner or repository URL before changing private remotes", async () => {
    const fixture = await createFixture();
    await clone(fixture.publicBare, fixture.destination);
    await git(
      fixture.destination,
      "remote",
      "set-url",
      "origin",
      "https://github.com/UtenKekkoDev/wrong-repository.git",
    );
    const remotesBefore = await remoteSnapshot(fixture.privateRepo);

    await expect(
      setupPublicClone({
        privateRepo: fixture.privateRepo,
        publicRepoUrl: "https://github.com/UtenKekkoDev/dom-native-pptx.git",
        destination: fixture.destination,
      }),
    ).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });

    expect(await remoteSnapshot(fixture.privateRepo)).toBe(remotesBefore);
  });

  it("preserves remotes with a matching fetch URL but a different push URL", async () => {
    const fixture = await createFixture();
    await git(
      fixture.privateRepo,
      "remote",
      "add",
      "fetch-only",
      fixture.publicUrl,
    );
    await git(
      fixture.privateRepo,
      "remote",
      "set-url",
      "--push",
      "fetch-only",
      path.join(fixture.root, "private-push.git"),
    );

    await setupPublicClone({
      privateRepo: fixture.privateRepo,
      publicRepoUrl: fixture.publicUrl,
      destination: fixture.destination,
    });

    expect(await git(fixture.privateRepo, "remote")).toContain("fetch-only");
    expect(
      await git(fixture.privateRepo, "remote", "get-url", "fetch-only"),
    ).toBe(fixture.publicUrl);
  });

  it("fails closed for credential-bearing public URLs without exposing credentials", async () => {
    const fixture = await createFixture();
    const unsafeUrl =
      "https://user:secret@example.invalid/UtenKekkoDev/dom-native-pptx.git?token=secret#fragment";
    let caught: unknown;
    try {
      await setupPublicClone({
        privateRepo: fixture.privateRepo,
        publicRepoUrl: unsafeUrl,
        destination: fixture.destination,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: "UNSAFE_PUBLIC_URL" });
    expect(JSON.stringify(caught)).not.toContain("secret");
    expect(await git(fixture.privateRepo, "remote")).toContain("publish");
  });
});
