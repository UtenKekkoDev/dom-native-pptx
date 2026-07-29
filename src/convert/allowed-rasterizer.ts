import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import sharp from "sharp";
import { evaluateRasterPolicy } from "../policy/raster-policy.js";
import type { DomNodeSnapshot, RasterDecision } from "../types.js";

export interface RasterPageTarget {
  locator(selector: string): {
    screenshot(options: {
      path: string;
      omitBackground: boolean;
      animations?: "disabled";
    }): Promise<unknown>;
  };
}

export async function setRasterCaptureBackground(
  page: Page,
  transparent: boolean,
): Promise<void> {
  await page.evaluate((enable) => {
    type CaptureWindow = Window & {
      __domNativePptxRasterBackgrounds?: Array<[HTMLElement, string | null]>;
    };
    const captureWindow = window as CaptureWindow;
    if (enable) {
      if (captureWindow.__domNativePptxRasterBackgrounds) return;
      const elements = [
        document.documentElement,
        document.body,
        ...Array.from(document.querySelectorAll<HTMLElement>(".pptx-slide")),
      ];
      captureWindow.__domNativePptxRasterBackgrounds = elements.map(
        (element) => [element, element.getAttribute("style")],
      );
      for (const element of elements) {
        element.style.setProperty("background", "transparent", "important");
      }
      return;
    }

    for (const [
      element,
      originalStyle,
    ] of captureWindow.__domNativePptxRasterBackgrounds ?? []) {
      if (originalStyle === null) element.removeAttribute("style");
      else element.setAttribute("style", originalStyle);
    }
    delete captureWindow.__domNativePptxRasterBackgrounds;
  }, transparent);
}

export async function setRasterCaptureIsolation(
  page: Page,
  slideIndex: number,
  selector: string,
  isolate: boolean,
): Promise<void> {
  await page.evaluate(
    ({ index, targetSelector, enable }) => {
      type StyledElement = Element & { style: CSSStyleDeclaration };
      type CaptureWindow = Window & {
        __domNativePptxRasterIsolation?: Array<[StyledElement, string | null]>;
      };
      const captureWindow = window as CaptureWindow;
      if (enable) {
        if (captureWindow.__domNativePptxRasterIsolation) {
          throw new Error("Raster isolation is already active");
        }
        const slide =
          document.querySelectorAll<HTMLElement>(".pptx-slide")[index];
        const target = slide?.querySelector(
          targetSelector,
        ) as StyledElement | null;
        if (!slide || !target) {
          throw new Error(
            `Raster isolation target not found: slide=${index + 1}; selector=${targetSelector}`,
          );
        }

        const elements = [
          slide as StyledElement,
          ...(Array.from(slide.querySelectorAll("*")) as StyledElement[]),
        ];
        captureWindow.__domNativePptxRasterIsolation = elements.map(
          (element) => [element, element.getAttribute("style")],
        );
        for (const element of elements) {
          element.style.setProperty("visibility", "hidden", "important");
        }

        const visible = new Set<StyledElement>([
          target,
          ...(Array.from(target.querySelectorAll("*")) as StyledElement[]),
        ]);
        let ancestor = target.parentElement as StyledElement | null;
        while (ancestor) {
          visible.add(ancestor);
          if (ancestor === slide) break;
          ancestor = ancestor.parentElement as StyledElement | null;
        }
        for (const element of visible) {
          element.style.setProperty("visibility", "visible", "important");
        }
        return;
      }

      for (const [
        element,
        originalStyle,
      ] of captureWindow.__domNativePptxRasterIsolation ?? []) {
        if (originalStyle === null) element.removeAttribute("style");
        else element.setAttribute("style", originalStyle);
      }
      delete captureWindow.__domNativePptxRasterIsolation;
    },
    { index: slideIndex, targetSelector: selector, enable: isolate },
  );
}

export function assertRasterCaptureAllowed(
  node: DomNodeSnapshot,
): RasterDecision {
  return evaluateRasterPolicy(node);
}

function safeAssetName(node: DomNodeSnapshot): string {
  const raw = node.id || node.selector || "asset";
  const normalized = raw
    .replace(/^#/u, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "asset";
}

async function removeLowAlphaBackdrop(
  inputPath: string,
  alphaCutoff = 48,
): Promise<void> {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let changed = false;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > alphaCutoff) continue;
    if (data[index] !== 0) changed = true;
    data[index] = 0;
  }
  if (!changed) return;

  const temporaryPath = `${inputPath}.normalized.png`;
  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toFile(temporaryPath);
  await fs.rm(inputPath, { force: true });
  await fs.rename(temporaryPath, inputPath);
}

export async function captureAuthorizedRaster(
  page: RasterPageTarget,
  node: DomNodeSnapshot,
  outputDir: string,
): Promise<{ decision: RasterDecision; outputAsset: string }> {
  const decision = assertRasterCaptureAllowed(node);
  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `slide-${node.slide}-${safeAssetName(node)}.png`;
  const outputAsset = path.join(outputDir, fileName);
  await page.locator(node.selector).screenshot({
    path: outputAsset,
    omitBackground: true,
    animations: "disabled",
  });
  await removeLowAlphaBackdrop(outputAsset);
  return { decision, outputAsset };
}
