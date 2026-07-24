import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser } from "../browser/launch-browser.js";
import { waitForAssets } from "../browser/wait-for-assets.js";

export interface HtmlRenderResult {
  input: string;
  outputDir: string;
  files: string[];
}

export async function renderHtmlSlides(
  inputPath: string,
  outputDir: string,
  selector = ".pptx-slide",
): Promise<HtmlRenderResult> {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputDir);
  await fs.mkdir(output, { recursive: true });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(input).href, { waitUntil: "load" });
    await waitForAssets(page);
    const slides = page.locator(selector);
    const count = await slides.count();
    if (!count) throw new Error(`No ${selector} elements were found in ${input}`);

    const files: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const file = path.join(
        output,
        `slide-${String(index + 1).padStart(3, "0")}.png`,
      );
      const slide = slides.nth(index);
      const box = await slide.boundingBox();
      if (!box || Math.round(box.width) !== 1920 || Math.round(box.height) !== 1080) {
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
    await browser.close();
  }
}
