import type { RectPx } from "../types.js";

export const PPTX_SLIDE = {
  width: 13.333,
  height: 7.5,
} as const;

export const HTML_CANVAS = {
  width: 1920,
  height: 1080,
} as const;

export interface RectInches {
  x: number;
  y: number;
  width: number;
  height: number;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function pxRectToInches(
  rect: RectPx,
  canvas: { width: number; height: number },
): RectInches {
  return {
    x: round(rect.x / canvas.width * PPTX_SLIDE.width),
    y: round(rect.y / canvas.height * PPTX_SLIDE.height),
    width: round(rect.width / canvas.width * PPTX_SLIDE.width),
    height: round(rect.height / canvas.height * PPTX_SLIDE.height),
  };
}

export function cssPixelsToPoints(value: string, fallback = 0): number {
  const pixels = Number.parseFloat(value);
  const pointsPerPixel =
    PPTX_SLIDE.width * 72 / HTML_CANVAS.width;
  return Number.isFinite(pixels)
    ? Number((pixels * pointsPerPixel).toFixed(2))
    : fallback;
}
