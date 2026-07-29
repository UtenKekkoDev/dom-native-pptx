import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");
const evidenceCli = path.resolve("src/validate/stress-evidence.ts");

describe("stress typography evidence boundary", () => {
  it.each([
    ["missing", { ok: true }],
    ["null", { undersizedTextBoxes: null }],
  ])("rejects %s typography evidence", async (_name, report) => {
    const result = await runEvidenceCli(report);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/undersizedTextBoxes/i);
  });

  it.each([
    ["empty", { undersizedTextBoxes: [] }, []],
    [
      "non-empty",
      {
        undersizedTextBoxes: [
          {
            slide: 1,
            shapeName: "Text 1",
            widthEmu: 100,
            heightEmu: 100,
            fontSizePoints: 32,
            requiredHeightEmu: 406400,
            reason: "insufficient-height",
          },
        ],
      },
      [
        {
          slide: 1,
          shapeName: "Text 1",
          widthEmu: 100,
          heightEmu: 100,
          fontSizePoints: 32,
          requiredHeightEmu: 406400,
          reason: "insufficient-height",
        },
      ],
    ],
  ])("preserves %s typography evidence", async (_name, report, expected) => {
    const result = await runEvidenceCli(report);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      undersizedTextBoxes: expected,
    });
  });
});

async function runEvidenceCli(report: unknown): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "stress-evidence-"),
  );
  const reportPath = path.join(directory, "validation.json");
  await fs.writeFile(reportPath, JSON.stringify(report), "utf8");

  try {
    const result = spawnSync(
      process.execPath,
      [tsxCli, evidenceCli, reportPath],
      {
        encoding: "utf8",
      },
    );
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
