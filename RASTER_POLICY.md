# Raster policy

The converter denies raster output by default.

## Approved declaration

```html
<div
  data-pptx-raster="allowed"
  data-pptx-raster-role="photo"
></div>
```

Approved roles:

- `logo`
- `brand-lockup`
- `photo`
- `illustration`
- `decorative-composite`

Only `brand-lockup` may contain unmarked wordmark text. Any semantic tag or `data-pptx-text-role` inside any raster container causes failure.

## Protected text

Protected content includes headings, body text, captions, KPI values, table cells, chart labels, footnotes, sources, footers, and page numbers. It must become native text/table/chart data.

## Failure report

Policy errors include:

- slide number
- DOM selector
- text preview
- reason
- suggested repair

The repair is normally to move text outside the raster node and map it as native PowerPoint text.
