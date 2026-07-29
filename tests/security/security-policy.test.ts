import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSecurityPolicy,
  SecurityPolicyError,
} from "../../src/security/security-policy.js";

describe("browser security policy", () => {
  it("defaults to safe and rejects remote resources", async () => {
    const input = path.resolve("tests/fixtures/basic-slide.html");
    const policy = await createSecurityPolicy({ inputPath: input });
    expect(policy.mode).toBe("safe");
    await expect(
      policy.assertAllowed({
        url: "https://example.com/image.png",
        resourceType: "image",
        isSubframeNavigation: false,
      }),
    ).rejects.toMatchObject<Partial<SecurityPolicyError>>({
      details: { code: "SECURITY_REMOTE_RESOURCE_BLOCKED" },
    });
  });

  it("allows files inside the input directory and rejects path escape", async () => {
    const root = path.resolve(".tmp/tests/security-policy");
    await fs.mkdir(path.join(root, "assets"), { recursive: true });
    await fs.writeFile(path.join(root, "slides.html"), "<html></html>");
    await fs.writeFile(path.join(root, "assets", "ok.png"), "ok");
    await fs.writeFile(path.join(root, "..", "outside.png"), "outside");
    const policy = await createSecurityPolicy({
      inputPath: path.join(root, "slides.html"),
    });
    await expect(
      policy.assertAllowedFile(path.join(root, "assets", "ok.png")),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertAllowedFile(path.join(root, "..", "outside.png")),
    ).rejects.toMatchObject({
      details: { code: "SECURITY_LOCAL_PATH_ESCAPE" },
    });
  });

  it("allows remote resources only in trusted mode", async () => {
    const policy = await createSecurityPolicy({
      inputPath: path.resolve("tests/fixtures/basic-slide.html"),
      securityMode: "trusted",
    });
    await expect(
      policy.assertAllowed({
        url: "https://example.com/image.png",
        resourceType: "image",
        isSubframeNavigation: false,
      }),
    ).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "rejects a case-distinct sibling path on case-sensitive filesystems",
    async () => {
      const parent = path.resolve(".tmp/tests/security-policy-case-sensitive");
      const root = path.join(parent, "Deck");
      const outside = path.join(parent, "deck", "secret.png");
      await fs.mkdir(root, { recursive: true });
      await fs.mkdir(path.dirname(outside), { recursive: true });
      await fs.writeFile(path.join(root, "slides.html"), "<html></html>");
      await fs.writeFile(outside, "secret");
      const policy = await createSecurityPolicy({
        inputPath: path.join(root, "slides.html"),
      });

      await expect(policy.assertAllowedFile(outside)).rejects.toMatchObject({
        details: { code: "SECURITY_LOCAL_PATH_ESCAPE" },
      });
    },
  );

  it("allows image and font data URLs", async () => {
    const policy = await createSecurityPolicy({
      inputPath: path.resolve("tests/fixtures/basic-slide.html"),
    });

    await expect(
      policy.assertAllowed({
        url: "data:image/png;base64,AA==",
        resourceType: "image",
        isSubframeNavigation: false,
      }),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertAllowed({
        url: "data:font/woff2;base64,AA==",
        resourceType: "font",
        isSubframeNavigation: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects unsafe data URLs regardless of scheme casing", async () => {
    const policy = await createSecurityPolicy({
      inputPath: path.resolve("tests/fixtures/basic-slide.html"),
      securityMode: "trusted",
    });

    for (const url of ["data:text/html,secret", "DATA:text/html,secret"]) {
      await expect(
        policy.assertAllowed({
          url,
          resourceType: "document",
          isSubframeNavigation: false,
        }),
      ).rejects.toMatchObject({
        details: {
          code: "SECURITY_DATA_URL_BLOCKED",
        },
      });
    }
  });

  it("rejects parser-normalized whitespace-prefixed data URLs", async () => {
    const policy = await createSecurityPolicy({
      inputPath: path.resolve("tests/fixtures/basic-slide.html"),
      securityMode: "trusted",
    });

    for (const url of [" DATA:text/html,secret", "\nDATA:text/html,secret"]) {
      await expect(
        policy.assertAllowed({
          url,
          resourceType: "document",
          isSubframeNavigation: false,
        }),
      ).rejects.toMatchObject({
        details: {
          code: "SECURITY_DATA_URL_BLOCKED",
          resourceLocation: "data:text/html",
        },
      });
    }
  });

  it("rejects subframe documents in safe and trusted modes", async () => {
    for (const securityMode of ["safe", "trusted"] as const) {
      const policy = await createSecurityPolicy({
        inputPath: path.resolve("tests/fixtures/basic-slide.html"),
        securityMode,
      });

      await expect(
        policy.assertAllowed({
          url: "https://example.com/frame.html",
          resourceType: "document",
          isSubframeNavigation: true,
        }),
      ).rejects.toMatchObject({
        details: { code: "SECURITY_IFRAME_BLOCKED" },
      });
    }
  });
});
