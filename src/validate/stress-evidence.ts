import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UndersizedTextBox } from "./text-box-measurement.js";

const reasons = new Set([
  "insufficient-height",
  "missing-measurement",
  "norm-autofit-risk",
]);

function isUndersizedTextBox(value: unknown): value is UndersizedTextBox {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Number.isInteger(candidate.slide) &&
    typeof candidate.shapeName === "string" &&
    ["widthEmu", "heightEmu", "fontSizePoints", "requiredHeightEmu"].every(
      (key) =>
        typeof candidate[key] === "number" && Number.isFinite(candidate[key]),
    ) &&
    typeof candidate.reason === "string" &&
    reasons.has(candidate.reason)
  );
}

export function requireTypographyEvidence(
  report: unknown,
): UndersizedTextBox[] {
  if (
    !report ||
    typeof report !== "object" ||
    !Array.isArray((report as Record<string, unknown>).undersizedTextBoxes)
  ) {
    throw new Error(
      "Validation report must include an undersizedTextBoxes array for typography evidence.",
    );
  }
  const evidence = (report as { undersizedTextBoxes: unknown[] })
    .undersizedTextBoxes;
  if (!evidence.every(isUndersizedTextBox)) {
    throw new Error(
      "Validation report contains invalid undersizedTextBoxes evidence.",
    );
  }
  return evidence;
}

async function runCli(): Promise<void> {
  const [validationPath] = process.argv.slice(2);
  if (!validationPath) {
    throw new Error(
      "Usage: tsx src/validate/stress-evidence.ts <validation.json>",
    );
  }
  const report = JSON.parse(
    await fs.readFile(path.resolve(validationPath), "utf8"),
  ) as unknown;
  process.stdout.write(
    JSON.stringify({
      undersizedTextBoxes: requireTypographyEvidence(report),
    }),
  );
}

const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPoint === path.resolve(fileURLToPath(import.meta.url))) {
  await runCli();
}
