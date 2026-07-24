import { describe, expect, it } from "vitest";
import { orderSiblingsForPptx } from "../../src/pipeline/paint-order.js";
import type { DomNodeSnapshot } from "../../src/types.js";

function snapshot(id: string, zIndex: string): DomNodeSnapshot {
  return {
    slide: 1,
    selector: `#${id}`,
    tagName: "DIV",
    id,
    text: "",
    ownText: "",
    visible: true,
    attributes: {},
    rect: { x: 0, y: 0, width: 100, height: 100 },
    style: { zIndex },
    children: [],
  };
}

describe("PowerPoint paint order", () => {
  it("places a lower z-index image before a higher z-index caption", () => {
    const ordered = orderSiblingsForPptx([
      snapshot("caption", "20"),
      snapshot("image", "10"),
    ]);
    expect(ordered.map((node) => node.id)).toEqual(["image", "caption"]);
  });

  it("places negative layers before auto and positive layers", () => {
    const ordered = orderSiblingsForPptx([
      snapshot("auto", "auto"),
      snapshot("positive", "3"),
      snapshot("negative", "-5"),
    ]);
    expect(ordered.map((node) => node.id)).toEqual([
      "negative",
      "auto",
      "positive",
    ]);
  });

  it("preserves DOM order when z-index values are equal or non-numeric", () => {
    const ordered = orderSiblingsForPptx([
      snapshot("first", "auto"),
      snapshot("second", "not-a-number"),
      snapshot("third", "0"),
    ]);
    expect(ordered.map((node) => node.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});
