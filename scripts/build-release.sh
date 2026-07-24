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

version="$(grep -m1 '"version":' "$repo_root/package.json" | cut -d '"' -f 4)"
[ -n "$version" ] || { echo "build-release: could not read version from package.json" >&2; exit 1; }
{
  printf '{\n'
  printf '  "schemaVersion": 1,\n'
  printf '  "package": "ideality",\n'
  printf '  "version": "%s",\n' "$version"
  printf '  "artifacts": {\n'
  for index in "${!targets[@]}"; do
    target="${targets[$index]}"
    archive="ideality-$target.tar.gz"
    sum="$(grep -E " \*?$archive\$" SHA256SUMS.txt | awk '{print $1}')"
    size="$(wc -c < "$archive" | tr -d ' ')"
    [ -n "$sum" ] || { echo "build-release: missing checksum for $archive" >&2; exit 1; }
    comma=","
    [ "$index" -eq "$((${#targets[@]} - 1))" ] && comma=""
    printf '    "%s": { "filename": "%s", "sha256": "%s", "size": %s }%s\n' \
      "$target" "$archive" "$sum" "$size" "$comma"
  done
  printf '  }\n'
  printf '}\n'
} > release-metadata.json

echo "==> Release artifacts"
ls -l
cat SHA256SUMS.txt
