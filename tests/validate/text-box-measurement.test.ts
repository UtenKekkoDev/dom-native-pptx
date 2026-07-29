import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findUndersizedTextBoxes } from "../../src/validate/text-box-measurement.js";

describe("OOXML text-box measurement", () => {
  it("uses only transform geometry and rejects multi-line, wrapping, autofit, and incomplete measurements", async () => {
    const xml = await fs.readFile(
      path.resolve("tests/fixtures/typography-measurement.xml"),
      "utf8",
    );

    const evidence = findUndersizedTextBoxes(xml, 1);

    expect(evidence.map((record) => record.shapeName)).toEqual([
      "Extension metadata",
      "Two paragraphs",
      "Explicit break",
      "Narrow wrapping",
      "Autofit risk",
      "Missing geometry",
      "Vendor extension is not geometry",
      "Word-boundary packing",
      "CJK character packing",
    ]);
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shapeName: "Extension metadata",
          heightEmu: 127000,
        }),
        expect.objectContaining({
          shapeName: "Two paragraphs",
          requiredHeightEmu: 812800,
        }),
        expect.objectContaining({
          shapeName: "Explicit break",
          requiredHeightEmu: 1219200,
        }),
        expect.objectContaining({ shapeName: "Narrow wrapping" }),
        expect.objectContaining({
          shapeName: "Autofit risk",
          reason: "norm-autofit-risk",
        }),
        expect.objectContaining({
          shapeName: "Missing geometry",
          reason: "missing-measurement",
        }),
        expect.objectContaining({
          shapeName: "Vendor extension is not geometry",
          reason: "missing-measurement",
        }),
        expect.objectContaining({
          shapeName: "Word-boundary packing",
          requiredHeightEmu: 1016000,
        }),
        expect.objectContaining({
          shapeName: "CJK character packing",
          requiredHeightEmu: 762000,
        }),
      ]),
    );
  });

  it("resolves direct geometry by expanded QName when the DrawingML prefix is rebound", async () => {
    const xml = await fs.readFile(
      path.resolve("tests/fixtures/typography-rebound-drawingml-namespace.xml"),
      "utf8",
    );

    expect(findUndersizedTextBoxes(xml, 2)).toEqual([
      expect.objectContaining({
        slide: 2,
        shapeName: "Rebound DrawingML prefix",
        reason: "missing-measurement",
        widthEmu: 0,
        heightEmu: 0,
      }),
    ]);
  });

  it("fails closed when DrawingML namespace identity is absent or malformed", async () => {
    const xml = await fs.readFile(
      path.resolve("tests/fixtures/typography-invalid-drawingml-namespace.xml"),
      "utf8",
    );

    expect(
      findUndersizedTextBoxes(xml, 3).map((record) => ({
        shapeName: record.shapeName,
        reason: record.reason,
      })),
    ).toEqual([
      {
        shapeName: "Missing DrawingML namespace",
        reason: "missing-measurement",
      },
      {
        shapeName: "Malformed DrawingML namespace",
        reason: "missing-measurement",
      },
    ]);
  });

  it("rejects truncated XML instead of measuring a partial document", () => {
    const xml = [
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      "<p:cSld><p:spTree><p:sp>",
    ].join("");

    expect(() => findUndersizedTextBoxes(xml, 4)).toThrow(
      /invalid presentationml slide xml/iu,
    );
  });

  it("rejects a slide whose PresentationML prefix has the wrong namespace URI", () => {
    const xml = '<p:sld xmlns:p="urn:vendor"><p:cSld/></p:sld>';

    expect(() => findUndersizedTextBoxes(xml, 5)).toThrow(
      /invalid presentationml slide root/iu,
    );
  });

  it("rejects a slide whose PresentationML prefix is unbound", () => {
    const xml = "<p:sld><p:cSld/></p:sld>";

    expect(() => findUndersizedTextBoxes(xml, 6)).toThrow(
      /invalid presentationml slide xml/iu,
    );
  });

  it("rejects non-whitespace character data after the document element", () => {
    const xml = [
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
      "junk",
    ].join("");

    expect(() => findUndersizedTextBoxes(xml, 7)).toThrow(
      /invalid presentationml slide xml/iu,
    );
  });

  it("rejects non-whitespace character data before the document element", () => {
    const xml = [
      "junk",
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
    ].join("");

    expect(() => findUndersizedTextBoxes(xml, 8)).toThrow(
      /invalid presentationml slide xml/iu,
    );
  });

  it("rejects multiple document elements", () => {
    const xml = [
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    ].join("");

    expect(() => findUndersizedTextBoxes(xml, 9)).toThrow(
      /invalid presentationml slide xml/iu,
    );
  });

  it("rejects an external entity declaration before DOM traversal", () => {
    const xml = [
      '<!DOCTYPE p:sld [<!ENTITY x SYSTEM "file:///untrusted-entity">]>',
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    ].join("");

    expect(() => findUndersizedTextBoxes(xml, 10)).toThrow(
      /invalid presentationml slide xml/iu,
    );
  });

  it("accepts alternate OOXML prefixes and extension metadata", () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<slide:sld xmlns:slide="http://schemas.openxmlformats.org/presentationml/2006/main"',
      ' xmlns:drawing="http://schemas.openxmlformats.org/drawingml/2006/main"',
      ' xmlns:vendor="urn:vendor">',
      "<slide:cSld><slide:spTree><slide:extLst>",
      '<slide:ext uri="{A1B2C3}"><vendor:metadata drawing:compat="true"/></slide:ext>',
      "</slide:extLst></slide:spTree></slide:cSld>",
      "</slide:sld>",
    ].join("");

    expect(findUndersizedTextBoxes(xml, 11)).toEqual([]);
  });
});
