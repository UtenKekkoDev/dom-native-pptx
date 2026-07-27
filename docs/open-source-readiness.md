# Open-source readiness

Audit date: 2026-07-27. This document records the approved publication policy,
the live GitHub release channels, and the remaining npmjs release gates.

## Approved release decisions

- License: MIT, copyright `Yuxuan Sun`, 2026.
- Public repository: `https://github.com/UtenKekkoDev/dom-native-pptx`.
- GitHub Package: `@utenkekkodev/dom-native-pptx`.
- Reserved npmjs package: unscoped `dom-native-pptx`.
- First public tag: `v0.2.0-beta.1`; stable target: `v0.2.0`.
- Node.js policy: Node.js 22 or newer.
- Full support: Windows 10/11 plus Microsoft PowerPoint Desktop.
- Experimental support: portable Node/Chromium conversion and OOXML checks on
  macOS and Linux. These platforms cannot provide the authoritative PowerPoint
  Desktop render gate.
- GitHub Packages and Releases are published from version tags by GitHub
  Actions with the repository-scoped `GITHUB_TOKEN`.
- npm provenance remains enabled in `publishConfig` for a future npmjs release,
  which must use trusted publishing or an OIDC-capable GitHub Actions job.

## Current verified state

- The repository builds and the automated Vitest suite runs locally on
  Windows.
- The complex-effects stress suite opens and renders eight slides through
  Microsoft PowerPoint.
- CI declares Windows, Linux, and macOS lanes for portable build, tests, and
  npm package inspection.
- The publish allowlist contains compiled output and public user documents,
  while excluding source tests, examples, Skill internals, plans, caches, and
  generated artifacts from the npm tarball.
- Generated files, `.tmp`, `outputs`, `dist`, coverage, logs, and
  `node_modules` are ignored by Git.
- A quick secret scan found no obvious credentials in the current working
  tree. Repeat the scan immediately before every public push and separately
  audit Git history.
- The locked production graph contains 113 packages and the reproducible
  license audit resolves all of them. Sharp/libvips combined LGPL terms and the
  `fonteditor-core` MIT license-file fallback are recorded explicitly.
- The tracked source contains no binary media, fonts, PDFs, PPTX files, or
  remote image dependencies. See `docs/asset-provenance.md`.

## Include and exclude plan

The public Git repository may include source, tests, examples, the Agent Skill,
public architecture and policy documents, stress fixtures, and CI
configuration.

The npm package includes only `dist`, README, LICENSE, third-party notices, and
the public architecture/raster/CSS reference documents.

Exclude generated PPTX/PNG/HTML reports, caches, dependencies, logs, customer
decks, private briefs, local attachments, machine-specific working files, and
historical plans containing personal absolute paths.

## GitHub source-release gate

- Publish a clean single-commit snapshot instead of the private development
  history. The private history contains machine-specific paths in historical
  plans; `docs/superpowers` must not be present in the public snapshot.
- Include source, tests, examples, Skill files, public documentation, CI,
  license, and notices from the current committed revision.
- Exclude uncommitted working files, generated outputs, dependencies, caches,
  historical plans, and all private/customer material.
- Re-run the secret scan against the exact snapshot and verify the repository
  is public with `main` as its default branch after pushing.

## GitHub package and release automation

- A `v*` tag starts a clean Linux build, production dependency audit,
  dependency license audit, portable tests, and package allowlist check.
- The tag must exactly match the version in `package.json`.
- GitHub Packages receives the required scoped name while the source package
  retains the reserved unscoped npmjs name.
- GitHub Releases receives the same scoped npm tarball and `SHA256SUMS.txt`.
- Beta versions publish with the `beta` dist-tag and as GitHub prereleases.

## Remaining npmjs publication gates

- Confirm the npm name is still available immediately before publication.
- Configure npm trusted publishing/OIDC for the GitHub repository.
- Publish `0.2.0-beta.1` to npmjs with the `beta` dist-tag before any stable
  npmjs release.
- Install the resulting tarball in a clean consumer project and test both the
  CLI and public library API.

## P1 engineering work

- Add an npmjs trusted-publishing workflow after the package name and publisher
  settings are confirmed.
- Split portable tests from PowerPoint COM tests with stable tags and publish
  both result summaries.
- Add Dependabot or Renovate and document the lockfile update policy.
- Add issue templates for fidelity bugs with source HTML, browser render,
  PowerPoint render, manifest, and validation report fields.
- Document semantic versioning, deprecation policy, and compatibility promises
  for HTML attributes and chart JSON.
- Add `CONTRIBUTING.md`, `SECURITY.md`, a code of conduct, and a reproducible
  release checklist.

## P2 hardening

- Add fuzz and property tests for malformed HTML, extreme coordinates, nested
  stacking contexts, large decks, and hostile SVG/canvas content.
- Add performance benchmarks for snapshot, raster capture, package writing,
  OOXML validation, and PowerPoint rendering.
- Add golden files for PowerPoint versions and common installed font sets.
- Add a threat model for local file URLs, remote assets, browser execution,
  SVG, and untrusted HTML before accepting arbitrary third-party input.

## Release gates

GitHub Packages/Releases and npmjs publication are separate gates. A version
tag may publish to GitHub after its exact tree passes the secret, path, build,
test, and package checks. npmjs publication waits for the npmjs-specific gates
above. The Windows PowerPoint render remains mandatory for stable release
decisions even when all portable CI lanes pass.
