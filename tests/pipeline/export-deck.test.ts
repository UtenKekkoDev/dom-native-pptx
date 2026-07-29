import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { exportDeck } from "../../src/pipeline/export-deck.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("deck export pipeline", () => {
  it("exports protected content as native text and writes a manifest", async () => {
    const output = path.resolve(".tmp/tests/basic.pptx");
    const result = await exportDeck({
      input: path.resolve("tests/fixtures/basic-slide.html"),
      output,
    });

    expect((await fs.stat(output)).size).toBeGreaterThan(0);
    expect((await fs.stat(result.manifestPath)).size).toBeGreaterThan(0);
    const manifest = JSON.parse(
      await fs.readFile(result.manifestPath, "utf8"),
    ) as unknown;
    const validation = JSON.parse(
      await fs.readFile(result.validationJsonPath, "utf8"),
    ) as unknown;
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      securityMode: "safe",
    });
    expect(validation).toMatchObject({ securityMode: "safe" });
    expect(result.manifest.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: "#title",
          text: "原生标题",
          pptxOutputType: "native-text",
          rasterized: false,
        }),
        expect.objectContaining({
          selector: "#body",
          text: "正文必须保持为 PowerPoint 原生文本框。",
          pptxOutputType: "native-text",
          rasterized: false,
        }),
      ]),
    );
    expect(
      result.manifest.records.some(
        (record) => record.rasterized && !record.rasterAuthorized,
      ),
    ).toBe(false);
  });

  it("fails before writing a deck when a raster container includes body text", async () => {
    const output = path.resolve(".tmp/tests/forbidden-raster.pptx");
    await fs.rm(output, { force: true });

    await expect(
      exportDeck({
        input: path.resolve("tests/fixtures/forbidden-raster.html"),
        output,
      }),
    ).rejects.toThrow(/protected text.*p.*这段正文绝对不能转换成图片/u);
    await expect(fs.stat(output)).rejects.toThrow();
  });

  it("exports scripted content without executing JavaScript by default", async () => {
    const output = path.resolve(".tmp/tests/scripted-safe.pptx");
    const result = await exportDeck({
      input: path.resolve("tests/fixtures/security/scripted-slide.html"),
      output,
    });

    expect(result.manifest.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: "#mode",
          text: "SAFE",
          pptxOutputType: "native-text",
          rasterized: false,
        }),
      ]),
    );
  });

  it("exports trusted scripted content as native text", async () => {
    const output = path.resolve(".tmp/tests/scripted-trusted.pptx");
    const result = await exportDeck({
      input: path.resolve("tests/fixtures/security/scripted-slide.html"),
      output,
      securityMode: "trusted",
    });

    expect(result.manifest.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: "#mode",
          text: "TRUSTED",
          pptxOutputType: "native-text",
          rasterized: false,
        }),
      ]),
    );
    expect(
      JSON.parse(await fs.readFile(result.manifestPath, "utf8")),
    ).toMatchObject({ schemaVersion: 2, securityMode: "trusted" });
    expect(
      JSON.parse(await fs.readFile(result.validationJsonPath, "utf8")),
    ).toMatchObject({ securityMode: "trusted" });
  });

  it("uses trusted mode for the raster capture phase", async () => {
    const output = path.resolve(".tmp/tests/scripted-raster-trusted.pptx");
    const result = await exportDeck({
      input: path.resolve("tests/fixtures/security/scripted-raster.html"),
      output,
      securityMode: "trusted",
      timeoutMs: 5_000,
    });
    const raster = result.manifest.records.find(
      (record) => record.selector === "#scripted-raster",
    );

    expect(raster).toMatchObject({
      rasterized: true,
      rasterAuthorized: true,
      pptxOutputType: "image",
    });
    const { data, info } = await sharp(raster!.outputAsset!)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const center =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) *
      4;
    expect(Array.from(data.subarray(center, center + 4))).toEqual([
      0, 255, 0, 255,
    ]);
  });

  it("applies the configured timeout to the raster capture phase", async () => {
    await withSecondImageRequestDelayed(async (inputPath, requestCount) => {
      const outcome = await exportDeck({
        input: inputPath,
        output: path.resolve(".tmp/tests/raster-timeout.pptx"),
        securityMode: "trusted",
        timeoutMs: 1_500,
      }).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );

      expect("error" in outcome ? outcome.error : undefined).toMatchObject({
        message: expect.stringMatching(/timeout 1500ms exceeded/iu),
      });
      expect(requestCount()).toBe(2);
    });
  }, 15_000);
});

async function withSecondImageRequestDelayed(
  run: (inputPath: string, requestCount: () => number) => Promise<void>,
): Promise<void> {
  let count = 0;
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const respondWithImage = (response: http.ServerResponse): void => {
    if (response.destroyed) return;
    response.writeHead(200, { "content-type": "image/png" });
    response.end(ONE_PIXEL_PNG);
  };
  const server = http.createServer((_request, response) => {
    count += 1;
    if (count === 1) {
      respondWithImage(response);
      return;
    }
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      respondWithImage(response);
    }, 4_000);
    pendingTimers.add(timer);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "raster-timeout-"));
  const inputPath = path.join(directory, "slides.html");
  await fs.writeFile(
    inputPath,
    `<!doctype html><html><body style="margin:0">
      <section class="pptx-slide" style="position:relative;width:1920px;height:1080px">
        <div id="delayed-raster" data-pptx-raster="allowed"
          data-pptx-raster-role="photo" style="width:200px;height:200px">
          <img src="http://127.0.0.1:${port}/image.png" style="width:200px;height:200px">
        </div>
      </section>
    </body></html>`,
    "utf8",
  );

  try {
    await run(inputPath, () => count);
  } finally {
    for (const timer of pendingTimers) clearTimeout(timer);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    await fs.rm(directory, { recursive: true, force: true });
  }
}
