# Releasing

Release Please owns version bumps, changelog updates, tags, and GitHub release
creation. After it creates a release, `.github/workflows/release-please.yml`
explicitly dispatches `.github/workflows/release.yml` at that tag to build,
sign, attest where GitHub supports it, upload the artifacts, and publish
`@0xjordan/ideality`. The version lives in `package.json` and flows into
`bunli.config.ts` and the CLI (`src/version.ts`) through imports.

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

If the workflow itself needed a fix after Release Please created an immutable
tag, run the corrected workflow from `main` while explicitly checking out that
tag:

```bash
gh workflow run release.yml --ref main -f release_tag=v0.2.0
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
5. For public repositories, creates GitHub
   [build provenance attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations)
   for the archives. GitHub does not provide this feature to user-owned
   private repositories; Sigstore signing remains mandatory in either case.
6. Publishes a GitHub release with all archives, checksums, and signature
   bundles, with generated release notes. Recovery reruns preserve assets
   already attached to the immutable tag and upload only missing names.
7. Publishes the dependency-free `@0xjordan/ideality` launcher to npm with
   provenance through npm trusted publishing. The package installs the signed
   native release matching its own version; its launcher repeats that verified
   bootstrap on first use when a package manager disabled lifecycle scripts.

## npm trusted publishing setup

The npm account or organization must own the `@0xjordan` scope. Configure a
trusted publisher for the `@0xjordan/ideality` package with:

- GitHub organization or user: `0xJord4n`
- Repository: `ideality`
- Workflow filename: `release.yml`
- Environment: leave empty
- Allowed action: `npm publish`

This is a one-time npm registry setting. The workflow uses GitHub OIDC and
`npm publish --access public`; do not add an npm access token or
`NODE_AUTH_TOKEN`. The GitHub release is created before npm publication so
the package's verified native artifacts already exist when consumers install
it. Recovery runs skip an npm version that is already published.

npm exposes trusted-publisher settings only after a package exists. For the
first release, let the workflow create the signed GitHub artifacts, publish
that exact version once from an authenticated maintainer checkout, configure
the trusted publisher immediately, then rerun the release workflow:

```bash
version="$(node -p 'require("./package.json").version')"
git fetch --tags origin
git switch --detach "v$version"
npm publish --access public --provenance=false --otp="<current npm 2FA code>"
npx --yes npm@latest trust github @0xjordan/ideality \
  --repo 0xJord4n/ideality \
  --file release.yml \
  --allow-publish \
  --yes
gh workflow run release.yml --ref "v$version"
```

The one-time terminal publish disables provenance because it has no CI OIDC
provider. The explicit CLI flag overrides the repository's
`publishConfig.provenance` setting. Complete npm's 2FA prompt when the
`npm trust` command creates the publisher relationship. Keep
`publishConfig.provenance` enabled: all later releases publish only through
OIDC in the workflow and receive npm provenance automatically.

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

# GitHub build provenance (public repositories)
gh attestation verify ideality-linux-x64.tar.gz --repo 0xJord4n/ideality
```

## Local dry runs

```bash
bun run release:rehearsal    # build the host archive, then prove checksums, archive
                             # layout, metadata verifier args, binary smoke, and installer offline
npm pack --dry-run           # inspect the exact public package file set
bun install --os '*' --cpu '*'   # once: native runtimes for every target platform
bun run build:release        # build all four archives + SHA256SUMS.txt + release-metadata.json
bash scripts/release-rehearsal.sh --no-build   # rehearse existing dist/release artifacts
bun run smoke                # smoke-test the dev entrypoint
bun run build:native         # compile dist/ideality for this machine
bash scripts/smoke.sh dist/ideality   # smoke-test the compiled binary
```

Cross-compilation happens on the Linux CI runner — Bun downloads the target
runtimes on demand, so no macOS builder is required.
