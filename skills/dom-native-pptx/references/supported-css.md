# Supported CSS

## Native mapping

| CSS / HTML | PowerPoint output | Notes |
|---|---|---|
| Absolute, flex, grid geometry | Native object coordinates | Chromium resolves layout first |
| Font family, size, weight, style | Native text | Uses slide-scale px→pt conversion |
| Text color and alignment | Native text | Left, center, right, justify |
| Background color | Native rectangle | Solid fills |
| Border color and width | Native rectangle line | Uses top border as current uniform approximation |
| `<table>` | Native table | Editable cells |
| Chart JSON contract | Native chart | Editable series and categories |
| Explicit raster asset | PowerPoint image | Only after policy approval |

## Approximated

- Non-zero `border-radius` is currently recorded as a warning and rendered as a rectangle.
- Different border styles per side are approximated with one uniform line.
- Browser line height and PowerPoint font metrics may differ slightly.
- Shadows, gradients, clipping, filters, masks, and complex transforms are not converted as native shapes in the current version.

## Use an authorized raster only when needed

Complex visual-only effects may be captured as `illustration` or `decorative-composite`. Keep all semantic text outside the capture node.

## Unsupported as semantic output

- Text converted to SVG paths
- Canvas-rendered text
- Full-slide screenshots
- CSS pseudo-element text used as content
- Image-only tables or charts

If protected text depends on one of these patterns, rewrite the HTML structure or stop with a conversion error.
