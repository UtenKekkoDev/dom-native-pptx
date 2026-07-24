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

    expect(pkg.version).toBe("0.2.0-beta.1");
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
    expect(pkg.files).toEqual(expect.arrayContaining([
      "dist/**",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ]));
    expect(pkg.files).not.toEqual(expect.arrayContaining([
      "src/**",
      "tests/**",
      "docs/**",
      ".github/**",
      "examples/**",
    ]));
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
    expect(config.exclude).toEqual(expect.arrayContaining([
      "tests",
      "dist",
      "node_modules",
    ]));
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
