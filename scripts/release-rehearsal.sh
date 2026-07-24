#!/usr/bin/env bash
# Rehearse the release pipeline against local artifacts -- no tags, no
# uploads, no credentials, no network.
#
# Proves, in order:
#   1. SHA256SUMS.txt covers every archive and every archive matches it
#   2. each archive contains exactly one member: the `ideality` binary
#   3. the host-platform binary reports the package.json version and passes
#      the full smoke suite (scripts/smoke.sh in an isolated HOME)
#   4. scripts/install.sh installs from these exact artifacts served over
#      file:// (IDEALITY_BASE_URL) and the installed binary runs
#   5. scripts/homebrew-formula.ts renders a well-formed formula from the
#      manifest; targets that were not built are padded with placeholder
#      checksums and the rendered file never leaves the rehearsal tmpdir
#
# Usage:
#   scripts/release-rehearsal.sh                    # build host target, then verify
#   scripts/release-rehearsal.sh --no-build         # verify existing dist/release
#   scripts/release-rehearsal.sh --release-dir DIR  # verify DIR (implies --no-build)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

release_dir="dist/release"
build=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-build)
      build=0
      shift
      ;;
    --release-dir)
      release_dir="${2:?release-rehearsal: --release-dir requires a path}"
      build=0
      shift 2
      ;;
    *)
      echo "release-rehearsal: unknown argument '$1'" >&2
      exit 2
      ;;
  esac
done

fail() {
  echo "release-rehearsal: FAIL: $*" >&2
  exit 1
}
step() { printf '\n== %s\n' "$*"; }

case "$(uname -s)" in
  Linux) host_os="linux" ;;
  Darwin) host_os="darwin" ;;
  *) fail "unsupported operating system '$(uname -s)'" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) host_arch="x64" ;;
  arm64 | aarch64) host_arch="arm64" ;;
  *) fail "unsupported architecture '$(uname -m)'" ;;
esac
host_target="$host_os-$host_arch"

expected_version="$(grep -m1 '"version":' package.json | cut -d '"' -f 4)"
[ -n "$expected_version" ] || fail "could not read version from package.json"

if [ "$build" -eq 1 ]; then
  step "Building host release archive ($host_target)"
  bash scripts/build-release.sh "$host_target"
fi

[ -d "$release_dir" ] || fail "release dir '$release_dir' does not exist (run scripts/build-release.sh or pass --release-dir)"
manifest="$release_dir/SHA256SUMS.txt"
[ -f "$manifest" ] || fail "'$manifest' does not exist"

archives=()
for archive in "$release_dir"/ideality-*.tar.gz; do
  [ -e "$archive" ] || fail "no ideality-*.tar.gz archives in '$release_dir'"
  archives+=("$(basename "$archive")")
done

step "Verifying SHA256SUMS.txt against ${#archives[@]} archive(s)"
for archive in "${archives[@]}"; do
  grep -Eq " \*?$archive\$" "$manifest" ||
    fail "'$archive' exists but is not listed in SHA256SUMS.txt"
done
(
  cd "$release_dir"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c SHA256SUMS.txt
  else
    shasum -a 256 -c SHA256SUMS.txt
  fi
) || fail "checksum verification failed"

step "Verifying archive layout (single 'ideality' member)"
for archive in "${archives[@]}"; do
  members="$(tar -tzf "$release_dir/$archive")"
  [ "$members" = "ideality" ] ||
    fail "'$archive' must contain exactly one member 'ideality', got: $members"
done

rehearsal_tmp="$(mktemp -d)"
cleanup() { rm -rf "$rehearsal_tmp"; }
trap cleanup EXIT

host_archive="ideality-$host_target.tar.gz"
[ -f "$release_dir/$host_archive" ] ||
  fail "host archive '$host_archive' is missing; cannot prove the binary runs"

step "Smoke testing the extracted $host_target binary"
tar -C "$rehearsal_tmp" -xzf "$release_dir/$host_archive" ideality
bash scripts/smoke.sh "$rehearsal_tmp/ideality"

step "Rehearsing scripts/install.sh offline (file:// artifacts)"
abs_release_dir="$(cd "$release_dir" && pwd)"
install_home="$rehearsal_tmp/install-home"
mkdir -p "$install_home"
HOME="$install_home" \
  IDEALITY_BASE_URL="file://$abs_release_dir" \
  IDEALITY_INSTALL_DIR="$install_home/bin" \
  bash scripts/install.sh
"$install_home/bin/ideality" --version | grep -qF "$expected_version" ||
  fail "installed binary does not report version $expected_version"

step "Rendering the Homebrew formula from the manifest"
formula_sums="$rehearsal_tmp/SHA256SUMS.txt"
cp "$manifest" "$formula_sums"
placeholder="$(printf '0%.0s' $(seq 64))"
padded=()
for target in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
  if ! grep -q "ideality-$target\.tar\.gz\$" "$formula_sums"; then
    echo "$placeholder  ideality-$target.tar.gz" >> "$formula_sums"
    padded+=("$target")
  fi
done
if [ "${#padded[@]}" -gt 0 ]; then
  echo "release-rehearsal: padded placeholder checksums for unbuilt targets: ${padded[*]}"
fi
formula="$rehearsal_tmp/ideality.rb"
bun scripts/homebrew-formula.ts \
  --version "$expected_version" \
  --repository "${GITHUB_REPOSITORY:-0xJord4n/ideality}" \
  --checksums "$formula_sums" \
  --out "$formula"
grep -q "class Ideality < Formula" "$formula" || fail "formula is missing the Ideality class"
grep -q "version \"$expected_version\"" "$formula" || fail "formula does not pin version $expected_version"
host_sum="$(grep -E " \*?$host_archive\$" "$manifest" | cut -d ' ' -f 1)"
grep -q "$host_sum" "$formula" || fail "formula does not embed the real $host_target checksum"

printf '\nrelease-rehearsal: OK (version %s, archives: %s)\n' \
  "$expected_version" "${archives[*]}"
