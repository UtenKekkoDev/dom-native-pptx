import type { Page } from "playwright";

export async function waitForAssets(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = Array.from(document.images);
    await Promise.all(
      images.map((image) => {
        if (image.complete) {
          if (image.naturalWidth > 0) return Promise.resolve();
          return Promise.reject(
            new Error(`Image failed to load: ${image.currentSrc || image.src}`),
          );
        }
        return new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener(
            "error",
            () =>
              reject(
                new Error(
                  `Image failed to load: ${image.currentSrc || image.src}`,
                ),
              ),
            { once: true },
          );
        });
      }),
    );
  });
  await page.waitForLoadState("networkidle");
}
