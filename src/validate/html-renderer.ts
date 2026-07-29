import fs from "node:fs/promises";
import path from "node:path";
import { openSlidePage } from "../browser/slide-page-session.js";
import type { SecurityMode } from "../types.js";

export interface HtmlRenderResult {
  input: string;
  outputDir: string;
  files: string[];
}

export interface HtmlRenderOptions {
  selector?: string;
  securityMode?: SecurityMode;
  timeoutMs?: number;
}

/** @deprecated Pass the selector through `HtmlRenderOptions` instead. */
export function renderHtmlSlides(
  inputPath: string,
  outputDir: string,
  selector: string,
): Promise<HtmlRenderResult>;
export function renderHtmlSlides(
  inputPath: string,
  outputDir: string,
  options?: HtmlRenderOptions,
): Promise<HtmlRenderResult>;
export async function renderHtmlSlides(
  inputPath: string,
  outputDir: string,
  optionsOrSelector: HtmlRenderOptions | string = {},
): Promise<HtmlRenderResult> {
  const options =
    typeof optionsOrSelector === "string"
      ? { selector: optionsOrSelector }
      : optionsOrSelector;
  const input = path.resolve(inputPath);
  const output = path.resolve(outputDir);
  const selector = options.selector ?? ".pptx-slide";
  await fs.mkdir(output, { recursive: true });
  const session = await openSlidePage({
    inputPath: input,
    securityMode: options.securityMode,
    timeoutMs: options.timeoutMs,
  });
  try {
    const { page } = session;
    const slides = page.locator(selector);
    const count = await slides.count();
    if (!count)
      throw new Error(`No ${selector} elements were found in ${input}`);

    const files: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const file = path.join(
        output,
        `slide-${String(index + 1).padStart(3, "0")}.png`,
      );
      const slide = slides.nth(index);
      const box = await slide.boundingBox();
      if (
        !box ||
        Math.round(box.width) !== 1920 ||
        Math.round(box.height) !== 1080
      ) {
        throw new Error(
          `Slide ${index + 1} is not 1920x1080: ${
            box ? `${box.width}x${box.height}` : "not visible"
          }`,
        );
      }
      await slide.screenshot({
        path: file,
        type: "png",
        animations: "disabled",
        caret: "hide",
        omitBackground: false,
      });
      files.push(file);
    }
    return { input, outputDir: output, files };
  } finally {
    await session.close();
  }
}
