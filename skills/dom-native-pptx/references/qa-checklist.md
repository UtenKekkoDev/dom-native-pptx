# QA checklist

## Preflight

- [ ] Every slide is 1920×1080.
- [ ] Important text has explicit roles.
- [ ] Tables use semantic HTML.
- [ ] Charts contain editable JSON series.
- [ ] Every raster node has both required attributes.
- [ ] No raster node contains protected text.

## Structural audit

- [ ] `validation.json` reports `ok: true`.
- [ ] `missingProtectedText` is empty.
- [ ] `unauthorizedRasterRecords` is empty.
- [ ] `unmanifestedMediaCount` is zero.
- [ ] `fullSlideRasterCount` is zero.
- [ ] Native chart values appear in chart OOXML.
- [ ] `undersizedTextBoxes` is empty.

## Source fidelity

- [ ] Title line count matches the source.
- [ ] Title rendered width and height are within 10% of the source.
- [ ] Body text remains readable and is not compensated by aggressive auto-fit.
- [ ] Screenshot crops preserve every visible control, timeline, label, and thumbnail.
- [ ] No opaque cleanup mask covers non-background source pixels.
- [ ] Connectors, rules, glows, captions, and page markers were inventoried and reproduced.

## Microsoft PowerPoint

- [ ] PowerPoint opens without a repair dialog.
- [ ] PowerPoint exports the expected slide count.
- [ ] Every slide render is 1920×1080.
- [ ] No title or body text wraps unexpectedly.
- [ ] No text overlaps, clips, or disappears.
- [ ] No native text renders as a hairline, partial glyph, or unreadably shrunk line.
- [ ] Tables and charts remain editable.
- [ ] Fonts and colors are acceptable.
- [ ] Every slide was inspected side by side at full size; montage and diff ratio alone are not pass criteria.
- [ ] Images with transparent corners have corner alpha equal to zero after capture; no rectangular halo or backing plate is visible in PowerPoint.
- [ ] No caption, label, or other overlapping sibling is duplicated inside a raster image and again as a native object.

## Converter and Skill regression

- [ ] `npm run build` passes.
- [ ] `npm test -- --run` passes.
- [ ] `npm run test:stress` opens and renders the stress deck in Microsoft PowerPoint.
- [ ] The stress scorecard passes structural, editability, raster-policy, typography, layer-order, and authoritative-render gates.
- [ ] Every HTML and PowerPoint stress render was inspected side by side at full-size resolution.

## Delivery

- [ ] `.pptx`
- [ ] `.conversion-manifest.json`
- [ ] `.validation.json`
- [ ] `.validation.html`
- [ ] HTML reference PNGs
- [ ] PowerPoint PNGs
- [ ] Diff PNGs
- [ ] `.visual-summary.json`
