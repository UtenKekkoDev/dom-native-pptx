import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotDeck } from "../../src/browser/dom-snapshot.js";
import { preflight } from "../../src/pipeline/preflight.js";

const SLIDES = [
  "pseudo-text",
  "canvas-unmarked",
  "protected-raster",
  "decorative-pseudo",
  "unmarked-gradient",
  "negative-z-index",
] as const;

async function preflightDeck(slideId: typeof SLIDES[number]): Promise<void> {
  const slides = await snapshotDeck(
    path.resolve("tests/fixtures/adversarial-effects.html"),
  );
  const index = SLIDES.indexOf(slideId);
  preflight([slides[index]]);
}

describe("adversarial effect policy", () => {
  it("rejects visible pseudo-element text that cannot become native", async () => {
    await expect(preflightDeck("pseudo-text")).rejects.toMatchObject({
      details: { code: "PSEUDO_TEXT_NOT_NATIVE" },
    });
  });

  it("rejects an unmarked visible canvas", async () => {
    await expect(preflightDeck("canvas-unmarked")).rejects.toMatchObject({
      details: { code: "CANVAS_REQUIRES_RASTER_POLICY" },
    });
  });

  it("keeps the existing protected-text raster rejection", async () => {
    await expect(preflightDeck("protected-raster")).rejects.toMatchObject({
      details: { code: "PROTECTED_TEXT_IN_RASTER" },
    });
  });

  it("allows an empty pseudo-element used only for decoration", async () => {
    await expect(preflightDeck("decorative-pseudo")).resolves.toBeUndefined();
  });

  it("rejects a complex visual that would otherwise disappear", async () => {
    await expect(preflightDeck("unmarked-gradient")).rejects.toMatchObject({
      details: { code: "UNSUPPORTED_VISUAL_REQUIRES_RASTER" },
    });
  });

  it("rejects negative z-index until CSS stacking contexts are supported", async () => {
    await expect(preflightDeck("negative-z-index")).rejects.toMatchObject({
      details: { code: "NEGATIVE_Z_INDEX_UNSUPPORTED" },
    });
  });
});
