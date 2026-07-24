# HTML authoring contract

## Canvas

- Use `.pptx-slide` for every slide.
- Use exactly `width: 1920px; height: 1080px`.
- Set `position: relative` and `overflow: hidden`.
- Use local files, data URIs, or absolute URLs for assets.

## Semantic text

Mark important text explicitly:

```html
<h1 data-pptx-text-role="title">原生标题</h1>
<p data-pptx-text-role="body">原生正文</p>
<p data-pptx-text-role="number">43%</p>
<p data-pptx-text-role="source">来源：内部数据</p>
```

Allowed roles:

`title`, `subtitle`, `body`, `caption`, `number`, `table-cell`, `chart-label`, `footnote`, `footer`, `page-number`, `source`.

The converter also protects visible `h1-h6`, `p`, `li`, `blockquote`, `th`, `td`, `caption`, and `figcaption` text when an explicit role is absent.

## Native tables

Use a semantic table:

```html
<table>
  <thead><tr><th>地区</th><th>收入</th></tr></thead>
  <tbody><tr><td>亚太</td><td>8.6M</td></tr></tbody>
</table>
```

Rows must have equal column counts. Table text is audited in slide OOXML.

## Native charts

Use JSON in `data-pptx-chart-config`:

```html
<div data-pptx-chart-config='{
  "type":"line",
  "data":[
    {"name":"用户","labels":["1月","2月"],"values":[100,130]}
  ],
  "showLegend":true,
  "showValue":true
}'></div>
```

Supported types: `bar`, `column`, `line`, `pie`, `doughnut`. Every series must have a name, at least one label/value, and matching label/value counts.

## Layout guidance

- Prefer absolute positioning, flexbox, or grid.
- Use common Windows fonts for predictable PowerPoint rendering.
- Keep text containers explicit and avoid relying on browser-only overflow behavior.
- Give each text container at least its computed line height per rendered line; use `min-height: 1.2em` for a one-line box unless the measured source requires more.
- Separate a decorative raster node from semantic siblings.
- Give important elements stable IDs for clear manifest selectors.
