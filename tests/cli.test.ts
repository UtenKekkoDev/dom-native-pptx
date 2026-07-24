import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("CLI", () => {
  it("accepts an output path as a positional fallback for npm on Windows", async () => {
    const output = path.resolve(".tmp/tests/cli-positional.pptx");
    await fs.rm(output, { force: true });
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "export",
        "tests/fixtures/basic-slide.html",
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      output,
    });
    expect((await fs.stat(output)).size).toBeGreaterThan(0);
  });
});
