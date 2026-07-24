# Raster policy

Rasterization is deny-by-default.

## Required attributes

```html
data-pptx-raster="allowed"
data-pptx-raster-role="photo"
```

Approved roles:

- `logo`: graphic mark without visible text
- `brand-lockup`: logo plus non-semantic wordmark
- `photo`: photographic or photo-like visual without text
- `illustration`: visual illustration without semantic text
- `decorative-composite`: unsupported visual effects without semantic text

## Always reject

- Missing `data-pptx-raster="allowed"`
- Unknown role
- Heading, paragraph, list, table, caption, or explicit text role inside the capture
- KPI, chart label, footnote, source, footer, or page number inside the capture
- Entire-slide image capture
- Full-page PDF or slide render used behind opaque cleanup masks
- A caption mask that covers screenshot controls, timelines, labels, or thumbnails

## Correct separation

```html
<section class="pptx-slide">
  <h1 data-pptx-text-role="title">原生标题</h1>
  <div
    class="complex-effect"
    data-pptx-raster="allowed"
    data-pptx-raster-role="decorative-composite"
  ></div>
</section>
```

## Incorrect

```html
<div data-pptx-raster="allowed" data-pptx-raster-role="photo">
  <p data-pptx-text-role="body">这段正文不能成为图片。</p>
</div>
```

The incorrect example must fail before PPTX writing.

For source reconstruction, crop the approved photo, logo, or screenshot itself. Rebuild the surrounding background and protected text natively. Do not use a full-slide render as a hidden recovery layer.

## Transparent capture

- Capture only the authorized element while page, body, and slide backgrounds are temporarily transparent.
- Hide non-target slide elements so overlapping sibling text or graphics cannot be baked into the capture.
- Normalize low-alpha background contamination after capture.
- When the element has transparent corners, verify corner alpha is zero before embedding it in PowerPoint.
- Treat any rectangular halo or backing plate absent from the source as a failed conversion.
