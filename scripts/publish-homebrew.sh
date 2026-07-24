#!/usr/bin/env bash
# Publish a rendered formula to the Homebrew tap repository.
#
# Skips cleanly when HOMEBREW_TAP_TOKEN is not configured so forks and
# tokenless runs do not fail the release.
#
# Environment:
#   TAP_TOKEN        GitHub token with push access to the tap repository (required to publish)
#   TAP_REPOSITORY   Tap repository slug (default: <owner>/homebrew-tap)
#   RELEASE_TAG      Release tag being published, used in the commit message
set -euo pipefail

formula="${1:?usage: publish-homebrew.sh <formula-file>}"
if [ ! -f "$formula" ]; then
  echo "publish-homebrew: formula file '$formula' does not exist" >&2
  exit 1
fi

if [ -z "${TAP_TOKEN:-}" ]; then
  echo "publish-homebrew: HOMEBREW_TAP_TOKEN is not configured; skipping Homebrew publish."
  exit 0
fi

owner="${GITHUB_REPOSITORY_OWNER:-${GITHUB_REPOSITORY%%/*}}"
tap="${TAP_REPOSITORY:-$owner/homebrew-tap}"
tag="${RELEASE_TAG:-${GITHUB_REF_NAME:-unversioned}}"

workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

echo "==> Publishing formula to $tap"
git clone --depth 1 "https://x-access-token:${TAP_TOKEN}@github.com/${tap}.git" "$workdir/tap"
mkdir -p "$workdir/tap/Formula"
cp "$formula" "$workdir/tap/Formula/ideality.rb"

cd "$workdir/tap"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add Formula/ideality.rb
if git diff --cached --quiet; then
  echo "publish-homebrew: formula unchanged; nothing to publish."
  exit 0
fi
git commit -m "ideality ${tag}"
git push origin HEAD
echo "publish-homebrew: published ideality ${tag} to ${tap}."
