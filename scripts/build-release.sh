#!/usr/bin/env bash
# Build release archives for every supported platform.
#
# Produces dist/release/ideality-<target>.tar.gz, each containing a single
# `ideality` binary, plus dist/release/SHA256SUMS.txt.
#
# Usage: scripts/build-release.sh [target ...]
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

targets=("$@")
if [ "${#targets[@]}" -eq 0 ]; then
  targets=(linux-x64 linux-arm64 darwin-x64 darwin-arm64)
fi

# Stage binaries outside dist/ -- bunli build cleans its outdir (./dist) at
# the start of every invocation, so anything kept there is wiped by the
# next target's build.
staging="$(mktemp -d)"
cleanup() { rm -rf "$staging"; }
trap cleanup EXIT

for target in "${targets[@]}"; do
  echo "==> Building $target"
  mkdir -p "$staging/$target"
  bun x bunli build --targets "$target" --outfile "$staging/$target/ideality"
done

release_dir="dist/release"
rm -rf "$release_dir"
mkdir -p "$release_dir"

for target in "${targets[@]}"; do
  tar -C "$staging/$target" -czf "$release_dir/ideality-$target.tar.gz" ideality
done

cd "$release_dir"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum ideality-*.tar.gz > SHA256SUMS.txt
else
  shasum -a 256 ideality-*.tar.gz > SHA256SUMS.txt
fi

echo "==> Release artifacts"
ls -l
cat SHA256SUMS.txt
