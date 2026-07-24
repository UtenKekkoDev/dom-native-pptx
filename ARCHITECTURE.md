# Architecture

```text
HTML/CSS
  → Playwright/Chromium layout + computed styles
  → typed DOM snapshot
  → semantic and raster preflight
  → native text / shape / table / chart converters
  → explicitly authorized image capture
  → PptxGenJS package writer
  → conversion manifest
  → OOXML structural audit
  → browser reference render
  → Microsoft PowerPoint authoritative render
  → pixel diff + manual review
```

## Trust boundaries

The semantic preflight is the first enforcement boundary. A raster request is denied unless both whitelist attributes are present and the subtree contains no protected text.

The manifest is the second boundary. It records the DOM selector, semantic role, output object type, raster status, authorization reason, and asset path.

The OOXML audit is the third boundary. It opens the generated package, finds native `<a:t>` text, chart cache values, image media, and full-slide picture geometry. A missing protected string or unauthorized image makes validation fail.

Microsoft PowerPoint is the visual authority. The COM validator opens the file read-only and exports deterministic `slide-001.png` files. Browser and PowerPoint images are compared at 1920×1080.

## Deliberate constraints

- Local Windows and personal use first
- 16:9, 1920×1080 authoring canvas
- No silent screenshot fallback
- Native editability is more important than supporting every CSS effect
- Complex visual effects must be isolated from semantic text before raster capture
