#!/usr/bin/env bash
# Deterministic end-to-end smoke test for the ideality CLI.
#
# Runs the real CLI against an isolated temporary HOME so no user state is
# read or written: init -> status -> run bun --version -> setup -> rollback.
#
# Usage:
#   scripts/smoke.sh                # exercise the dev entrypoint (bun src/index.ts)
#   scripts/smoke.sh dist/ideality  # exercise a compiled binary
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$#" -ge 1 ]; then
  binary="$1"
  if [ ! -x "$binary" ]; then
    echo "smoke: '$binary' is not an executable file" >&2
    exit 1
  fi
  binary="$(cd "$(dirname "$binary")" && pwd)/$(basename "$binary")"
  ideality() { "$binary" "$@"; }
  runner="$binary"
else
  ideality() { bun "$repo_root/src/index.ts" "$@"; }
  runner="bun $repo_root/src/index.ts"
fi

expected_version="$(grep -m1 '"version":' "$repo_root/package.json" | cut -d '"' -f 4)"
if [ -z "$expected_version" ]; then
  echo "smoke: could not read version from package.json" >&2
  exit 1
fi

smoke_home="$(mktemp -d)"
cleanup() { rm -rf "$smoke_home"; }
trap cleanup EXIT

# Isolate every piece of user state the CLI could touch.
export HOME="$smoke_home"
export IDEALITY_HOME="$smoke_home/.ideality"
export XDG_CONFIG_HOME="$smoke_home/.config"
export XDG_CACHE_HOME="$smoke_home/.cache"
export XDG_DATA_HOME="$smoke_home/.local/share"
export XDG_STATE_HOME="$smoke_home/.local/state"
export GIT_CONFIG_GLOBAL="$smoke_home/.gitconfig"
export GIT_CONFIG_SYSTEM=/dev/null
export NO_COLOR=1
unset IDEALITY_CONFIG || true

project="$smoke_home/code/demo"
mkdir -p "$project"
# Anchor project-root discovery inside the isolated HOME; without a .git
# marker, `setup` climbs past the temp directory on hosts where an
# ancestor (e.g. /tmp) happens to contain one.
git init -q "$project"

step() { printf '\n== %s\n' "$*"; }
fail() {
  echo "smoke: FAIL: $*" >&2
  exit 1
}

step "--version ($runner)"
version_output="$(ideality --version)"
echo "$version_output"
case "$version_output" in
  *"$expected_version"*) ;;
  *) fail "--version printed '$version_output', expected '$expected_version'" ;;
esac

step "init"
ideality init --non-interactive \
  --label Smoke \
  --root "$smoke_home/code" \
  --git-name "Smoke Tester" \
  --git-email smoke@example.com \
  --tools bun
[ -f "$IDEALITY_HOME/config.jsonc" ] || fail "init did not write $IDEALITY_HOME/config.jsonc"

step "status"
status_json="$(ideality status --path "$project" --json)"
echo "$status_json" | grep -q '"identity": "smoke"' || fail "status did not resolve the smoke identity"
echo "$status_json" | grep -q '"name": "bun"' || fail "status did not list the bun tool"

step "run bun --version"
run_output="$(ideality run --path "$project" bun -- --version)"
echo "$run_output"
echo "$run_output" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+' || fail "run bun --version printed '$run_output'"

step "setup"
setup_output="$(ideality setup --non-interactive --yes \
  --path "$project" \
  --identity smoke \
  --tools bun)"
echo "$setup_output"
echo "$setup_output" | grep -qF "Configured $project" ||
  fail "setup did not configure the demo project (got: $setup_output)"

step "rollback --list"
snapshots="$(ideality rollback --list)"
echo "$snapshots"
[ -n "$snapshots" ] || fail "rollback --list printed nothing"
[ "$snapshots" != "No snapshots" ] || fail "no snapshots recorded after setup"

step "rollback (restore latest snapshot)"
rollback_output="$(ideality rollback)"
echo "$rollback_output"
echo "$rollback_output" | grep -q "Restored" || fail "rollback did not restore a snapshot"

step "status (after rollback)"
ideality status --path "$project" --json | grep -q '"identity": "smoke"' ||
  fail "status no longer resolves the smoke identity after rollback"

# Nothing may leak outside the temporary HOME; prove the registry stayed
# inside it. Compare physical paths: on macOS mktemp returns a path under
# the /var -> /private/var symlink.
physical_home="$(cd "$smoke_home" && pwd -P)"
case "$(cd "$IDEALITY_HOME" && pwd -P)" in
  "$physical_home"/*) ;;
  *) fail "ideality home escaped the isolated HOME" ;;
esac

printf '\nsmoke: OK (version %s, isolated home %s)\n' "$expected_version" "$smoke_home"
