---
name: dom-native-pptx
description: Use when converting slide-safe HTML/CSS, PDF-derived slide layouts, or visual reference decks into editable PowerPoint, especially when semantic text must stay native and the output must match source typography, screenshot crops, connectors, captions, and page structure.
---

# DOM Native PPTX

Create or edit slide-safe HTML, export it to `.pptx`, and prove that protected text remains native.

## Non-negotiable contract

- Keep every title, subtitle, body paragraph, KPI, caption, source, footer, page number, table cell, and chart label as native PowerPoint text, table, or chart data.
- Never solve a conversion problem by screenshotting a text container, SVG containing semantic text, or an entire slide.
- Permit raster output only when the element contains both:

```html
data-pptx-raster="allowed"
data-pptx-raster-role="logo|brand-lockup|photo|illustration|decorative-composite"
```

- Allow text inside a raster container only for a non-semantic brand wordmark in `brand-lockup`. Reject headings, paragraphs, explicit text roles, or other semantic text even inside an allowed container.
- Stop on a policy or OOXML audit failure. Do not silently downgrade.
- Reject native text that only exists structurally but is clipped or collapsed in PowerPoint. `undersizedTextBoxes` must be empty.
- Never reconstruct a slide by placing a full-page source render behind opaque masks. Crop and place only the approved image or screenshot region.
- Never add or bake in an image backing plate, screenshot backdrop, or rectangular halo that the source does not contain.

Read [references/html-authoring-contract.md](references/html-authoring-contract.md) before authoring HTML. Read [references/raster-policy.md](references/raster-policy.md) before adding any raster marker.
For PDF, screenshot, template, or reference-deck reproduction, also read [references/source-fidelity.md](references/source-fidelity.md).
For gradients, `clip-path`, filters, masks, blend modes, transforms, asymmetric borders, or explicit stacking, read [references/complex-effects.md](references/complex-effects.md).

## Workflow

1. Locate the converter. Use `DOM_NATIVE_PPTX_HOME` when set; otherwise discover the repository from the current workspace or the Skill installation.
2. Author each page as an exact `1920 × 1080` `.pptx-slide`.
3. Add explicit `data-pptx-text-role` attributes to important text.
4. Use native `<table>` and `data-pptx-chart-config` contracts for editable data.
5. Run preflight:

```powershell
node scripts/validate.mjs <slides.html>
```

6. Export and run structural validation:

```powershell
node scripts/export.mjs <slides.html> <output.pptx>
node scripts/inspect.mjs <output.pptx>
```

7. Run the complete Microsoft PowerPoint QA loop:

```powershell
node scripts/qa.mjs <slides.html> <output.pptx>
```

8. Inspect every PowerPoint render and diff image at full size. A contact sheet is only an index. Use [references/qa-checklist.md](references/qa-checklist.md).
9. Deliver the PPTX, conversion manifest, validation JSON/HTML, HTML renders, PowerPoint renders, diff images, and visual summary.

After changing converter code, policy, fixtures, or this Skill, also run `npm run test:stress` from the converter repository.

## Authoring decisions

- Prefer native text plus simple native rectangles over decorative raster composites.
- Use a raster composite only when PowerPoint cannot represent the effect and the element contains no protected text.
- Separate decorative effects from nearby semantic copy in the DOM.
- Treat Microsoft PowerPoint rendering as authoritative. Browser rendering is the visual reference, not the final renderer.
- Match source title line count and rendered bounds before accepting a source-driven reconstruction. Text presence alone is not fidelity.
- Inventory and reproduce connectors, rules, glows, page markers, and screenshot captions; do not treat them as optional decoration.
- Fail closed when a complex visual would otherwise disappear. Split semantic text from the visual node before authorizing raster capture.
- Read [references/supported-css.md](references/supported-css.md) before depending on unsupported CSS.

## Required failure behavior

If conversion cannot preserve protected text, readable text geometry, or required source fidelity, report the slide, selector, text preview, reason, and suggested repair. Return no successful PPTX result.
