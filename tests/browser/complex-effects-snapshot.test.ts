import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotDeck } from "../../src/browser/dom-snapshot.js";
import { openSlidePage } from "../../src/browser/slide-page-session.js";
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

  it("keeps the native-data title inside its box and clear of the body", async () => {
    const session = await openSlidePage({
      inputPath: path.resolve("tests/fixtures/complex-effects-stress.html"),
    });
    try {
      const title = session.page.locator("#table-chart-effects .title");
      const body = session.page.locator("#table-chart-effects .body");
      const layout = await title.evaluate(
        (element, bodyElement) => {
          const titleBox = element.getBoundingClientRect();
          const bodyBox = (bodyElement as HTMLElement).getBoundingClientRect();
          return {
            bottom: titleBox.bottom,
            bodyTop: bodyBox.top,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
          };
        },
        await body.elementHandle(),
      );

      expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight);
      expect(layout.bottom).toBeLessThanOrEqual(layout.bodyTop);
    } finally {
      await session.close();
    }
  }, 30_000);
});
