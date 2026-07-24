# Complex effects and layer policy

Use this decision contract before exporting HTML that contains gradients, filters, clipping, masks, transforms, pseudo-elements, canvas, or explicit `z-index`.

## Decision table

| Observable HTML/CSS | Required result |
|---|---|
| Solid fill, uniform outline, simple rectangle or ellipse | Convert to a native PowerPoint shape. |
| `box-shadow`, `text-shadow`, transform, rounded corner, or asymmetric border | Keep semantic content native, record an approximation warning, and inspect the PowerPoint render at full size. |
| Gradient or background image, `filter`, `clip-path`, mask, or blend mode on a text-free visual node | Add explicit raster authorization to that isolated node. |
| Any requires-raster effect on a node containing semantic text | Move the visual effect to a separate element; keep semantic text outside the raster node. |
| Visible pseudo-element text or unmarked canvas | Stop before PPTX writing. Rebuild content with real native HTML text or explicitly isolate a visual-only canvas. |
| Negative `z-index` | Stop with `NEGATIVE_Z_INDEX_UNSUPPORTED`; use non-negative sibling layers or DOM order. |
| Native table or chart surrounded by complex effects | Keep the table or chart native; move effects to separate decorative siblings. |

## Fail-closed errors

- `UNSUPPORTED_VISUAL_REQUIRES_RASTER`: a gradient, background image, filter, clip, mask, or blend mode would otherwise disappear. Authorize only an isolated text-free visual node.
- `NEGATIVE_Z_INDEX_UNSUPPORTED`: browser stacking-context behavior cannot be represented reliably by PowerPoint object order.
- `PSEUDO_TEXT_NOT_NATIVE`: generated pseudo-element content would not become editable text.
- `CANVAS_REQUIRES_RASTER_POLICY`: an unmarked canvas would disappear.

Never silence these errors by rasterizing the text container or the whole slide.

## Layer contract

- Express intended PowerPoint order with DOM sibling order or non-negative numeric `z-index`.
- Keep captions, labels, and descriptions as native text objects above the related image when the source shows them above it.
- Remove stale, hidden, duplicate, superseded, and off-canvas objects before delivery.
- Validate both the manifest order and the full-size Microsoft PowerPoint render.

## Transparent raster contract

- Make page, body, and slide backgrounds transparent only during isolated element capture.
- Hide every non-target element on the slide during capture. An overlapping sibling must never be baked into the image asset.
- Preserve the element's own fill, clipping, and visual children.
- Remove low-alpha background contamination introduced by browser compositing.
- If the source has transparent corners, require corner alpha to be zero. A visible rectangular halo, backdrop, or backing plate is a failure.
- Keep semantic text outside the raster element even when it visually overlaps the image.

## Known approximations

- PowerPoint uses one uniform outline for a native shape; four different CSS border sides are not exact.
- Browser transforms are flattened to measured axis-aligned bounds unless the visual is explicitly rasterized.
- CSS shadows and browser font metrics can differ from PowerPoint.
- A diff ratio is diagnostic evidence, not a pass criterion. Inspect every slide at full size.
