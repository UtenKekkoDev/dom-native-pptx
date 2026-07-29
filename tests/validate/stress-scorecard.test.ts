import { describe, expect, it } from "vitest";
import { buildStressScorecard } from "../../src/validate/stress-scorecard.js";

describe("stress scorecard", () => {
  it("keeps visual differences diagnostic when structural gates pass", () => {
    expect(
      buildStressScorecard({
        structuralOk: true,
        unauthorizedRasterCount: 0,
        fullSlideRasterCount: 0,
        undersizedTextBoxCount: 0,
        powerpointAvailable: true,
        powerpointOpenOk: true,
        slides: [
          {
            slide: 1,
            diffRatio: 0.12,
            missingText: 0,
            layerFailures: 0,
            typographyFailures: 0,
          },
        ],
      }),
    ).toMatchObject({
      status: "pass-with-visual-differences",
      structural: "pass",
      editability: "pass",
      rasterPolicy: "pass",
      typography: "pass",
      layerOrder: "pass",
      authoritativeRender: "pass",
    });
  });

  it("fails when structural or semantic gates fail", () => {
    expect(
      buildStressScorecard({
        structuralOk: false,
        unauthorizedRasterCount: 1,
        fullSlideRasterCount: 0,
        undersizedTextBoxCount: 0,
        powerpointAvailable: true,
        powerpointOpenOk: true,
        slides: [
          {
            slide: 1,
            diffRatio: 0,
            missingText: 1,
            layerFailures: 0,
            typographyFailures: 0,
          },
        ],
      }),
    ).toMatchObject({
      status: "fail",
      structural: "fail",
      editability: "fail",
      rasterPolicy: "fail",
    });
  });

  it("reports incomplete validation when PowerPoint is unavailable", () => {
    expect(
      buildStressScorecard({
        structuralOk: true,
        unauthorizedRasterCount: 0,
        fullSlideRasterCount: 0,
        undersizedTextBoxCount: 0,
        powerpointAvailable: false,
        powerpointOpenOk: false,
        slides: [],
      }),
    ).toMatchObject({
      status: "incomplete",
      authoritativeRender: "unavailable",
    });
  });

  it("fails visible layer and typography defects independently", () => {
    expect(
      buildStressScorecard({
        structuralOk: true,
        unauthorizedRasterCount: 0,
        fullSlideRasterCount: 0,
        undersizedTextBoxCount: 1,
        powerpointAvailable: true,
        powerpointOpenOk: true,
        slides: [
          {
            slide: 2,
            diffRatio: 0.01,
            missingText: 0,
            layerFailures: 1,
            typographyFailures: 1,
          },
        ],
      }),
    ).toMatchObject({
      status: "fail",
      typography: "fail",
      layerOrder: "fail",
    });
  });
});
