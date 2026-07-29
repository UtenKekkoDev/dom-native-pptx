import type { DomNodeSnapshot, RasterDecision } from "../types.js";
import type { ConversionManifest } from "../pipeline/manifest.js";
import { HTML_CANVAS, pxRectToInches } from "./unit-converter.js";

export interface ImageSlideTarget {
  addImage(options: Record<string, unknown>): unknown;
}

export function addImageAsset(
  slide: ImageSlideTarget,
  node: DomNodeSnapshot,
  sourcePath: string,
  decision: RasterDecision,
  manifest: ConversionManifest,
): void {
  const rect = pxRectToInches(node.rect, HTML_CANVAS);
  slide.addImage({
    path: sourcePath,
    x: rect.x,
    y: rect.y,
    w: rect.width,
    h: rect.height,
  });
  manifest.add({
    slide: node.slide,
    selector: node.selector,
    domType: node.tagName,
    semanticRole: decision.role,
    text: node.text,
    pptxOutputType: "image",
    pptxObjectId: `slide-${node.slide}-image-${manifest.records.length + 1}`,
    rasterized: true,
    rasterAuthorized: true,
    rasterReason: decision.reason,
    outputAsset: sourcePath,
    warnings: [],
  });
}
