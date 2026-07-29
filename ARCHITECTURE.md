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

The browser session is the runtime boundary. Safe mode is the default: it
disables JavaScript and accepts only local resources inside the input HTML
directory plus image/font data URLs. Remote resources, local path escapes,
iframes, document data URLs, popups, downloads, and service workers fail
closed. Trusted mode is an explicit option for user-authored or audited HTML;
it is not a sandbox for untrusted input. Remote dependencies should normally be
vendored beside the input so safe mode can convert a self-contained deck.

The semantic preflight is the first enforcement boundary. A raster request is denied unless both whitelist attributes are present and the subtree contains no protected text.

The manifest is the second boundary. It records the DOM selector, semantic role, output object type, raster status, authorization reason, and asset path.

The OOXML audit is the third boundary. It opens the generated package, finds native `<a:t>` text, chart cache values, image media, and full-slide picture geometry. A missing protected string or unauthorized image makes validation fail.

Microsoft PowerPoint is the visual authority. The COM validator opens the file read-only and exports deterministic `slide-001.png` files. Browser and PowerPoint images are compared at 1920×1080.

Security policy failures stop the pipeline before a successful PPTX is
returned. Manifests and validation reports record `securityMode`; CLI failures
are structured and sanitize sensitive resource locations. See
[SECURITY.md](SECURITY.md) for error codes and caller guidance.

## Deliberate constraints

- Local Windows and personal use first
- 16:9, 1920×1080 authoring canvas
- No silent screenshot fallback
- Native editability is more important than supporting every CSS effect
- Complex visual effects must be isolated from semantic text before raster capture
