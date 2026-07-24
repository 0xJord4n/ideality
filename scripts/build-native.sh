#!/usr/bin/env bash
# Compile dist/ideality for the machine running this script.
#
# Maps the host OS/arch to an explicit bunli target (no reliance on the
# 'native' alias) and fails hard if the executable is not produced.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

case "$(uname -s)" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *)
    echo "build-native: unsupported operating system '$(uname -s)'" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *)
    echo "build-native: unsupported architecture '$(uname -m)'" >&2
    exit 1
    ;;
esac

target="$os-$arch"
outfile="dist/ideality"

echo "==> Building $target -> $outfile"
bun x bunli build --targets "$target" --outfile "$outfile"

if [ ! -x "$outfile" ]; then
  echo "build-native: bunli reported success but '$outfile' was not created" >&2
  exit 1
fi

echo "==> Built $("$outfile" --version)"
