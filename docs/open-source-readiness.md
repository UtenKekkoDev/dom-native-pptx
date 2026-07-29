# Open-source readiness

Audit date: 2026-07-28. Local readiness checks are complete in this isolated
worktree. Publication of this audited source revision is still pending the Task
13 public sync/merge, and the npm package has not been published.

## Approved release decisions

- License: MIT, copyright `Yuxuan Sun`, 2026.
- Target public repository: `https://github.com/UtenKekkoDev/dom-native-pptx`.
- Planned npm package: unscoped `dom-native-pptx`.
- First public tag: `0.2.0-beta.1`; stable target: `0.2.0`.
- Node.js policy: Node.js 22 or newer.
- Full support: Windows 10/11 plus Microsoft PowerPoint Desktop.
- Experimental support: portable Node/Chromium conversion and OOXML checks on
  macOS and Linux. These platforms cannot provide the authoritative PowerPoint
  Desktop render gate.
- npm provenance is enabled in `publishConfig`; the eventual release workflow
  must use trusted publishing or an OIDC-capable GitHub Actions job.

## Current verified state

- The isolated release worktree builds and the automated Vitest suite runs
  locally on Windows.
- The complex-effects stress suite opens and renders eight slides through
  Microsoft PowerPoint.
- CI declares Windows, Linux, and macOS lanes for portable build, tests, and
  npm package inspection. Linux coverage replaces, rather than duplicates, the
  normal full-suite step; Vitest uses one fork worker and stops on first failure.
- Lint, Prettier, V8 coverage, deterministic tests, production-license audit,
  npm tarball verification, CodeQL, Dependabot, issue forms, and pull-request
  templates are configured.
- The publish allowlist contains compiled output and public user documents,
  while excluding source tests, examples, Skill internals, plans, caches, and
  generated artifacts from the npm tarball.
- Generated files, `.tmp`, `outputs`, `dist`, coverage, logs, and
  `node_modules` are ignored by Git.
- A quick secret scan found no obvious credentials in the current working
  tree. Repeat the scan immediately before every public push and separately
  audit Git history.
- The locked production graph contains 61 packages and the reproducible
  license audit resolves all of them. Sharp/libvips combined LGPL terms are
  recorded explicitly.
- `npm audit --omit=dev` reports zero production vulnerabilities. The current
  full development-tree audit reports high-severity advisories in transitive
  development tooling; consult the release-time audit output and weekly
  Dependabot updates for the current count. These are not described as
  production runtime exposure.
- The only tracked generated binary media are the two registered README
  evidence PNGs, `docs/assets/demo-html.png` and
  `docs/assets/demo-powerpoint.png`. Their sources, reproduction commands,
  ownership, dimensions, and digests are governed by
  `docs/asset-provenance.md` and `docs/asset-provenance.json`. The tracked
  source contains no other binary images, fonts, PDFs, PPTX files, or remote
  image dependencies.

## Include and exclude plan

The public Git repository may include source, tests, examples, the Agent Skill,
public architecture and policy documents, stress fixtures, CI configuration,
and the two registered README evidence PNGs.

The npm package includes only `dist`, README, LICENSE, third-party notices, and
the public architecture, raster, CSS, security, and source-map reference
documents. Every local document linked from the packaged README is included.

Exclude unregistered binary media and generated PPTX/PNG/HTML outputs other
than the two registered README evidence PNGs. Also exclude caches,
dependencies, logs, customer decks, private briefs, local attachments,
machine-specific working files, and historical plans containing personal
absolute paths.

## Pending GitHub source-release gates

- In Task 13, sync and merge a clean audited snapshot instead of private
  development history; `docs/superpowers` must remain absent.
- Verify the candidate public tree includes source, tests, examples, Skill
  files, documentation, quality configuration, CI, license, and notices from
  the approved revision.
- Verify generated outputs, dependencies, caches, historical plans, and private
  or customer material remain excluded.
- Re-run secret and path checks against the exact candidate tree, then verify
  the published revision on the target repository's `main` branch.

## Reproducible GitHub hardening

`scripts/configure-github.mjs` codifies the public repository settings without
making its default command destructive. The command below is a local dry run:
it does not invoke `gh`, inspect authentication, or send any API request. Its
JSON output contains only the public target and deterministic settings payloads.

```powershell
node scripts/configure-github.mjs --repo UtenKekkoDev/dom-native-pptx
```

Task 13 may add `--apply` only after the public pull request checks have produced
the three required status names. Before its first write, apply mode verifies the
authenticated account is `UtenKekkoDev`, the repository identity is exactly
`UtenKekkoDev/dom-native-pptx`, visibility is public, and the default branch is
`main`. It then enables dependency alerts, Dependabot security updates, private
vulnerability reporting, the declared topics and repository features, and
creates or updates the named `protect-main` ruleset instead of duplicating it.
Repository features use the repository PATCH endpoint, while topics use the
dedicated replace-all topics endpoint. Ruleset discovery requests every page
before deciding whether to create or update. Each required matrix check is
bound to the GitHub Actions public app (`integration_id: 15368`) instead of
accepting the same check name from any writer.

Repository rulesets and protected branches are available for public repositories
on GitHub Free. Secret scanning and push protection are requested separately
because their API availability can vary by repository and account capability.
Only GitHub's explicit 422 capability statement that secret scanning or push
protection is not available, paired with the official update-repository REST
documentation URL, is reported as `unsupported`. Rate limits, permission
failures, not-found responses, validation errors, and unrecognized sources fail
closed with a sanitized nonzero result. No token, cookie, authorization header,
or raw GitHub error body is included in normal or failure output.
The transport reads GitHub's structured error JSON from `gh api` stdout because
stderr may contain only a short HTTP summary. It retains only the numeric status,
an allowlisted capability statement, an official GitHub Docs URL, and error
resource/field/code identifiers; arbitrary fields and error values are dropped.

```powershell
node scripts/configure-github.mjs --repo UtenKekkoDev/dom-native-pptx --apply
```

Do not run apply mode from this isolated implementation task. It is reserved for
the reviewed Task 13 release sequence, followed by an independent settings audit.

## Isolated public clone setup

Run `node scripts/setup-public-clone.mjs` only after the target public repository
is available and authentication is verified. It reports the private branch and
dirty-file count, then clones or validates the public destination, requires a
clean `main` checkout with a matching `origin`, fetches `main`, and only then
removes matching public push remotes from the private repository.

The public URL must not contain credentials, a query string, or a fragment.
HTTPS and SSH GitHub URL forms are compared as the same repository. A dirty
destination, a different owner/repository origin, or an unexpected default
branch stops before private remotes are changed. Private branches and working
files are never changed by this command.

```powershell
node scripts/setup-public-clone.mjs --private-repo <private-repo> --public-url <public-repo-url> --destination <public-clone>
```

After successful setup, inspect both remote configurations and the public clone
status before any source synchronization or push. Do not use credential-bearing
URLs: the CLI fails closed and does not echo them.

## Remaining npm publication gates

- Confirm the npm name is still available immediately before publication.
- Configure npm trusted publishing/OIDC for the GitHub repository.
- Publish `0.2.0-beta.2` with the `beta` dist-tag before any stable release.
- Install the resulting tarball in a clean consumer project and test both the
  CLI and public library API.

## P1 engineering work

- Add an OIDC npm release workflow after branch protection is configured.
- Split portable tests from PowerPoint COM tests with stable tags and publish
  both result summaries.
- Document semantic versioning, deprecation policy, and compatibility promises
  for HTML attributes and chart JSON.
- Add a reproducible release checklist for the npm publishing gate.

## P2 hardening

- Add fuzz and property tests for malformed HTML, extreme coordinates, nested
  stacking contexts, large decks, and hostile SVG/canvas content.
- Add performance benchmarks for snapshot, raster capture, package writing,
  OOXML validation, and PowerPoint rendering.
- Add golden files for PowerPoint versions and common installed font sets.
- Add a threat model for local file URLs, remote assets, browser execution,
  SVG, and untrusted HTML before accepting arbitrary third-party input.

## Release gates

The GitHub source release and npm package publication are separate gates. A
sanitized source snapshot may be published once its exact tree passes the
secret, path, build, test, and package checks. npm publication waits for the
npm-specific gates above. The Windows PowerPoint render remains mandatory for
both release decisions even when all portable CI lanes pass.
