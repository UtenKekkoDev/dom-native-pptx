import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotDeck } from "../../src/browser/dom-snapshot.js";
import type { DomNodeSnapshot } from "../../src/types.js";

function flatten(nodes: DomNodeSnapshot[]): DomNodeSnapshot[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe("complex effect DOM evidence", () => {
  it("captures visual and stacking properties needed for conversion decisions", async () => {
    const slides = await snapshotDeck(
      path.resolve("tests/fixtures/complex-effects-stress.html"),
    );
    expect(slides).toHaveLength(8);

    const nodes = slides.flatMap(flatten);
    const card = nodes.find((node) => node.id === "gradient-card");
    const clipped = nodes.find((node) => node.id === "clipped-photo");
    const caption = nodes.find((node) => node.id === "stack-caption");
    const composite = nodes.find((node) => node.id === "authorized-composite");

    expect(card?.style.backgroundImage).toContain("linear-gradient");
    expect(card?.style.filter).toContain("drop-shadow");
    expect(card?.style.beforeContent).not.toBeUndefined();
    expect(clipped?.style.clipPath).toContain("polygon");
    expect(caption?.style.zIndex).toBe("20");
    expect(composite?.style.mixBlendMode).toBe("normal");
  });
});
