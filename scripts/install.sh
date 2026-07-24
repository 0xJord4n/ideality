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
#   IDEALITY_COSIGN       Cosign executable path (default: cosign).
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
cosign="${IDEALITY_COSIGN:-cosign}"

workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

echo "==> Downloading release metadata ($base_url)"
curl -fsSL -o "$workdir/$metadata" "$base_url/$metadata"
curl -fsSL -o "$workdir/$metadata_bundle" "$base_url/$metadata_bundle"

echo "==> Verifying release metadata signature"
if ! command -v "$cosign" >/dev/null 2>&1; then
  echo "ideality-install: cosign is required to verify release metadata; install cosign and retry" >&2
  exit 1
fi
"$cosign" verify-blob \
  --bundle "$workdir/$metadata_bundle" \
  --certificate-identity-regexp "$identity_regexp" \
  --certificate-oidc-issuer "$oidc_issuer" \
  "$workdir/$metadata" >/dev/null || {
    echo "ideality-install: could not verify release metadata signature; refusing unsigned metadata" >&2
    exit 1
  }

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
