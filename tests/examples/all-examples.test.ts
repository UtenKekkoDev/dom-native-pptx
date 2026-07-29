import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportDeck } from "../../src/pipeline/export-deck.js";
import { inspectPptx } from "../../src/validate/pptx-xml.js";

const successfulExamples = [
  "01-basic-text",
  "02-chinese-typography",
  "03-flex-grid-cards",
  "04-native-table",
  "05-native-charts",
  "06-logo-and-photo",
  "07-brand-lockup-raster",
  "08-complex-text-effects",
  "10-full-business-deck",
];

describe("example decks", () => {
  for (const name of successfulExamples) {
    it(`exports and structurally validates ${name}`, async () => {
      const output = path.resolve(`.tmp/examples/${name}.pptx`);
      const result = await exportDeck({
        input: path.resolve(`examples/${name}/slides.html`),
        output,
      });
      const report = await inspectPptx(output, result.manifestPath);

      expect(report.ok).toBe(true);
      expect(report.missingProtectedText).toHaveLength(0);
      expect(report.unauthorizedRasterRecords).toHaveLength(0);
      expect(report.fullSlideRasterCount).toBe(0);
      expect((await fs.stat(output)).size).toBeGreaterThan(0);
    }, 60_000);
  }

  it("rejects the mandatory raster policy failure example", async () => {
    const output = path.resolve(".tmp/examples/09-raster-policy-failure.pptx");
    await fs.rm(output, { force: true });

    await expect(
      exportDeck({
        input: path.resolve("examples/09-raster-policy-failure/slides.html"),
        output,
      }),
    ).rejects.toThrow(/protected text/i);
    await expect(fs.stat(output)).rejects.toThrow();
  });
});
