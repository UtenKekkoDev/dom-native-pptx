# Source map

Verified 2026-07-18.

| Source | Role in this project |
|---|---|
| https://github.com/gitbrent/PptxGenJS | Native PPTX text, shapes, tables, charts, images, and package writing |
| https://gitbrent.github.io/PptxGenJS/docs/api-tables.html | Native table API reference |
| https://github.com/atharva9167j/dom-to-pptx | DOM traversal, computed-style mapping, width-buffer, and editable-first reference |
| https://www.npmjs.com/package/html-to-pptx | Declarative `data-pptx-chart-config` native-chart reference |
| https://html2pptx.app/docs/en | Public HTML/PPTX support-matrix and authoring-contract comparison |
| https://polotno.com/docs/pptx-export | Editable-first export strategy and explicit advanced-effect limitations |
| https://learn.microsoft.com/en-us/office/open-xml/presentation/overview | Microsoft PresentationML and slide text inspection reference |
| https://playwright.dev | Browser layout, screenshots, fonts, and asset readiness |
| https://sharp.pixelplumbing.com | PNG creation and image processing |
| https://github.com/mapbox/pixelmatch | Pixel-level visual comparison |

## Adaptation notes

The implementation is original glue and policy code built around public libraries. `dom-to-pptx` is installed as a reference dependency, not used as an unchecked exporter, because this project requires stricter fail-closed raster behavior and manifest/OOXML proof. PptxGenJS is the native object writer.
