# Asset provenance

Audit date: 2026-07-28.

The public source tree contains two tracked generated PNGs for README visual
evidence. It contains no third-party binary images, fonts, PDFs, PowerPoint
files, videos, customer reference decks, or remote image dependencies. Example
and stress slides are constructed from editable HTML text, CSS colors and
shapes, native table/chart data, and small inline SVG paths authored as
repository fixtures.

## Generated README evidence

| Repository path                   | Source and slide                                                               | Renderer                     |  Dimensions | Modification                                                                                                   | License and ownership            |
| --------------------------------- | ------------------------------------------------------------------------------ | ---------------------------- | ----------: | -------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `docs/assets/demo-html.png`       | `examples/10-full-business-deck/slides.html`, slide 6 (`05 · IP MONETIZATION`) | Chromium, safe mode          | 1920 × 1080 | Copied byte-for-byte from `.tmp/readme/html/slide-006.png`; no resize, recompression, or AI modification       | MIT; Copyright © 2026 Yuxuan Sun |
| `docs/assets/demo-powerpoint.png` | The PPTX exported from the same fixture and slide                              | Microsoft PowerPoint Desktop | 1920 × 1080 | Copied byte-for-byte from `.tmp/readme/powerpoint/slide-006.png`; no resize, recompression, or AI modification | MIT; Copyright © 2026 Yuxuan Sun |

The browser source render and PowerPoint authority render show the same slide
content. Their remaining visible differences are expected renderer behavior:
PowerPoint uses square corners for the native card shapes, a shorter card
height, and slightly different text baselines. The evidence is intentionally
not retouched because it documents the converter's real output rather than a
marketing reconstruction.

Before adding any image, logo, font, PDF, deck, or video, record its repository
path, original source URL or author, license, modifications, and redistribution
permission in this file.

The machine-readable version 1 registry is `docs/asset-provenance.json`. The
public-tree synchronizer rejects binary media that is missing from that
registry, has incomplete or empty fields, or no longer matches its registered
lowercase hexadecimal `sha256` digest.

Generated assets record `path`, `type: "generated"`, `sourceFixture`,
reproducible `command`, `license`, and `sha256`. The source fixture must be an
allowlisted file in the same exact source commit. Third-party assets record
`path`, `type: "third-party"`, `sourceUrl`, `author`, `license`, `sha256`, and
`redistributionPermission: true`. Any other permission value fails closed.
Human-facing context and modification notes remain in this document.
