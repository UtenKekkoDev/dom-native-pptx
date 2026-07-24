# Source fidelity contract

Use this contract when a PDF, image, template, HTML render, or existing deck is the visual authority.

## Measure before rebuilding

Record for every slide:

- title line count and rendered bounding box;
- body line count, bounding box, and contrast;
- screenshot/image crop bounds;
- caption placement;
- connector, rule, glow, badge, and page-marker count.

## Acceptance gates

- Keep the title line count exact. Keep its rendered width and height within 10% of the source unless the user requests a redesign.
- Keep body copy native. Do not shrink it to compensate for a bad layout.
- Require each text box to have readable vertical geometry. Fail when `undersizedTextBoxes` is non-empty.
- Treat auto-fit below 85% of the declared size as a failure when the renderer exposes the scale.
- Preserve screenshot pixels. Do not place opaque caption or cleanup bars over controls, timelines, labels, thumbnails, or other non-background pixels.
- Crop an allowed photo, logo, or screenshot from the source. Do not use a full-page render as a reconstruction layer.
- Preserve connectors and structural decoration that explains relationships.

## Full-size inspection

Compare source and Microsoft PowerPoint renders side by side at 100% for every slide. Check title scale first, then text readability, screenshot edges, connectors, captions, and page markers. A montage can reveal deck-level consistency but cannot pass a slide.

If the source embeds text inside a screenshot, keep that composite raster only when the user's raster policy allows it. Never rasterize正文、标题、表格、数据、脚注或页码 merely to improve visual similarity.
