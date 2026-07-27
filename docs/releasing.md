# Releasing

Release Please owns version bumps, changelog updates, tags, and GitHub release
creation. After it creates a release, `.github/workflows/release-please.yml`
explicitly dispatches `.github/workflows/release.yml` at that tag to build,
sign, attest, and upload the artifacts. The version lives in `package.json`
and flows into `bunli.config.ts` and the CLI (`src/version.ts`) through
imports.

## Cutting a release

1. Merge Conventional Commit changes to `main`. Release Please derives the
   next version and changelog entries from `feat:`, `fix:`, `docs:`, and
   breaking-change markers.
2. Review the open `autorelease: pending` pull request. Its explicitly
   dispatched CI, quality, catalog, and security workflows must pass.
3. Merge the Release Please pull request. Release Please updates
   `CHANGELOG.md` and `package.json`, creates the tag and GitHub release, and
   dispatches the artifact workflow at that tag.

Do not bump or tag a normal release manually. For recovery after Release
Please has already created a matching tag, dispatch the artifact workflow
explicitly:

```bash
gh workflow run release.yml --ref v0.2.0
```

The release workflow refuses to run if the tag does not match
`package.json` — a mismatched tag fails fast before anything is published.

## What the workflow publishes

For each release the `release` job:

1. Runs `bun run check` (typecheck + tests) as a final gate.
2. Builds standalone binaries for `linux-x64`, `linux-arm64`, `darwin-x64`,
   and `darwin-arm64` via `scripts/build-release.sh`, packaged as
   `ideality-<target>.tar.gz` (each contains a single `ideality` binary),
   and generates `SHA256SUMS.txt` plus `release-metadata.json` over those
   exact archives.
3. Rehearses the release offline (`scripts/release-rehearsal.sh
   --no-build`): verifies every archive against `SHA256SUMS.txt`, checks
   `release-metadata.json` matches the package version, archive list, and
   checksums, checks each archive contains exactly one `ideality` member,
   smoke-tests the extracted Linux binary end to end (`scripts/smoke.sh`:
   init → status → run → setup → rollback in an isolated temporary HOME),
   installs from the artifacts with `scripts/install.sh` over `file://` using
   a controlled fake cosign verifier for the metadata bundle — all before
   anything is signed or published.
4. Signs every archive and the checksum manifest with
   [Sigstore cosign](https://docs.sigstore.dev/) keyless signing, producing
   `<artifact>.sigstore.json` bundles. `release-metadata.json` is signed too;
   the installer and `ideality update` verify
   `release-metadata.json.sigstore.json` before trusting archive checksums.
5. Creates GitHub [build provenance attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations)
   for the archives.
6. Publishes a GitHub release with all archives, checksums, and signature
   bundles, with generated release notes.

## Verifying a release

Consumers can verify artifacts three independent ways:

```bash
# Checksums
sha256sum -c --ignore-missing SHA256SUMS.txt

# Sigstore signature (keyless; identity is the release workflow)
cosign verify-blob \
  --bundle ideality-linux-x64.tar.gz.sigstore.json \
  --certificate-identity-regexp 'https://github.com/0xJord4n/ideality/\.github/workflows/release\.yml.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ideality-linux-x64.tar.gz

# GitHub build provenance
gh attestation verify ideality-linux-x64.tar.gz --repo 0xJord4n/ideality
```

## Local dry runs

```bash
bun run release:rehearsal    # build the host archive, then prove checksums, archive
                             # layout, metadata verifier args, binary smoke, and installer offline
bun install --os '*' --cpu '*'   # once: native runtimes for every target platform
bun run build:release        # build all four archives + SHA256SUMS.txt + release-metadata.json
bash scripts/release-rehearsal.sh --no-build   # rehearse existing dist/release artifacts
bun run smoke                # smoke-test the dev entrypoint
bun run build:native         # compile dist/ideality for this machine
bash scripts/smoke.sh dist/ideality   # smoke-test the compiled binary
```

Cross-compilation happens on the Linux CI runner — Bun downloads the target
runtimes on demand, so no macOS builder is required.
