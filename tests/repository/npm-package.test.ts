import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(read(relativePath)) as Record<string, unknown>;
}

function npmPackFileList(): string[] {
  const npmCli = process.env.npm_execpath;
  expect(
    npmCli,
    "npm_execpath must be available through npm scripts",
  ).toBeTruthy();
  const result = spawnSync(
    process.execPath,
    [npmCli ?? "", "pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: path.resolve("."), encoding: "utf8" },
  );
  expect(result.status, result.stderr || result.stdout).toBe(0);
  const report = JSON.parse(result.stdout) as Array<{
    files: Array<{ path: string }>;
  }>;
  return (report[0]?.files ?? []).map((entry) =>
    entry.path.replaceAll("\\", "/"),
  );
}

interface MarkdownLink {
  image: boolean;
  target: string;
}

function markdownLinks(markdown: string): MarkdownLink[] {
  return Array.from(
    markdown.matchAll(/(!?)\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu),
    (match) => ({ image: match[1] === "!", target: match[2] ?? "" }),
  );
}

function localPackageTarget(target: string): string | undefined {
  if (/^[a-z][a-z\d+.-]*:/iu.test(target) || target.startsWith("#")) {
    return undefined;
  }
  return target
    .split(/[?#]/u, 1)[0]
    ?.replace(/^\.\//u, "")
    .replace(/\\/gu, "/");
}

describe("npm package contract", () => {
  it("publishes the approved beta metadata and entry points", () => {
    const pkg = readJson("package.json") as {
      version?: string;
      private?: boolean;
      license?: string;
      author?: string;
      main?: string;
      types?: string;
      bin?: Record<string, string>;
      exports?: Record<string, unknown>;
      repository?: { type?: string; url?: string };
      bugs?: { url?: string };
      homepage?: string;
      engines?: { node?: string };
      files?: string[];
      publishConfig?: { access?: string; provenance?: boolean };
    };

    expect(pkg.version).toBe("0.2.0-beta.2");
    expect(pkg.private).not.toBe(true);
    expect(pkg.license).toBe("MIT");
    expect(pkg.author).toBe("Yuxuan Sun");
    expect(pkg.main).toBe("./dist/index.js");
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.bin?.["dom-native-pptx"]).toBe("./dist/cli.js");
    expect(pkg.exports?.["."]).toBeTruthy();
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/UtenKekkoDev/dom-native-pptx.git",
    });
    expect(pkg.bugs?.url).toBe(
      "https://github.com/UtenKekkoDev/dom-native-pptx/issues",
    );
    expect(pkg.homepage).toBe(
      "https://github.com/UtenKekkoDev/dom-native-pptx#readme",
    );
    expect(pkg.engines?.node).toBe(">=22");
    expect(pkg.publishConfig).toEqual({ access: "public", provenance: true });
    expect(pkg.files).toEqual([
      "dist/**",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "ARCHITECTURE.md",
      "RASTER_POLICY.md",
      "SECURITY.md",
      "SOURCE_MAP.md",
      "SUPPORTED_CSS.md",
    ]);
  });

  it("ships every relative README target and uses pinned public URLs for unpackaged images", () => {
    const packageFiles = npmPackFileList();
    const readme = read("README.md");
    const links = markdownLinks(readme);
    const relativeTargets = links
      .map((link) => localPackageTarget(link.target))
      .filter((target): target is string => Boolean(target));
    const imageTargets = links
      .filter((link) => link.image)
      .map((link) => link.target);

    expect(relativeTargets).toEqual(
      expect.arrayContaining(["SECURITY.md", "SOURCE_MAP.md"]),
    );
    expect(packageFiles).toEqual(expect.arrayContaining(relativeTargets));
    expect(imageTargets).toEqual([
      "https://raw.githubusercontent.com/UtenKekkoDev/dom-native-pptx/v0.2.0-beta.2/docs/assets/demo-html.png",
      "https://raw.githubusercontent.com/UtenKekkoDev/dom-native-pptx/v0.2.0-beta.2/docs/assets/demo-powerpoint.png",
    ]);
    expect(packageFiles.some((file) => file.startsWith("docs/assets/"))).toBe(
      false,
    );
    expect(readme).toContain("### English Agent prompt");
    expect(readme).toContain("### 中文 Agent 提示词");
    expect(readme).not.toMatch(/C:\\Users\\/iu);
  });

  it("builds only production source into the package root", () => {
    const config = readJson("tsconfig.build.json") as {
      compilerOptions?: { rootDir?: string; outDir?: string };
      include?: string[];
      exclude?: string[];
    };

    expect(config.compilerOptions?.rootDir).toBe("src");
    expect(config.compilerOptions?.outDir).toBe("dist");
    expect(config.include).toEqual(["src/**/*.ts"]);
    expect(config.exclude).toEqual(
      expect.arrayContaining(["tests", "dist", "node_modules"]),
    );
  });

  it("ships license notices and removes machine-specific Skill paths", () => {
    expect(read("LICENSE")).toContain("MIT License");
    expect(read("LICENSE")).toContain("Copyright (c) 2026 Yuxuan Sun");
    expect(read("THIRD_PARTY_NOTICES.md")).toContain("Third-Party Notices");
    expect(read("skills/dom-native-pptx/scripts/_runner.mjs")).not.toMatch(
      /C:\\Users\\ROG/i,
    );
  });

  it("declares portable CI on Windows, Linux, and macOS", () => {
    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("npm run test:package");
  });

  it("resolves every production dependency license", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/audit-licenses.mjs", "--json"],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as {
      productionPackages: number;
      unresolved: string[];
    };
    expect(report.productionPackages).toBeGreaterThan(0);
    expect(report.unresolved).toEqual([]);
  });
});
