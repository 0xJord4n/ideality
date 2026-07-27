#!/usr/bin/env bash
# Install the ideality CLI from GitHub release binaries.
#
#   curl -fsSL https://raw.githubusercontent.com/0xJord4n/ideality/main/scripts/install.sh | bash
#
# Environment:
#   IDEALITY_VERSION      Version to install, e.g. 0.1.0 or v0.1.0 (default: latest)
#   IDEALITY_INSTALL_DIR  Install directory (default: ~/.local/bin)
#   IDEALITY_REPO         GitHub repository slug (default: 0xJord4n/ideality)
#   IDEALITY_BASE_URL     Base URL serving the archives and release metadata,
#                         e.g. file:///path/to/dist/release. Overrides the
#                         GitHub release URL; used by release rehearsals.
#   IDEALITY_COSIGN       Cosign executable path, or "auto" to force the pinned
#                         verifier bootstrap (default: use PATH, then bootstrap).
#   IDEALITY_COSIGN_BASE_URL
#                         Base URL for the pinned cosign binary.
#   IDEALITY_COSIGN_SHA256
#                         Override the pinned cosign checksum for a custom mirror.
set -euo pipefail

repo="${IDEALITY_REPO:-0xJord4n/ideality}"
version="${IDEALITY_VERSION:-latest}"
install_dir="${IDEALITY_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *)
    echo "ideality-install: unsupported operating system '$(uname -s)'" >&2
    echo "Prebuilt binaries exist for Linux and macOS (x64 and arm64) only." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *)
    echo "ideality-install: unsupported architecture '$(uname -m)'" >&2
    exit 1
    ;;
esac

target="$os-$arch"
if [ -n "${IDEALITY_BASE_URL:-}" ]; then
  base_url="${IDEALITY_BASE_URL%/}"
elif [ "$version" = "latest" ]; then
  base_url="https://github.com/$repo/releases/latest/download"
else
  base_url="https://github.com/$repo/releases/download/v${version#v}"
fi
archive="ideality-$target.tar.gz"
metadata="release-metadata.json"
metadata_bundle="release-metadata.json.sigstore.json"
identity_regexp='https://github.com/0xJord4n/ideality/\.github/workflows/release\.yml.*'
oidc_issuer='https://token.actions.githubusercontent.com'
cosign="${IDEALITY_COSIGN:-}"
cosign_install_source=""

workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

verify_sha256() {
  file="$1"
  expected="$2"
  label="$3"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  fi
  if [ "$actual" != "$expected" ]; then
    echo "ideality-install: $label checksum mismatch" >&2
    return 1
  fi
}

if [ "$cosign" = "auto" ]; then
  cosign=""
elif [ -n "$cosign" ]; then
  if ! command -v "$cosign" >/dev/null 2>&1; then
    echo "ideality-install: cosign is required, but configured verifier '$cosign' was not found" >&2
    echo "Remove IDEALITY_COSIGN to use the pinned automatic verifier." >&2
    exit 1
  fi
elif command -v cosign >/dev/null 2>&1; then
  cosign="$(command -v cosign)"
elif [ -x "$install_dir/cosign" ]; then
  cosign="$install_dir/cosign"
elif [ -e "$install_dir/cosign" ]; then
  echo "ideality-install: '$install_dir/cosign' exists but is not executable" >&2
  exit 1
fi

if [ -z "$cosign" ]; then
  cosign_version="3.0.6"
  case "$target" in
    linux-x64)
      cosign_asset="cosign-linux-amd64"
      pinned_cosign_sha="c956e5dfcac53d52bcf058360d579472f0c1d2d9b69f55209e256fe7783f4c74"
      ;;
    linux-arm64)
      cosign_asset="cosign-linux-arm64"
      pinned_cosign_sha="bedac92e8c3729864e13d4a17048007cfafa79d5deca993a43a90ffe018ef2b8"
      ;;
    darwin-x64)
      cosign_asset="cosign-darwin-amd64"
      pinned_cosign_sha="4c3e7af8372d3ca3296e62fa56f23fcbb5721cc6ac1827900d398f110d7cd280"
      ;;
    darwin-arm64)
      cosign_asset="cosign-darwin-arm64"
      pinned_cosign_sha="5fadd012ae6381a6a29ff86a7d39aa873878852f1073fc90b15995961ecfb084"
      ;;
  esac
  cosign_base_url="${IDEALITY_COSIGN_BASE_URL:-https://github.com/sigstore/cosign/releases/download/v$cosign_version}"
  cosign_sha="${IDEALITY_COSIGN_SHA256:-$pinned_cosign_sha}"
  cosign="$workdir/cosign"

  echo "==> Downloading pinned cosign v$cosign_version verifier"
  curl -fsSL -o "$cosign" "${cosign_base_url%/}/$cosign_asset"
  verify_sha256 "$cosign" "$cosign_sha" "cosign v$cosign_version"
  chmod 755 "$cosign"
  cosign_install_source="$cosign"
fi

echo "==> Downloading release metadata ($base_url)"
curl -fsSL -o "$workdir/$metadata" "$base_url/$metadata"
curl -fsSL -o "$workdir/$metadata_bundle" "$base_url/$metadata_bundle"

echo "==> Verifying release metadata signature"
"$cosign" verify-blob \
  --bundle "$workdir/$metadata_bundle" \
  --certificate-identity-regexp "$identity_regexp" \
  --certificate-oidc-issuer "$oidc_issuer" \
  "$workdir/$metadata" >/dev/null || {
    echo "ideality-install: could not verify release metadata signature; refusing unsigned metadata" >&2
    exit 1
  }

metadata_version="$(
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$workdir/$metadata" |
    head -n 1
)"
if [ -z "$metadata_version" ]; then
  echo "ideality-install: verified release metadata has no version" >&2
  exit 1
fi
if [ "$version" != "latest" ] && [ "$metadata_version" != "${version#v}" ]; then
  echo "ideality-install: release metadata version $metadata_version does not match requested version ${version#v}" >&2
  exit 1
fi

metadata_block="$(awk -v target="\"$target\"" '
  index($0, target) { found = 1 }
  found { print }
  found && /}/ { exit }
' "$workdir/$metadata")"
metadata_archive="$(printf '%s\n' "$metadata_block" | sed -nE 's/.*"filename": "([^"]+)".*/\1/p')"
metadata_sha="$(printf '%s\n' "$metadata_block" | sed -nE 's/.*"sha256": "([a-fA-F0-9]{64})".*/\1/p')"
if [ "$metadata_archive" != "$archive" ] || [ -z "$metadata_sha" ]; then
  echo "ideality-install: verified release metadata does not contain $archive for $target" >&2
  exit 1
fi

echo "==> Downloading $archive ($base_url)"
curl -fsSL -o "$workdir/$archive" "$base_url/$archive"

echo "==> Verifying checksum"
(
  cd "$workdir"
  printf '%s  %s\n' "$metadata_sha" "$archive" > checksum.txt
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c checksum.txt
  else
    shasum -a 256 -c checksum.txt
  fi
)

echo "==> Installing to $install_dir/ideality"
tar -C "$workdir" -xzf "$workdir/$archive" ideality
mkdir -p "$install_dir"
if [ -n "$cosign_install_source" ]; then
  echo "==> Installing pinned verifier to $install_dir/cosign"
  install -m 755 "$cosign_install_source" "$install_dir/cosign"
fi
install -m 755 "$workdir/ideality" "$install_dir/ideality"

echo "==> Installed $("$install_dir/ideality" --version)"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *)
    echo
    echo "Add $install_dir to your PATH to use 'ideality':"
    echo "  export PATH=\"$install_dir:\$PATH\""
    ;;
esac
