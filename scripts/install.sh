#!/usr/bin/env bash
# Install the ideality CLI from GitHub release binaries.
#
#   curl -fsSL https://raw.githubusercontent.com/0xJord4n/ideality/main/scripts/install.sh | bash
#
# Environment:
#   IDEALITY_VERSION      Version to install, e.g. 0.1.0 or v0.1.0 (default: latest)
#   IDEALITY_INSTALL_DIR  Install directory (default: ~/.local/bin)
#   IDEALITY_REPO         GitHub repository slug (default: 0xJord4n/ideality)
#   IDEALITY_BASE_URL     Base URL serving the archives and SHA256SUMS.txt,
#                         e.g. file:///path/to/dist/release. Overrides the
#                         GitHub release URL; used by release rehearsals.
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

workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

echo "==> Downloading $archive ($base_url)"
curl -fsSL -o "$workdir/$archive" "$base_url/$archive"
curl -fsSL -o "$workdir/SHA256SUMS.txt" "$base_url/SHA256SUMS.txt"

echo "==> Verifying checksum"
(
  cd "$workdir"
  grep " $archive\$" SHA256SUMS.txt > checksum.txt
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
