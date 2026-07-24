import fs from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface VisualDiffResult {
  width: number;
  height: number;
  differentPixels: number;
  ratio: number;
}

export async function compareImages(
  expectedPath: string,
  actualPath: string,
  diffPath: string,
): Promise<VisualDiffResult> {
  const expected = PNG.sync.read(await fs.readFile(expectedPath));
  const actual = PNG.sync.read(await fs.readFile(actualPath));
  if (
    expected.width !== actual.width ||
    expected.height !== actual.height
  ) {
    throw new Error(
      `Image dimensions differ: expected ${expected.width}x${expected.height}, ` +
      `actual ${actual.width}x${actual.height}`,
    );
  }

  const diff = new PNG({
    width: expected.width,
    height: expected.height,
  });
  const differentPixels = pixelmatch(
    expected.data,
    actual.data,
    diff.data,
    expected.width,
    expected.height,
    {
      threshold: 0.15,
      includeAA: false,
      alpha: 0.55,
      diffColor: [214, 42, 84],
      aaColor: [242, 178, 76],
    },
  );
  await fs.mkdir(path.dirname(diffPath), { recursive: true });
  await fs.writeFile(diffPath, PNG.sync.write(diff));
  return {
    width: expected.width,
    height: expected.height,
    differentPixels,
    ratio: differentPixels / (expected.width * expected.height),
  };
}
