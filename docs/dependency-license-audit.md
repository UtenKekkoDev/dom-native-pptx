# Dependency license audit

Audit date: 2026-07-28.

The locked production graph contains 61 packages, including optional native
packages for platforms other than the current machine. The automated audit
resolves every package to either its lockfile metadata or its installed
license file.

Observed license families include MIT, Apache-2.0, ISC, 0BSD, Zlib
combinations, and the LGPL-3.0-or-later terms carried by Sharp/libvips binary
packages. `jszip` declares `MIT OR GPL-3.0-or-later`; this project uses it under
the MIT option.

This is a reproducible lockfile/install audit, not legal advice. Re-run on a
clean install before release and retain upstream notices for any binaries that
are redistributed.
