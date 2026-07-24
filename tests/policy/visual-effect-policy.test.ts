import { describe, expect, it } from "vitest";
import { classifyVisualEffects } from "../../src/policy/visual-effect-policy.js";
import type { DomNodeSnapshot } from "../../src/types.js";

function effectNode(
  style: Record<string, string>,
  overrides: Partial<DomNodeSnapshot> = {},
): DomNodeSnapshot {
  return {
    slide: 1,
    selector: "#effect",
    tagName: "DIV",
    id: "effect",
    text: "",
    ownText: "",
    visible: true,
    attributes: {},
    rect: { x: 100, y: 100, width: 400, height: 240 },
    style,
    children: [],
    ...overrides,
  };
}

describe("visual effect policy", () => {
  it("marks gradients and filters as requiring an isolated raster", () => {
    const findings = classifyVisualEffects(effectNode({
      backgroundImage: "linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))",
      filter: "drop-shadow(rgb(0, 0, 0) 0px 20px 20px)",
      clipPath: "none",
      maskImage: "none",
      mixBlendMode: "normal",
    }));

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        property: "background-image",
        disposition: "requires-raster",
      }),
      expect.objectContaining({
        property: "filter",
        disposition: "requires-raster",
      }),
    ]));
  });

  it("marks shadows and transforms as visible approximations", () => {
    const findings = classifyVisualEffects(effectNode({
      backgroundImage: "none",
      boxShadow: "rgba(0, 0, 0, 0.3) 0px 20px 40px",
      textShadow: "none",
      transform: "matrix(0.99, -0.14, 0.14, 0.99, 0, 0)",
      filter: "none",
      clipPath: "none",
      maskImage: "none",
      mixBlendMode: "normal",
    }));

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        property: "box-shadow",
        disposition: "approximation",
      }),
      expect.objectContaining({
        property: "transform",
        disposition: "approximation",
      }),
    ]));
  });

  it("keeps semantic text native while reporting text-shadow loss", () => {
    const findings = classifyVisualEffects(effectNode({
      backgroundImage: "none",
      boxShadow: "none",
      textShadow: "rgba(92, 42, 184, 0.3) 0px 8px 30px",
      transform: "none",
      filter: "none",
      clipPath: "none",
      maskImage: "none",
      mixBlendMode: "normal",
    }, {
      tagName: "H1",
      text: "Editable title",
      ownText: "Editable title",
      attributes: { "data-pptx-text-role": "title" },
    }));

    expect(findings).toContainEqual(expect.objectContaining({
      property: "text-shadow",
      disposition: "approximation",
    }));
  });

  it("returns no findings for inactive complex-effect properties", () => {
    expect(classifyVisualEffects(effectNode({
      backgroundImage: "none",
      boxShadow: "none",
      textShadow: "none",
      transform: "none",
      filter: "none",
      clipPath: "none",
      maskImage: "none",
      mixBlendMode: "normal",
    }))).toEqual([]);
  });

  it("warns when four CSS border sides cannot be represented faithfully", () => {
    const node = effectNode({
      borderTopColor: "rgb(255, 0, 0)",
      borderRightColor: "rgb(0, 255, 0)",
      borderBottomColor: "rgb(0, 0, 255)",
      borderLeftColor: "rgb(0, 0, 0)",
      borderTopWidth: "2px",
      borderRightWidth: "4px",
      borderBottomWidth: "6px",
      borderLeftWidth: "8px",
    });

    expect(classifyVisualEffects(node)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        property: "border-sides",
        disposition: "approximation",
      }),
    ]));
  });
});
