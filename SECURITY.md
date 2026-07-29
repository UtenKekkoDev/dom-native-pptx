# Security model

`dom-native-pptx` is a local HTML-to-PowerPoint converter. It opens the input
in Chromium so CSS can be laid out and, in narrowly approved cases, visual
assets can be captured. Treat the input HTML and every browser-loaded asset as
part of the conversion boundary.

## Supported default: safe mode

Safe mode is the supported default. It disables page JavaScript and allows
only local files that resolve inside the directory containing the input HTML,
plus `data:image/*` and `data:font/*` URLs. Remote URLs, local path escapes,
iframes, document data URLs, popups, downloads, and service workers are not a
supported input path.

Keep a deck self-contained: remote images, fonts, stylesheets, and other
assets should be vendored beside the input HTML (or in its child directories)
and referenced with relative paths. The input directory is the local-directory
boundary; a sibling, parent, symlink target, or absolute path outside it is
rejected.

## Explicit trusted mode

Trusted mode is an opt-in compatibility path for **trusted HTML** only, limited
to user-authored or audited HTML. It enables JavaScript and permits remote
resources so dynamic decks can settle. Use it explicitly:

```powershell
dom-native-pptx export slides.html --output slides.pptx --trusted
```

or:

```ts
await exportDeck({
  input: "slides.html",
  output: "slides.pptx",
  securityMode: "trusted",
});
```

Trusted mode does **not** make untrusted HTML safe. Do not use it for uploaded,
third-party, or otherwise unreviewed HTML. It is also not an OS sandbox, a
network isolation guarantee, or a claim of platform support beyond the
project's documented conversion and QA environments. Iframes, popups,
downloads, service workers, unsafe data URLs, and timeouts remain guarded in
both modes.

## Failure behavior

Security failures stop conversion; the CLI returns no successful result and
library callers receive `SecurityPolicyError`. Errors are structured and are
sanitized before the CLI writes them: URL credentials, query strings, fragments,
data payloads, and absolute local paths are not reported verbatim.

Each security error includes `code`, `resourceType`, `resourceLocation`,
`inputPath`, `securityMode`, and `suggestedRepair`. The stable error-code
vocabulary is:

| Code                               | Meaning                                                                   | Typical repair                                                         |
| ---------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `SECURITY_REMOTE_RESOURCE_BLOCKED` | Safe mode encountered a remote resource.                                  | Vendor it beside the input, or use trusted mode only for audited HTML. |
| `SECURITY_LOCAL_PATH_ESCAPE`       | A local resource resolves outside the input directory.                    | Move it inside the input directory.                                    |
| `SECURITY_IFRAME_BLOCKED`          | An iframe or subframe navigation was requested.                           | Replace it with static local content.                                  |
| `SECURITY_DATA_URL_BLOCKED`        | A data URL is not an image or font.                                       | Use a local asset or an allowed image/font data URL.                   |
| `SECURITY_TRUSTED_MODE_REQUIRED`   | A caller's integration requires an explicit trusted-mode acknowledgement. | Audit the HTML and set `securityMode: "trusted"` deliberately.         |
| `SECURITY_RESOURCE_TIMEOUT`        | Images or fonts did not settle before the configured timeout.             | Fix the asset or increase the timeout for an audited input.            |

`SECURITY_TRUSTED_MODE_REQUIRED` is reserved in the public structured-error
contract for integrations that demand an explicit trust acknowledgement; the
built-in CLI reports `SECURITY_REMOTE_RESOURCE_BLOCKED` when safe mode blocks a
remote resource.

### CLI caller example

Safe mode rejects a remote image and exits nonzero:

```json
{
  "ok": false,
  "error": {
    "code": "SECURITY_REMOTE_RESOURCE_BLOCKED",
    "resourceType": "image",
    "resourceLocation": "https://cdn.example.com/logo.png",
    "securityMode": "safe",
    "suggestedRepair": "Download the resource into the input HTML directory or use trusted mode for audited HTML."
  }
}
```

### Library caller example

```ts
import { exportDeck, SecurityPolicyError } from "dom-native-pptx";

try {
  await exportDeck({ input: "slides.html", output: "slides.pptx" });
} catch (error) {
  if (error instanceof SecurityPolicyError) {
    console.error(error.details.code, error.details.suggestedRepair);
  }
  throw error;
}
```

## Native-text and raster policy

Security mode does not relax the conversion policy. Protected semantic text
must remain native PowerPoint text, tables, or chart data. A visual-only raster
still needs both explicit raster attributes and an approved role; an allowed
raster container with protected text stops conversion. See
[RASTER_POLICY.md](RASTER_POLICY.md).
