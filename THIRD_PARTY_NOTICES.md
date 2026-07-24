# Third-Party Notices

`dom-native-pptx` depends on third-party open-source packages. Their own
licenses and copyright notices remain in force.

## Direct runtime dependencies

| Package | Declared license |
|---|---|
| commander | MIT |
| dom-to-pptx | MIT |
| fast-xml-parser | MIT |
| fontkit | MIT |
| jszip | MIT OR GPL-3.0-or-later; this project uses it under the MIT option |
| pixelmatch | ISC |
| playwright | Apache-2.0 |
| pngjs | MIT |
| pptxgenjs | MIT |
| sharp | Apache-2.0 |
| zod | MIT |

Development dependencies include software under MIT, Apache-2.0, ISC, and
other permissive licenses. The authoritative texts are distributed by those
packages in `node_modules` and their upstream repositories.

## Notable transitive packages

- `sharp` installs platform-specific `@img/sharp-*` and
  `@img/sharp-libvips-*` binary packages. Their package metadata includes
  Apache-2.0 and/or LGPL-3.0-or-later terms. The upstream license files and
  notices must remain available with distributions that include those
  binaries.
- `fonteditor-core`, reached through `dom-to-pptx`, does not declare a license
  field in the lockfile used for this audit. Its installed `LICENSE` file is
  the MIT License, copyright 2014 ecomfe.

Run `npm run audit:licenses` after a clean install to reproduce the production
dependency summary and fail if any license remains unresolved.

This notice is a release aid, not a replacement for a complete dependency and
source-provenance audit. Run the repository's license and secret checks again
immediately before a public release.
