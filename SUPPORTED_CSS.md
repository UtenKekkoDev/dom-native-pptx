# Supported CSS and objects

| Feature                              | Status                           | Output                                  |
| ------------------------------------ | -------------------------------- | --------------------------------------- |
| Absolute positioning                 | Supported                        | Native coordinates                      |
| Flexbox / Grid                       | Supported after browser layout   | Native coordinates                      |
| Font family / size / weight / style  | Supported                        | Native text                             |
| Solid text color                     | Supported                        | Native text                             |
| Text alignment                       | Supported                        | Native text                             |
| Solid background                     | Supported                        | Native rectangle                        |
| Uniform border                       | Supported                        | Native rectangle line                   |
| Border radius                        | Approximate                      | Rectangle plus warning                  |
| Native tables                        | Supported                        | Editable table                          |
| Bar / column / line / pie / doughnut | Supported through chart contract | Editable chart                          |
| Photos / illustrations               | Explicit whitelist only          | Image                                   |
| Logo / brand lockup                  | Explicit whitelist only          | Image                                   |
| Gradients / filters / masks          | Not native in MVP                | Isolate as authorized decorative raster |
| Mixed rich-text spans                | Limited                          | Prefer separate explicit text nodes     |
| Lists                                | Limited                          | Author as explicit text blocks          |
| Animations / video                   | Not supported                    | Reject or redesign                      |
| SVG/canvas semantic text             | Forbidden                        | Rewrite as native text                  |
| Full-slide screenshot                | Forbidden                        | Conversion failure                      |

Typography uses the slide scale: 1920 CSS pixels map to 13.333 inches, so one CSS pixel maps to approximately 0.5 PowerPoint point. Intrinsic-width text receives a small width safety buffer to avoid cross-renderer wrapping differences.
