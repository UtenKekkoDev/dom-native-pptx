import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { snapshotDeck } from "../../src/browser/dom-snapshot.js";
import { launchBrowser } from "../../src/browser/launch-browser.js";
import { waitForAssets } from "../../src/browser/wait-for-assets.js";
import {
  captureAuthorizedRaster,
  setRasterCaptureBackground,
  setRasterCaptureIsolation,
} from "../../src/convert/allowed-rasterizer.js";
import type { DomNodeSnapshot } from "../../src/types.js";

function flatten(nodes: DomNodeSnapshot[]): DomNodeSnapshot[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe("authorized raster transparency", () => {
  it("does not bake the HTML slide background into transparent corners", async () => {
    const input = path.resolve("tests/fixtures/complex-effects-stress.html");
    const snapshots = await snapshotDeck(input);
    const node = flatten(snapshots[7]).find(
      (candidate) => candidate.id === "authorized-composite",
    );
    expect(node).toBeDefined();

    const browser = await launchBrowser();
    const outputDir = path.resolve(".tmp/tests/raster-transparency");
    try {
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });
      await page.goto(pathToFileURL(input).href, { waitUntil: "load" });
      await waitForAssets(page);
      await setRasterCaptureBackground(page, true);
      const slideScope = page.locator(".pptx-slide").nth(7);
      const capture = await captureAuthorizedRaster(
        { locator: (selector) => slideScope.locator(selector) },
        node!,
        outputDir,
      );
      await setRasterCaptureBackground(page, false);

      const { data, info } = await sharp(capture.outputAsset)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const cornerAlpha = [
        data[3],
        data[(info.width - 1) * 4 + 3],
        data[((info.height - 1) * info.width) * 4 + 3],
        data[((info.height * info.width) - 1) * 4 + 3],
      ];
      expect(cornerAlpha).toEqual([0, 0, 0, 0]);
    } finally {
      await browser.close();
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not capture overlapping sibling text into an image asset", async () => {
    const input = path.resolve("tests/fixtures/complex-effects-stress.html");
    const snapshots = await snapshotDeck(input);
    const node = flatten(snapshots[3]).find(
      (candidate) => candidate.id === "stack-image",
    );
    expect(node).toBeDefined();

    const browser = await launchBrowser();
    const outputDir = path.resolve(".tmp/tests/raster-isolation");
    try {
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });
      await page.goto(pathToFileURL(input).href, { waitUntil: "load" });
      await waitForAssets(page);
      await setRasterCaptureBackground(page, true);
      await setRasterCaptureIsolation(page, 3, node!.selector, true);
      const slideScope = page.locator(".pptx-slide").nth(3);
      const capture = await captureAuthorizedRaster(
        { locator: (selector) => slideScope.locator(selector) },
        node!,
        outputDir,
      );
      await setRasterCaptureIsolation(page, 3, node!.selector, false);
      await setRasterCaptureBackground(page, false);

      const { data, info } = await sharp(capture.outputAsset)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const x = Math.floor(info.width / 2);
      const y = Math.min(info.height - 1, 418);
      const index = (y * info.width + x) * 3;
      const rgbSum = data[index] + data[index + 1] + data[index + 2];
      expect(rgbSum).toBeLessThan(600);
    } finally {
      await browser.close();
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 30_000);
});
