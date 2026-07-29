import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("browser entrypoint contract", () => {
  it("allows direct chromium launch only in slide-page-session", () => {
    const files = [
      "src/browser/dom-snapshot.ts",
      "src/validate/html-renderer.ts",
      "src/pipeline/export-deck.ts",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.resolve(file), "utf8");
      expect(source).not.toMatch(/chromium\.launch|launchBrowser|newPage\(/u);
      expect(source).toContain("openSlidePage");
    }
  });

  it("keeps safe example stylesheets inside each input directory", () => {
    const examplesRoot = path.resolve("examples");
    const canonicalCss = fs.readFileSync(
      path.join(examplesRoot, "shared.css"),
      "utf8",
    );
    const exampleDirectories = fs
      .readdirSync(examplesRoot, {
        withFileTypes: true,
      })
      .filter((entry) => entry.isDirectory());

    for (const entry of exampleDirectories) {
      const directory = path.join(examplesRoot, entry.name);
      const input = path.join(directory, "slides.html");
      if (!fs.existsSync(input)) continue;
      const source = fs.readFileSync(input, "utf8");
      const stylesheetHrefs = Array.from(
        source.matchAll(
          /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/giu,
        ),
        (match) => match[1],
      );

      expect(stylesheetHrefs, input).not.toHaveLength(0);
      for (const href of stylesheetHrefs) {
        const stylesheet = path.resolve(directory, href);
        const relative = path.relative(directory, stylesheet);
        expect(relative, href).not.toMatch(/^\.\.(?:[\\/]|$)/u);
        expect(fs.readFileSync(stylesheet, "utf8"), stylesheet).toBe(
          canonicalCss,
        );
      }
    }
  });
});
