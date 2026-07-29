import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createErrorReport } from "../src/report/error-report.js";
import { SecurityPolicyError } from "../src/security/security-policy.js";
import { ConversionPolicyError } from "../src/types.js";

describe("CLI", () => {
  it("accepts an output path as a positional fallback for npm on Windows", async () => {
    const output = path.resolve(".tmp/tests/cli-positional.pptx");
    await fs.rm(output, { force: true });
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "export",
        "tests/fixtures/basic-slide.html",
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      output,
    });
    expect((await fs.stat(output)).size).toBeGreaterThan(0);
  });

  it("exports audited HTML in trusted mode when explicitly requested", async () => {
    const output = path.resolve(".tmp/tests/cli-trusted.pptx");
    await fs.rm(output, { force: true });
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "export",
        "tests/fixtures/security/scripted-slide.html",
        output,
        "--trusted",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      output,
      securityMode: "trusted",
    });
  });

  it("validates audited HTML with JavaScript in trusted mode", async () => {
    const input = path.resolve(".tmp/tests/cli-validate-trusted.html");
    await fs.mkdir(path.dirname(input), { recursive: true });
    await fs.writeFile(
      input,
      `<!doctype html><html><body>
      <section class="pptx-slide" style="width:1920px;height:1080px"></section>
      <script>
        document.body.append(document.querySelector(".pptx-slide").cloneNode());
      </script>
    </body></html>`,
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "validate", input, "--trusted"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      slides: 2,
      securityMode: "trusted",
    });
  });

  it("renders audited HTML with JavaScript in trusted mode", async () => {
    const output = path.resolve(".tmp/tests/cli-render-trusted");
    await fs.rm(output, { recursive: true, force: true });
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "render-html",
        "tests/fixtures/security/scripted-raster.html",
        output,
        "--trusted",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      outputDir: output,
      securityMode: "trusted",
    });
    const { data, info } = await sharp(path.join(output, "slide-001.png"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (200 * info.width + 200) * 4;
    expect(Array.from(data.subarray(pixel, pixel + 4))).toEqual([
      0, 255, 0, 255,
    ]);
  });

  it("sanitizes structured security policy errors", async () => {
    const inputPath = path.resolve(".tmp/private/customer/blocked.html");
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(
      inputPath,
      `<!doctype html><html><body>
      <section class="pptx-slide" style="width:1920px;height:1080px">
        <img src="https://example.com/image.png?token=secret#private">
      </section>
    </body></html>`,
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "validate", inputPath],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    const report = JSON.parse(result.stderr) as unknown;

    expect(result.status).toBe(1);
    expect(report).toMatchObject({
      ok: false,
      error: {
        code: "SECURITY_REMOTE_RESOURCE_BLOCKED",
        resourceType: "image",
        resourceLocation: "https://example.com/image.png",
        inputPath: "blocked.html",
        securityMode: "safe",
      },
    });
    const serialized = `${result.stdout}\n${result.stderr}`;
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain(path.dirname(inputPath));
  });

  it("removes URL credentials from raw security error details", () => {
    const report = createErrorReport(
      new SecurityPolicyError({
        code: "SECURITY_REMOTE_RESOURCE_BLOCKED",
        resourceType: "image",
        resourceLocation:
          "https://operator:password@example.com/image.png?token=secret#private",
        inputPath: path.resolve(".tmp/private/customer/slides.html"),
        securityMode: "safe",
        suggestedRepair: "Use a local resource.",
      }),
    );

    expect(report.error).toMatchObject({
      resourceLocation: "https://example.com/image.png",
      inputPath: "slides.html",
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("operator");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");
  });

  it("sanitizes unexpected error messages before reporting them", () => {
    const privatePath = path.resolve(".tmp/private/customer/slides.html");
    const report = createErrorReport(
      new Error(
        `Failed https://operator:password@example.com/image.png?token=secret#private ` +
          `and data:text/html,<secret-payload> from ${privatePath}`,
      ),
    );
    const serialized = JSON.stringify(report);

    expect(report.error).toMatchObject({ code: "UNEXPECTED_ERROR" });
    expect(serialized).not.toContain("operator");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret-payload");
    expect(serialized).not.toContain(path.dirname(privatePath));
  });

  it.each(["ftp", "ws", "custom-scheme"])(
    "sanitizes credential-bearing %s URLs in unexpected errors",
    (scheme) => {
      const report = createErrorReport(
        new Error(
          `Fetch ${scheme}://operator:password@example.com/private/deck.html` +
            "?token=secret#customer failed",
        ),
      );
      const serialized = JSON.stringify(report);

      expect(report.error).toMatchObject({ code: "UNEXPECTED_ERROR" });
      expect(serialized).toContain(`${scheme}://example.com/private/deck.html`);
      expect(serialized).not.toContain("operator");
      expect(serialized).not.toContain("password");
      expect(serialized).not.toContain("token");
      expect(serialized).not.toContain("customer");
    },
  );

  it.each([
    ["ftp", "(secret)"],
    ["ws", "[secret]"],
    ["custom-scheme", "{secret}"],
  ])(
    "removes delimiter-bearing query and fragment values from %s URLs",
    (scheme, queryValue) => {
      const report = createErrorReport(
        new Error(
          `Fetch ${scheme}://example.com/private/deck.html` +
            `?token=${queryValue}#customer failed on slide 7`,
        ),
      );
      const serialized = JSON.stringify(report);

      expect(report.error).toMatchObject({
        code: "UNEXPECTED_ERROR",
        reason: `Fetch ${scheme}://example.com/private/deck.html failed on slide 7`,
      });
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("customer");
      expect(serialized).not.toContain("token");
    },
  );

  it.each([
    ["single quote", "'secret'"],
    ["double quote", '"secret"'],
    ["angle brackets", "<secret>"],
  ])(
    "removes %s query and fragment values from unexpected errors",
    (_label, queryValue) => {
      const report = createErrorReport(
        new Error(
          "Fetch custom-scheme://example.com/private/deck.html" +
            `?token=${queryValue}#customer${queryValue} failed after conversion`,
        ),
      );
      const serialized = JSON.stringify(report);

      expect(report.error).toMatchObject({
        code: "UNEXPECTED_ERROR",
        reason:
          "Fetch custom-scheme://example.com/private/deck.html " +
          "failed after conversion",
      });
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("customer");
      expect(serialized).not.toContain("token");
    },
  );

  it("sanitizes UNC paths without discarding surrounding diagnostics", () => {
    const report = createErrorReport(
      new Error(
        String.raw`Failed \\server\share\private\deck.html while converting slide 2`,
      ),
    );
    const serialized = JSON.stringify(report);

    expect(report.error).toMatchObject({
      code: "UNEXPECTED_ERROR",
      reason: "Failed deck.html while converting slide 2",
    });
    expect(serialized).not.toContain("server");
    expect(serialized).not.toContain("share");
    expect(serialized).not.toContain("private");
  });

  it("removes whitespace-containing data URL payloads conservatively", () => {
    const report = createErrorReport(
      new Error(
        "Failed data:text/html,<section>secret payload with spaces</section> " +
          "while rendering slide 3",
      ),
    );
    const serialized = JSON.stringify(report);

    expect(report.error).toMatchObject({
      code: "UNEXPECTED_ERROR",
      reason: "Failed data:[redacted]",
    });
    expect(serialized).not.toContain("secret payload");
    expect(serialized).not.toContain("section");
  });

  it("does not treat words inside a data URL payload as safe boundaries", () => {
    const report = createErrorReport(
      new Error(
        "Failed data:text/plain,secret from customer while still private",
      ),
    );
    const serialized = JSON.stringify(report);

    expect(report.error).toMatchObject({
      code: "UNEXPECTED_ERROR",
      reason: "Failed data:[redacted]",
    });
    expect(serialized).not.toContain("customer");
    expect(serialized).not.toContain("still private");
  });

  it("sanitizes a quoted UNC path containing whitespace", () => {
    const report = createErrorReport(
      new Error(
        String.raw`Failed "\\server\share\private folder\deck.html" while converting`,
      ),
    );
    const serialized = JSON.stringify(report);

    expect(report.error).toMatchObject({
      code: "UNEXPECTED_ERROR",
      reason: 'Failed "deck.html" while converting',
    });
    expect(serialized).not.toContain("server");
    expect(serialized).not.toContain("private folder");
  });

  it("sanitizes separate POSIX paths without consuming words between them", () => {
    const report = createErrorReport(
      new Error(
        "Failed /Users/customer/private/deck.html while processing " +
          "/var/tmp/next/item.json before retry",
      ),
    );

    expect(report.error).toMatchObject({
      code: "UNEXPECTED_ERROR",
      reason: "Failed deck.html while processing item.json before retry",
    });
  });

  it("sanitizes every user-controlled ConversionPolicyError text field", () => {
    const report = createErrorReport(
      new ConversionPolicyError({
        code: "RASTER_ROLE_INVALID",
        slide: 4,
        selector:
          '#card[data-source="ftp://operator:password@example.com/deck?token=secret"]',
        textPreview:
          "Preview data:text/html,<p>private payload with spaces</p> while editing",
        reason: String.raw`Unsupported role custom://user:pass@example.com/bad?key=value at \\server\share\private\deck.html`,
        suggestedRepair: "Use an allowed data-pptx-raster-role value.",
      }),
    );
    const serialized = JSON.stringify(report);

    expect(report.error).toMatchObject({
      code: "RASTER_ROLE_INVALID",
      slide: 4,
      suggestedRepair: "Use an allowed data-pptx-raster-role value.",
    });
    for (const secret of [
      "operator",
      "password",
      "token",
      "private payload",
      "user",
      "pass",
      "key=value",
      "server",
      "share",
      "private\\deck",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("removes delimiter-bearing URL secrets from ConversionPolicyError details", () => {
    const report = createErrorReport(
      new ConversionPolicyError({
        code: "RASTER_ROLE_INVALID",
        slide: 5,
        selector: "#card",
        textPreview: "Visible text",
        reason:
          "Rejected custom-scheme://example.com/deck?token={secret}#customer " +
          "while validating role",
        suggestedRepair: "Use an allowed data-pptx-raster-role value.",
      }),
    );
    const serialized = JSON.stringify(report);

    expect(report.error).toMatchObject({
      code: "RASTER_ROLE_INVALID",
      slide: 5,
      reason: "Rejected custom-scheme://example.com/deck while validating role",
      suggestedRepair: "Use an allowed data-pptx-raster-role value.",
    });
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("customer");
    expect(serialized).not.toContain("token");
  });

  it.each([
    ["single quote", "'secret'"],
    ["double quote", '"secret"'],
    ["angle brackets", "<secret>"],
  ])(
    "removes %s URL secrets from ConversionPolicyError details",
    (_label, queryValue) => {
      const report = createErrorReport(
        new ConversionPolicyError({
          code: "RASTER_ROLE_INVALID",
          slide: 6,
          selector: "#card",
          textPreview: "Visible text",
          reason:
            "Rejected custom-scheme://example.com/deck" +
            `?token=${queryValue}#customer${queryValue} while validating role`,
          suggestedRepair: "Use an allowed data-pptx-raster-role value.",
        }),
      );
      const serialized = JSON.stringify(report);

      expect(report.error).toMatchObject({
        code: "RASTER_ROLE_INVALID",
        slide: 6,
        reason:
          "Rejected custom-scheme://example.com/deck while validating role",
        suggestedRepair: "Use an allowed data-pptx-raster-role value.",
      });
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("customer");
      expect(serialized).not.toContain("token");
    },
  );
});
