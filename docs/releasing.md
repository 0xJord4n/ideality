# Releasing

Releases are built, signed, and published by `.github/workflows/release.yml`
whenever a `v*` tag is pushed. Version `0.1.0` lives in one place —
`package.json` — and flows into `bunli.config.ts` and the CLI (`src/version.ts`)
through imports, so a release only ever bumps `package.json`.

## Cutting a release

1. Bump the version (edits `package.json` only):

   ```bash
   bun run version:patch   # or version:minor / version:major
   ```

2. Commit the bump and tag it with the same version, `v`-prefixed:

   ```bash
   git commit -am "release: v$(grep -m1 '"version":' package.json | cut -d '"' -f 4)"
   git tag "v$(grep -m1 '"version":' package.json | cut -d '"' -f 4)"
   git push origin main --follow-tags
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
