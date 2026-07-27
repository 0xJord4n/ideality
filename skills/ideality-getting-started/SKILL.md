---
name: ideality-getting-started
description: Install and bootstrap Ideality. Use when setting up a machine, provisioning non-interactively, enabling shell integration, or safely updating a direct binary install.
---

# Getting started with ideality

ideality selects an identity from the current directory and starts each tool
with only that identity's process environment.

## Install

Install the scoped package globally; every manager exposes the command as
`ideality`:

```bash
npm install --global @0xjord4n/ideality
pnpm add --global @0xjord4n/ideality
bun add --global @0xjord4n/ideality

# Yarn Classic
yarn global add @0xjord4n/ideality

# Modern Yarn runs CLIs on demand instead of installing them globally
yarn dlx @0xjord4n/ideality
```

The package downloads the matching signed native release. When lifecycle
scripts are disabled, its launcher performs that verified bootstrap on first
use.

```bash
# Install script (verifies Sigstore bundle + checksums, installs to ~/.local/bin)
curl -fsSL https://raw.githubusercontent.com/0xJord4n/ideality/main/scripts/install.sh | bash
```

Environment overrides for the script: `IDEALITY_VERSION` pins a version,
`IDEALITY_INSTALL_DIR` changes the destination.

From source (requires the Bun 1.3 version pinned by the checkout):

```bash
git clone https://github.com/0xJord4n/ideality.git
cd ideality
bun install --frozen-lockfile
bun run check
bun run build
bun link
ideality init
```

## First identity: `ideality init`

Interactive mode is automatic in a terminal. The wizard fuzzy-searches folders
and SSH private keys, derives the identity ID from the display label, and can
generate an Ed25519 key. `--id` is only an explicit override.

Non-interactive provisioning:

```bash
ideality init --non-interactive \
  --label "Example Account" \
  --root ~/code \
  --git-name "Example Developer" \
  --git-email developer@example.com \
  --generate-ssh \
  --packs essentials,cloud,ai \
  --tools gh,cf,codex,aws,gcloud,gemini,copilot \
  --install \
  --shell zsh
```

## Enable automatic dispatch

`ideality install` adds `~/.ideality/bin` to `PATH`. Managed shims there
intercept every configured tool, resolve the identity from `$PWD`, strip
variables managed by other identities, inject the selected tool profile, and
execute the real binary. After this, running `vercel`, `gh`, `railway`, `cf`,
an AI CLI, or a browser needs no explicit wrapper.

Bun is intentionally not shimmed (it may be the runtime starting ideality).
Use `ideality run bun -- <args>` when registry isolation is required.

Preview before applying: `ideality install --dry-run`.

## Shell integration

```bash
ideality completion zsh --install     # also: bash, fish
ideality prompt
ideality prompt --format '{label}:{identity}'
```

## State layout

All managed state lives under `~/.ideality`:

```text
audit/  bin/  completions/  config.jsonc  git/  history/  plugins/
profiles/  secrets/  shell/  ssh/
```

(`audit/` appears only when the opt-in audit history is enabled.)

Environment variables: `IDEALITY_HOME` relocates all managed state,
`IDEALITY_CONFIG` selects a registry file explicitly, and
`IDEALITY_IDENTITY` exposes the resolved identity to child processes.

## Updating

Direct binary installs self-update safely:

```bash
ideality update --check
ideality update --dry-run
ideality update
ideality update --version 0.2.0   # when its metadata is available
```

Package-manager installs are not overwritten. Use the manager-specific update
command printed by `ideality update`, such as
`npm update --global @0xjord4n/ideality` or
`bun update --global @0xjord4n/ideality`. Modern Yarn's `yarn dlx` mode is
ephemeral; run `yarn dlx @0xjord4n/ideality@latest` for the latest release.

## Verify it works

```bash
ideality status
ideality explain gh
ideality doctor --strict
```

Setup is complete when `status` selects the expected identity, `explain`
reports the intended profile for an enabled tool, and `doctor --strict`
reports no unresolved setup failure.
