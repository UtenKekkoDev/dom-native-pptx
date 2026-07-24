import { describe, expect, it } from "vitest";
import { evaluateRasterPolicy } from "../../src/policy/raster-policy.js";
import type { DomNodeSnapshot } from "../../src/types.js";

function node(overrides: Partial<DomNodeSnapshot> = {}): DomNodeSnapshot {
  return {
    slide: 1,
    selector: "#node",
    tagName: "DIV",
    id: "node",
    text: "",
    ownText: "",
    visible: true,
    attributes: {},
    rect: { x: 0, y: 0, width: 100, height: 100 },
    style: {},
    children: [],
    ...overrides,
  };
}

describe("raster policy", () => {
  it("allows an explicitly whitelisted photo without protected text", () => {
    expect(evaluateRasterPolicy(node({
      attributes: {
        "data-pptx-raster": "allowed",
        "data-pptx-raster-role": "photo",
      },
    }))).toEqual({
      allowed: true,
      role: "photo",
      reason: "explicit-whitelist",
    });
  });

  it("rejects body text inside an allowed photo container", () => {
    const body = node({
      selector: "#photo p",
      tagName: "P",
      text: "这段正文必须保留为可编辑文字",
      ownText: "这段正文必须保留为可编辑文字",
    });

    expect(() => evaluateRasterPolicy(node({
      selector: "#photo",
      text: body.text,
      attributes: {
        "data-pptx-raster": "allowed",
        "data-pptx-raster-role": "photo",
      },
      children: [body],
    }))).toThrow(/protected text.*#photo p.*这段正文/u);
  });

  it("rejects rasterization without an approved role", () => {
    expect(() => evaluateRasterPolicy(node({
      attributes: {
        "data-pptx-raster": "allowed",
        "data-pptx-raster-role": "unknown",
      },
    }))).toThrow(/approved raster role/i);
  });

  it("rejects an approved role without the explicit opt-in flag", () => {
    expect(() => evaluateRasterPolicy(node({
      attributes: {
        "data-pptx-raster-role": "logo",
      },
    }))).toThrow(/explicit raster whitelist/i);
  });

  it("allows text only for the brand-lockup role", () => {
    const logoText = node({
      selector: "#brand-lockup .wordmark",
      tagName: "SPAN",
      text: "VivaReel",
      ownText: "VivaReel",
    });

    expect(evaluateRasterPolicy(node({
      selector: "#brand-lockup",
      text: "VivaReel",
      attributes: {
        "data-pptx-raster": "allowed",
        "data-pptx-raster-role": "brand-lockup",
      },
      children: [logoText],
    }))).toEqual({
      allowed: true,
      role: "brand-lockup",
      reason: "explicit-whitelist",
    });
  });

  it("rejects semantic text even when the role is brand-lockup", () => {
    const caption = node({
      selector: "#brand-lockup .caption",
      tagName: "P",
      text: "全球 AI 影视平台",
      ownText: "全球 AI 影视平台",
      attributes: {
        "data-pptx-text-role": "caption",
      },
    });

    expect(() => evaluateRasterPolicy(node({
      selector: "#brand-lockup",
      text: caption.text,
      attributes: {
        "data-pptx-raster": "allowed",
        "data-pptx-raster-role": "brand-lockup",
      },
      children: [caption],
    }))).toThrow(/protected text.*全球 AI 影视平台/u);
  });
});
