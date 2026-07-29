import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { openSlidePage } from "../../src/browser/slide-page-session.js";
import type { SecurityMode } from "../../src/types.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("slide page session", () => {
  it("does not execute JavaScript in safe mode", async () => {
    const session = await openSlidePage({
      inputPath: path.resolve("tests/fixtures/security/scripted-slide.html"),
    });
    try {
      expect(await session.page.locator("#mode").textContent()).toBe("SAFE");
    } finally {
      await session.close();
    }
  });

  it("executes JavaScript only in trusted mode", async () => {
    const session = await openSlidePage({
      inputPath: path.resolve("tests/fixtures/security/scripted-slide.html"),
      securityMode: "trusted",
    });
    try {
      expect(await session.page.locator("#mode").textContent()).toBe("TRUSTED");
    } finally {
      await session.close();
    }
  });

  it("rejects remote resources in safe mode with the policy error", async () => {
    await withRemoteImageFixture(async (inputPath) => {
      await expect(openSlidePage({ inputPath })).rejects.toMatchObject({
        name: "SecurityPolicyError",
        details: { code: "SECURITY_REMOTE_RESOURCE_BLOCKED" },
      });
    });
  });

  it("loads remote resources in trusted mode", async () => {
    await withRemoteImageFixture(async (inputPath, getRequestCount) => {
      const session = await openSlidePage({
        inputPath,
        securityMode: "trusted",
      });
      try {
        expect(
          await session.page
            .locator("#remote")
            .evaluate((image) => (image as HTMLImageElement).naturalWidth),
        ).toBe(1);
        expect(getRequestCount()).toBe(1);
      } finally {
        await session.close();
      }
    });
  });

  it.each<SecurityMode>(["safe", "trusted"])(
    "closes popups in %s mode",
    async (securityMode) => {
      await withInteractionFixture(async (inputPath) => {
        const session = await openSlidePage({ inputPath, securityMode });
        try {
          const popupPromise = session.page.waitForEvent("popup");
          await session.page.locator("#popup").click();
          const popup = await popupPromise;
          await expect.poll(() => popup.isClosed()).toBe(true);
          expect(session.context.pages()).toEqual([session.page]);
        } finally {
          await session.close();
        }
      });
    },
  );

  it.each<SecurityMode>(["safe", "trusted"])(
    "rejects subframe documents in %s mode",
    async (securityMode) => {
      await withIframeFixture(async (inputPath) => {
        await expect(
          openSlidePage({ inputPath, securityMode }),
        ).rejects.toMatchObject({
          name: "SecurityPolicyError",
          details: { code: "SECURITY_IFRAME_BLOCKED" },
        });
      });
    },
  );

  it.each<SecurityMode>(["safe", "trusted"])(
    "blocks data document navigation in %s mode",
    async (securityMode) => {
      const session = await openSlidePage({
        inputPath: path.resolve("tests/fixtures/security/scripted-slide.html"),
        securityMode,
      });
      try {
        await session.page
          .goto("data:text/html,<title>blocked</title>")
          .catch(() => undefined);
        let blocked: unknown;
        try {
          session.assertNoBlockedResources();
        } catch (error) {
          blocked = error;
        }
        expect(blocked).toMatchObject({
          name: "SecurityPolicyError",
          details: { code: "SECURITY_DATA_URL_BLOCKED" },
        });
        await expect.poll(() => session.page.isClosed()).toBe(true);
      } finally {
        await session.close();
      }
    },
  );

  it.each([
    ["safe", "data:text/html,blocked"],
    ["trusted", "data:text/html,blocked"],
    ["safe", "about:blank"],
    ["trusted", "about:blank"],
  ] as const)(
    "blocks the %s-mode subframe URL %s",
    async (securityMode, frameUrl) => {
      await withNonNetworkIframeFixture(frameUrl, async (inputPath) => {
        const outcome = await openSlidePage({ inputPath, securityMode }).then(
          (session) => ({ session }),
          (error: unknown) => ({ error }),
        );
        try {
          expect("error" in outcome ? outcome.error : undefined).toMatchObject({
            name: "SecurityPolicyError",
            details: { code: "SECURITY_IFRAME_BLOCKED" },
          });
        } finally {
          if ("session" in outcome) await outcome.session.close();
        }
      });
    },
  );

  it("rejects an already-failed trusted image without hanging", async () => {
    await withBrokenImageFixture(async (inputPath) => {
      const opening = openSlidePage({
        inputPath,
        securityMode: "trusted",
        timeoutMs: 500,
      });
      const pending = Symbol("pending");
      const outcome = await Promise.race([
        opening.then(
          (session) => ({ session }),
          (error: unknown) => ({ error }),
        ),
        delay(1_500, pending),
      ]);

      if (outcome === pending) {
        await opening.catch(() => undefined);
        expect.fail(
          "openSlidePage remained pending after a broken image failed",
        );
      }
      try {
        expect("error" in outcome ? outcome.error : undefined).toMatchObject({
          message: expect.stringContaining("Image failed to load"),
        });
      } finally {
        if ("session" in outcome) await outcome.session.close();
      }
    });
  });

  it("bounds asset settling by the policy timeout", async () => {
    await withDelayedFontsFixture(async (inputPath) => {
      const opening = openSlidePage({
        inputPath,
        securityMode: "trusted",
        timeoutMs: 500,
      });
      const pending = Symbol("pending");
      const outcome = await Promise.race([
        opening.then(
          (session) => ({ session }),
          (error: unknown) => ({ error }),
        ),
        delay(1_500, pending),
      ]);

      if (outcome === pending) {
        const lateSession = await opening;
        await lateSession.close();
        expect.fail("asset settling exceeded the policy timeout");
      }
      try {
        expect("error" in outcome ? outcome.error : undefined).toMatchObject({
          name: "SecurityPolicyError",
          details: { code: "SECURITY_RESOURCE_TIMEOUT" },
        });
      } finally {
        if ("session" in outcome) await outcome.session.close();
      }
    });
  });

  it.each<SecurityMode>(["safe", "trusted"])(
    "rejects or cancels downloads in %s mode",
    async (securityMode) => {
      await withInteractionFixture(async (inputPath) => {
        const session = await openSlidePage({ inputPath, securityMode });
        try {
          const [download] = await Promise.all([
            session.page.waitForEvent("download"),
            session.page.locator("#download").click(),
          ]);
          expect(await download.failure()).not.toBeNull();
        } finally {
          await session.close();
        }
      });
    },
  );
});

async function withRemoteImageFixture(
  run: (inputPath: string, getRequestCount: () => number) => Promise<void>,
): Promise<void> {
  let requestCount = 0;
  const server = http.createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "image/png" });
    response.end(ONE_PIXEL_PNG);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-page-remote-"),
  );
  const inputPath = path.join(directory, "slide.html");
  await fs.writeFile(
    inputPath,
    `<!doctype html><html><body><img id="remote" src="http://127.0.0.1:${port}/image.png"></body></html>`,
  );

  try {
    await run(inputPath, () => requestCount);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function withInteractionFixture(
  run: (inputPath: string) => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-page-actions-"),
  );
  const inputPath = path.join(directory, "slide.html");
  await Promise.all([
    fs.writeFile(
      inputPath,
      `<!doctype html><html><body>
        <a id="popup" href="popup.html" target="_blank">popup</a>
        <a id="download" href="download.zip" download>download</a>
      </body></html>`,
    ),
    fs.writeFile(
      path.join(directory, "popup.html"),
      "<!doctype html><title>popup</title>",
    ),
    fs.writeFile(path.join(directory, "download.zip"), "blocked download"),
  ]);

  try {
    await run(inputPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function withIframeFixture(
  run: (inputPath: string) => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-page-iframe-"),
  );
  const inputPath = path.join(directory, "slide.html");
  await Promise.all([
    fs.writeFile(inputPath, "<!doctype html><iframe src=frame.html></iframe>"),
    fs.writeFile(
      path.join(directory, "frame.html"),
      "<!doctype html><title>frame</title>",
    ),
  ]);

  try {
    await run(inputPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function withNonNetworkIframeFixture(
  frameUrl: string,
  run: (inputPath: string) => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-page-non-network-frame-"),
  );
  const inputPath = path.join(directory, "slide.html");
  await fs.writeFile(
    inputPath,
    `<!doctype html><iframe src="${frameUrl}"></iframe>`,
  );

  try {
    await run(inputPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function withBrokenImageFixture(
  run: (inputPath: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((_request, response) => {
    response.writeHead(404, { "content-type": "image/png" });
    response.end("missing");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-page-broken-image-"),
  );
  const inputPath = path.join(directory, "slide.html");
  await fs.writeFile(
    inputPath,
    `<!doctype html><img src="http://127.0.0.1:${port}/missing.png">
      <script>setTimeout(() => location.replace("about:blank"), 2000);</script>`,
  );

  try {
    await run(inputPath);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function withDelayedFontsFixture(
  run: (inputPath: string) => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-page-delayed-fonts-"),
  );
  const inputPath = path.join(directory, "slide.html");
  await fs.writeFile(
    inputPath,
    `<!doctype html><script>
      let releaseFonts;
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: { ready: new Promise((resolve) => { releaseFonts = resolve; }) },
      });
      setTimeout(() => releaseFonts(), 2000);
    </script>`,
  );

  try {
    await run(inputPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
