#!/usr/bin/env bash
# Install the release binary inside an npm-compatible package.
set -euo pipefail

package_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Dependency installation in a source checkout must not download a release.
if [ -e "$package_root/.git" ] &&
  [ "${IDEALITY_PACKAGE_FORCE_INSTALL:-0}" != "1" ]; then
  exit 0
fi

version="${npm_package_version:-}"
if [ -z "$version" ]; then
  version="$(
    sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' \
      "$package_root/package.json" |
      head -n 1
  )"
fi
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
  echo "ideality-package: invalid package version '$version'" >&2
  exit 1
fi

IDEALITY_VERSION="$version" \
  IDEALITY_INSTALL_DIR="$package_root/vendor" \
  bash "$package_root/scripts/install.sh"
