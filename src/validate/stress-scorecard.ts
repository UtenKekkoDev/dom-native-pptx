import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type GateStatus = "pass" | "fail" | "unavailable";
export type StressStatus =
  | "pass"
  | "pass-with-visual-differences"
  | "incomplete"
  | "fail";

export interface StressSlideEvidence {
  slide: number;
  diffRatio: number;
  missingText: number;
  layerFailures: number;
  typographyFailures: number;
}

export interface StressEvidence {
  structuralOk: boolean;
  unauthorizedRasterCount: number;
  fullSlideRasterCount: number;
  undersizedTextBoxCount: number;
  powerpointAvailable: boolean;
  powerpointOpenOk: boolean;
  slides: StressSlideEvidence[];
}

export interface StressScorecard {
  status: StressStatus;
  structural: GateStatus;
  editability: GateStatus;
  rasterPolicy: GateStatus;
  typography: GateStatus;
  layerOrder: GateStatus;
  authoritativeRender: GateStatus;
  visualDiffIsDiagnosticOnly: true;
  slides: StressSlideEvidence[];
}

function passWhen(condition: boolean): GateStatus {
  return condition ? "pass" : "fail";
}

export function buildStressScorecard(
  evidence: StressEvidence,
): StressScorecard {
  const missingText = evidence.slides.reduce(
    (total, slide) => total + slide.missingText,
    0,
  );
  const layerFailures = evidence.slides.reduce(
    (total, slide) => total + slide.layerFailures,
    0,
  );
  const typographyFailures = evidence.undersizedTextBoxCount +
    evidence.slides.reduce(
      (total, slide) => total + slide.typographyFailures,
      0,
    );

  const structural = passWhen(evidence.structuralOk);
  const editability = passWhen(missingText === 0);
  const rasterPolicy = passWhen(
    evidence.unauthorizedRasterCount === 0 &&
    evidence.fullSlideRasterCount === 0,
  );
  const typography = passWhen(typographyFailures === 0);
  const layerOrder = passWhen(layerFailures === 0);
  const authoritativeRender: GateStatus = !evidence.powerpointAvailable
    ? "unavailable"
    : passWhen(evidence.powerpointOpenOk);

  const hardFailure = [
    structural,
    editability,
    rasterPolicy,
    typography,
    layerOrder,
    authoritativeRender,
  ].includes("fail");
  const hasVisualDifferences = evidence.slides.some(
    (slide) => slide.diffRatio > 0,
  );
  const status: StressStatus = hardFailure
    ? "fail"
    : authoritativeRender === "unavailable"
      ? "incomplete"
      : hasVisualDifferences
        ? "pass-with-visual-differences"
        : "pass";

  return {
    status,
    structural,
    editability,
    rasterPolicy,
    typography,
    layerOrder,
    authoritativeRender,
    visualDiffIsDiagnosticOnly: true,
    slides: evidence.slides,
  };
}

async function writeFromCli(): Promise<void> {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error(
      "Usage: tsx src/validate/stress-scorecard.ts <evidence.json> <scorecard.json>",
    );
  }
  const evidence = JSON.parse(
    await fs.readFile(path.resolve(input), "utf8"),
  ) as StressEvidence;
  const destination = path.resolve(output);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(
    destination,
    JSON.stringify(buildStressScorecard(evidence), null, 2),
    "utf8",
  );
}

const entryPoint = process.argv[1]
  ? path.resolve(process.argv[1])
  : "";
if (entryPoint === path.resolve(fileURLToPath(import.meta.url))) {
  await writeFromCli();
}
