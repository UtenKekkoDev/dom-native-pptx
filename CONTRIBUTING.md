# Contributing to dom-native-pptx

Thank you for helping improve `dom-native-pptx`. This project converts
slide-safe HTML into native, editable PowerPoint objects; changes must preserve
the fail-closed security and native-text guarantees.

## Development setup

Use Node.js 22+ and install the repository dependencies and Chromium:

```powershell
npm install
npx playwright install chromium
npm run build
npm run test:run
```

Make each change test-first when practical: add or update a failing **RED**
test, implement the smallest change that makes it **GREEN**, then run the
relevant test suite and build before opening a pull request.

## Security and fixtures

Safe mode is the supported default. It must continue to block remote resources,
path escapes, scripts, and other unsupported browser behavior. Trusted mode is
only for user-authored or audited HTML and must never be presented as safe for
untrusted input. See [SECURITY.md](SECURITY.md) for the vulnerability policy
and reporting path.

Before attaching an HTML reproduction, minimize it to the smallest synthetic
example that demonstrates the problem. Confirm that it contains no private,
customer, uploaded, licensed, credential-bearing, or otherwise sensitive data.
Never add customer or private fixtures to the repository, an issue, or a pull
request.

## Conversion and release QA

Keep semantic text, table data, chart values, sources, and page numbers native
in PowerPoint. Any raster change must comply with
[RASTER_POLICY.md](RASTER_POLICY.md).

Before a release, maintainers must run the applicable structural validation and
PowerPoint render QA on the supported Windows reference environment. Release QA
includes checking conversion manifests and validation reports, editability,
raster-policy compliance, typography and layer order, and the authoritative
Microsoft PowerPoint render. Pixel diffs are diagnostic evidence, not the sole
release decision.
