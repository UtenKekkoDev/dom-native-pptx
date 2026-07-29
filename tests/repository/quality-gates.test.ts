import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import vitestConfig from "../../vitest.config";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function workflowSteps(workflow: string): string[] {
  return workflow
    .split(/(?=^[ \t]{6}-\s)/mu)
    .filter((block) => /^[ \t]{6}-\s/mu.test(block));
}

function runCommand(step: string): string | undefined {
  return /^[ \t]*(?:-[ \t]+)?run:[ \t]+([^\r\n]*\S)[ \t]*$/mu.exec(step)?.[1];
}

function usedAction(step: string): string | undefined {
  return /^[ \t]*(?:-[ \t]+)?uses:[ \t]+(\S+)[ \t]*$/mu.exec(step)?.[1];
}

function ignoresDirectory(patterns: string[], directory: string): boolean {
  const normalizedDirectory = directory.replace(/^\./u, "");
  return patterns.some((pattern) => {
    const normalizedPattern = pattern
      .replaceAll("\\", "/")
      .replace(/^\.\//u, "")
      .replace(/^\*\*\//u, "")
      .replace(/\/(?:\*\*)?$/u, "")
      .replace(/^\./u, "");
    return normalizedPattern === normalizedDirectory;
  });
}

describe("repository quality gates", () => {
  it("pins source and configuration files to LF across Windows checkouts", () => {
    const attributesPath = path.resolve(".gitattributes");
    expect(fs.existsSync(attributesPath), ".gitattributes must exist").toBe(
      true,
    );
    const attributes = read(".gitattributes");
    for (const pattern of ["*.mjs", "*.js", "*.ts", "*.json", "*.yml"]) {
      expect(attributes).toContain(`${pattern} text eol=lf`);
    }
  });

  it("removes the unused libraries from the runtime graph and lockfile", () => {
    const pkg = readJson<{ dependencies?: Record<string, string> }>(
      "package.json",
    );
    const lock = readJson<{
      packages?: Record<
        string,
        { dependencies?: Record<string, string> } | undefined
      >;
    }>("package-lock.json");

    for (const name of ["dom-to-pptx", "fontkit", "fast-xml-parser"]) {
      expect(pkg.dependencies).not.toHaveProperty(name);
      expect(lock.packages?.[""]?.dependencies).not.toHaveProperty(name);
      expect(lock.packages).not.toHaveProperty(`node_modules/${name}`);
    }
  });

  it("defines executable lint, format, coverage, and license scripts", () => {
    const pkg = readJson<{ scripts?: Record<string, string> }>("package.json");

    expect(pkg.scripts).toMatchObject({
      lint: "eslint src tests scripts",
      "format:check":
        "prettier --check src tests scripts .github *.md *.json *.ts *.js",
      "test:run": "vitest run --pool=forks --maxWorkers=1 --bail=1",
      "test:coverage":
        "vitest run --coverage --pool=forks --maxWorkers=1 --bail=1",
      "audit:licenses": "node scripts/audit-licenses.mjs",
    });
  });

  it("loads a flat TypeScript ESLint config with Node globals and output ignores", async () => {
    const configPath = path.resolve("eslint.config.js");
    expect(fs.existsSync(configPath), "eslint.config.js must exist").toBe(true);

    const imported = (await import(pathToFileURL(configPath).href)) as {
      default?: FlatConfig | FlatConfig[];
    };
    const configs = Array.isArray(imported.default)
      ? imported.default
      : [imported.default];
    const definedConfigs = configs.filter(
      (config): config is FlatConfig => config !== undefined,
    );
    const ignores = definedConfigs.flatMap((config) => config.ignores ?? []);
    const globals = Object.assign(
      {},
      ...definedConfigs.map((config) => config.languageOptions?.globals ?? {}),
    ) as Record<string, unknown>;
    const ruleNames = definedConfigs.flatMap((config) =>
      Object.keys(config.rules ?? {}),
    );

    expect(
      ruleNames.some((rule) => rule.startsWith("@typescript-eslint/")),
    ).toBe(true);
    expect(globals).toHaveProperty("process");
    expect(globals).toHaveProperty("Buffer");
    for (const directory of ["dist", ".tmp", "outputs", "coverage"]) {
      expect(ignoresDirectory(ignores, directory), directory).toBe(true);
    }
  });

  it("keeps generated output out of Prettier and configures V8 coverage", () => {
    const prettierIgnorePath = path.resolve(".prettierignore");
    expect(
      fs.existsSync(prettierIgnorePath),
      ".prettierignore must exist",
    ).toBe(true);
    const prettierIgnores = read(".prettierignore")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    for (const directory of ["dist", ".tmp", "outputs", "coverage"]) {
      expect(ignoresDirectory(prettierIgnores, directory), directory).toBe(
        true,
      );
    }

    expect(
      typeof vitestConfig === "object" && vitestConfig !== null
        ? vitestConfig.test?.coverage
        : undefined,
    ).toMatchObject({ provider: "v8" });
  });

  it("runs every gate in CI while preserving the three operating systems", () => {
    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toMatch(/^\s*timeout-minutes:\s*30\s*$/mu);
    const matrix =
      /\bmatrix:\s*\r?\n\s+os:\s*\r?\n((?:\s+-\s+[^\r\n]+\r?\n?)+)/u.exec(
        workflow,
      )?.[1];
    expect(matrix, "CI must define an operating-system matrix").toBeDefined();
    const operatingSystems = Array.from(
      matrix?.matchAll(/^\s+-\s+([^\s#]+)\s*$/gmu) ?? [],
      (match) => match[1],
    );
    expect(operatingSystems).toEqual([
      "windows-latest",
      "ubuntu-latest",
      "macos-latest",
    ]);

    const steps = workflowSteps(workflow);
    const commands = steps.map(runCommand).filter(Boolean);
    expect(commands).toEqual(
      expect.arrayContaining([
        "npm run build",
        "npm run lint",
        "npm run format:check",
        "npm run audit:licenses",
        "npm run test:run",
        "npm run test:package",
        "npm run test:coverage",
      ]),
    );

    const uses = steps.map(usedAction).filter(Boolean);
    expect(uses).toEqual(
      expect.arrayContaining([
        "actions/checkout@v7",
        "actions/setup-node@v7",
        "actions/upload-artifact@v7",
      ]),
    );

    const coverageSteps = steps.filter(
      (step) => runCommand(step) === "npm run test:coverage",
    );
    const conversionSteps = steps.filter(
      (step) => runCommand(step) === "npm run test:run",
    );
    expect(conversionSteps).toHaveLength(1);
    expect(coverageSteps).toHaveLength(1);
    expect(conversionSteps[0]).toMatch(
      /^\s*(?:-\s+)?if:\s*runner\.os\s*!=\s*['"]Linux['"]\s*$/mu,
    );
    expect(coverageSteps[0]).toMatch(
      /^\s*(?:-\s+)?if:\s*runner\.os\s*==\s*['"]Linux['"]\s*$/mu,
    );

    const uploadSteps = steps.filter(
      (step) => usedAction(step) === "actions/upload-artifact@v7",
    );
    expect(uploadSteps).toHaveLength(1);
    const uploadIndex = steps.indexOf(uploadSteps[0] ?? "");
    const coverageCommandIndex = steps.indexOf(coverageSteps[0] ?? "");
    expect(uploadIndex).toBeGreaterThan(coverageCommandIndex);

    const uploadStep = uploadSteps[0] ?? "";
    expect(uploadStep).toMatch(
      /^[ \t]*(?:-[ \t]+)?if:[ \t]*(?:runner\.os[ \t]*==[ \t]*['"]Linux['"]|matrix\.os[ \t]*==[ \t]*['"]ubuntu-latest['"])[ \t]*$/mu,
    );
    expect(uploadStep).toMatch(/^\s*path:\s*coverage\/?\s*$/mu);
  });
});

interface FlatConfig {
  ignores?: string[];
  languageOptions?: { globals?: Record<string, unknown> };
  rules?: Record<string, unknown>;
}
