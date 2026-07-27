# DOM Native PPTX

`dom-native-pptx` converts slide-safe HTML into native, editable PowerPoint
objects. It is fail-closed by design: titles, body copy, numbers, tables,
chart labels, sources, footnotes, and page numbers may never silently become
SVG, PNG, or a full-slide screenshot.

> Public beta `0.2.0-beta.1` is distributed through
> [GitHub Packages](https://github.com/users/UtenKekkoDev/packages?repo_name=dom-native-pptx)
> and [GitHub Releases](https://github.com/UtenKekkoDev/dom-native-pptx/releases).

## Platform support

| Capability                                   | Windows 10/11 |         macOS |         Linux |
| -------------------------------------------- | ------------: | ------------: | ------------: |
| Node/Chromium DOM conversion                 |     Supported |  Experimental |  Experimental |
| OOXML structural validation                  |     Supported |  Experimental |  Experimental |
| Authoritative Microsoft PowerPoint render QA |     Supported | Not available | Not available |

The supported reference environment is Node.js 22+, Windows 10/11, and
Microsoft PowerPoint Desktop. Fonts used by the source HTML must be installed
locally. Portable conversion and validation run in CI on Windows, macOS, and
Linux, but only the Windows PowerPoint render is considered authoritative.

## Local install

```powershell
Set-Location path\to\dom-native-pptx
npm install
npx playwright install chromium
npm run build
npm run test:run
```

## Install the public beta

GitHub Packages requires npm authentication, including for public packages.
Log in with your GitHub username and a classic personal access token with the
`read:packages` scope, then install the scoped package:

```sh
npm login --scope=@utenkekkodev --auth-type=legacy --registry=https://npm.pkg.github.com
npm install @utenkekkodev/dom-native-pptx@beta
```

The unscoped `dom-native-pptx` name is reserved for a future npmjs release and
is not published there yet. Each GitHub Release also includes an installable
scoped package tarball and `SHA256SUMS.txt`.

## HTML contract

```html
<section class="pptx-slide">
  <h1 data-pptx-text-role="title">Native editable title</h1>
  <p data-pptx-text-role="body">Native editable body copy</p>
</section>
```

Each `.pptx-slide` must be exactly `1920 × 1080` CSS pixels.

## Commands

```powershell
npm run pptx:validate -- examples/01-basic-text/slides.html
npm run pptx:export -- examples/10-full-business-deck/slides.html --output outputs/demo-business-deck.pptx
npm run pptx:inspect -- outputs/demo-business-deck.pptx
npm run pptx:render-html -- examples/10-full-business-deck/slides.html --output outputs/html-render
npm run pptx:render-powerpoint -- -Pptx outputs/demo-business-deck.pptx -OutputDir outputs/powerpoint-render
npm run pptx:compare -- outputs/html-render/slide-001.png outputs/powerpoint-render/slide-001.png --output outputs/diff/slide-001.png
```

On npm for Windows, `--output` may be consumed by npm itself. The CLI also
accepts the output path as the final positional argument.

## Library API

```ts
import { exportDeck, inspectPptx } from "@utenkekkodev/dom-native-pptx";

const result = await exportDeck({
  input: "slides.html",
  output: "slides.pptx",
});

const validation = await inspectPptx(result.output, result.manifestPath);
```

## Output objects

| HTML source                             | PPTX output             | Editable |
| --------------------------------------- | ----------------------- | -------: |
| Heading, paragraph, or number           | Native text box         |      Yes |
| Solid background or border              | Native shape            |      Yes |
| Semantic `<table>`                      | Native PowerPoint table |      Yes |
| `data-pptx-chart-config`                | Native PowerPoint chart |      Yes |
| Authorized photo, illustration, or logo | Image                   |       No |
| Full slide or protected text capture    | Rejected                |      N/A |

## Raster policy

Raster output requires both an explicit flag and an approved role. See
[RASTER_POLICY.md](RASTER_POLICY.md). A raster container containing protected
text aborts before a successful PPTX is returned.

## Validation

Every successful export automatically creates:

- `.pptx`
- `.conversion-manifest.json`
- `.validation.json`
- `.validation.html`

The OOXML audit confirms native text, chart values, authorized media, and the
absence of full-slide pictures. Microsoft PowerPoint rendering remains the
final authority. Maintainers on Windows can run the repeatable eight-slide
complex-effects suite:

```powershell
npm run test:stress
```

Structural validity, editability, raster policy, typography, layer order, and
a successful PowerPoint render are release gates. Pixel diffs are diagnostic
evidence rather than an automatic pass/fail threshold.

## Design and limitations

Read [ARCHITECTURE.md](ARCHITECTURE.md),
[SUPPORTED_CSS.md](SUPPORTED_CSS.md), and [SOURCE_MAP.md](SOURCE_MAP.md).

## License

MIT © 2026 Yuxuan Sun. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
