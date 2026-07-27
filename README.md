# Ideality

### One machine. Many developer identities. No account bleed.

[![CI](https://github.com/0xJord4n/ideality/actions/workflows/ci.yml/badge.svg)](https://github.com/0xJord4n/ideality/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/0xJord4n/ideality?style=flat&logo=github)](https://github.com/0xJord4n/ideality/releases)
[![GitHub stars](https://img.shields.io/github/stars/0xJord4n/ideality?style=flat&logo=github)](https://github.com/0xJord4n/ideality/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f855a)](LICENSE)
[![Bun 1.3](https://img.shields.io/badge/Bun-1.3-black?logo=bun)](.bun-version)

Ideality maps folders to developer identities, then starts each tool with the
right Git author, SSH key, account environment, profile directory, secrets,
network policy, and execution target.

Keep using `git`, `gh`, `aws`, `vercel`, `codex`, browsers, editors, and the
rest of your normal toolchain. Ideality's managed shims select and isolate the
matching identity automatically from `$PWD`.

[**Install**](#install) · [Quick start](#quick-start) ·
[Supported tools](#supported-tools) · [Security](#security-model) ·
[Documentation](#documentation) · [Contributing](CONTRIBUTING.md)

## Why Ideality

Developer tools store identity in different places: global Git config, shell
variables, dotfiles, browser profiles, vendor-specific directories, native
credential stores, or an active CLI session. Switching projects can silently
leave the wrong account active.

Ideality gives those tools one folder-aware identity boundary:

```text
~/code/work/       -> work identity       -> git, gh, aws, vercel, codex
~/code/personal/   -> personal identity   -> git, gh, npm, railway, chrome
~/clients/acme/    -> acme identity       -> git, glab, gcloud, cursor
```

The longest matching folder root wins. Outside configured roots, Ideality uses
the default identity. You can always override the selection explicitly.

## Features

| Feature | What it provides |
|:--|:--|
| **Folder-based selection** | Resolve an identity from the current directory without manually switching accounts |
| **Automatic dispatch** | Run normal tool commands through generated shims in `~/.ideality/bin` |
| **Process isolation** | Remove variables managed by other identities before injecting the selected profile |
| **Git and SSH identity** | Generate conditional Git configuration for authoring, signing, and SSH |
| **Project handovers** | Share reviewed tool and identity requirements in `.ideality/project.jsonc` |
| **Secret references** | Resolve credentials only when a process starts; keep values out of the registry and diagnostics |
| **Network enforcement** | Bind identities or individual tools to VPN and network profiles |
| **VM execution** | Route selected tools through folder-aware isolated machines |
| **Explainability** | Inspect identity selection, environment sources, redactions, and execution targets before launch |
| **Transactional changes** | Preview writes, retain snapshots, and roll back registry changes |
| **Declarative adapters** | Use 58 built-in tools or install portable JSONC tool manifests |
| **Verified distribution** | Install and update from authenticated metadata and checksum-verified release archives |

## How It Works

1. **Bind roots to identities.** Each identity owns one or more folder roots and
   may define Git, SSH, tool, network, and VM settings.
2. **Enable only the tools it needs.** Ideality creates isolated profiles and
   managed shims for the selected adapters.
3. **Run commands normally.** A shim resolves the identity from `$PWD`, builds a
   clean process environment, and executes the real binary.
4. **Inspect any decision.** `ideality status` shows the active identity;
   `ideality explain <tool>` shows how a launch will be isolated.

```text
command
  -> managed shim
  -> longest matching folder root
  -> identity + tool profile
  -> secrets / network / VM requirements
  -> real executable
```

Ideality does not make a repository execute commands when it is opened.
Project handovers are parsed, reviewed, checked against team policy, and
applied explicitly with `ideality setup`.

## Install

Prebuilt binaries support Linux and macOS on x64 and arm64.

### Package Managers

The registry package is scoped as `@0xjordan/ideality`, but it installs the
normal `ideality` command:

```bash
npm install --global @0xjordan/ideality
pnpm add --global @0xjordan/ideality
bun add --global @0xjordan/ideality

# Yarn Classic
yarn global add @0xjordan/ideality

# Modern Yarn has no global install command; run it on demand
yarn dlx @0xjordan/ideality
```

The package installs the matching signed native release and verifies its
authenticated metadata and checksum. If a package manager disables lifecycle
scripts, the `ideality` launcher performs the same verified installation on
first use.

### Install Script

The installer authenticates the release metadata, verifies the selected
archive checksum, and installs the binary to `~/.local/bin`. Verification is
automatic and requires no separate setup.

```bash
curl -fsSL https://raw.githubusercontent.com/0xJord4n/ideality/main/scripts/install.sh | bash
```

Pin a version or change the destination with `IDEALITY_VERSION` and
`IDEALITY_INSTALL_DIR`:

```bash
IDEALITY_VERSION=0.1.0 \
IDEALITY_INSTALL_DIR="$HOME/bin" \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/0xJord4n/ideality/main/scripts/install.sh)"
```

### Agent Skills

Ideality ships ten Agent Skills for operating the CLI and contributing
adapters. Install them with Vercel's open Skills CLI:

```bash
npx skills add 0xJord4n/ideality
# or
bunx skills add 0xJord4n/ideality
```

Once Ideality is installed, its wrapper prefers `bunx` and falls back to
`npx`:

```bash
ideality skills install
ideality skills install --list
ideality skills install --runner bunx
ideality skills install \
  --skill ideality-getting-started \
  --skill ideality-troubleshooting \
  --agent codex \
  --global
```

The installer supports the agents recognized by Vercel Skills, interactive
skill selection, project or global scope, symlink or copy installation, and
non-interactive `--yes`/`--all` modes. See the
[Agent Skills guide](skills/README.md) for the complete roster and options.

### Build From Source

Source builds require the Bun version in [`.bun-version`](.bun-version).

```bash
git clone https://github.com/0xJord4n/ideality.git
cd ideality
bun install --frozen-lockfile
bun run check
bun run build
bun link
```

<details>
<summary><strong>Release verification</strong></summary>

Every release includes archives for all four supported targets, checksums,
and authenticated release metadata. Public-repository releases also include
GitHub build provenance.

```bash
sha256sum -c --ignore-missing SHA256SUMS.txt
# Public repositories
gh attestation verify ideality-linux-x64.tar.gz --repo 0xJord4n/ideality
```

See [release verification](docs/releasing.md#verifying-a-release) for the full
artifact contract.

</details>

## Quick Start

Create the registry and your first identity:

```bash
ideality init
```

The interactive wizard:

- discovers likely folder roots and existing SSH keys,
- derives a stable ID from the identity label,
- can generate an Ed25519 key,
- lets you choose tool packs and individual tools,
- offers preselected shell, completion, and conditional Git integrations.

Open a new shell, enter a configured folder, and inspect the result:

```bash
exec "$SHELL" -l
cd ~/code/work

ideality status
ideality explain gh
gh auth status
```

Add another identity whenever you need one:

```bash
ideality identity add
ideality identity bind personal ~/code/personal
ideality identity default personal
```

For unattended provisioning:

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

## Project Setup

Run the project wizard anywhere inside a repository:

```bash
ideality setup
```

The wizard can activate an existing local identity, import a shared project
identity, or create a new one. It then selects tools and optional network or VM
requirements before showing the exact files and integrations it will change.

Choose between:

- **Local activation**: keep the binding only in your user registry.
- **Complete handover**: write a portable `.ideality/project.jsonc` containing
  the project identity and tool profiles.
- **Requirements-only handover**: share required tools without identity
  profiles or credential references.

Automation uses the same operation without prompts:

```bash
ideality setup --non-interactive \
  --identity work \
  --tools gh,cf,vercel,codex \
  --project \
  --yes

ideality setup --non-interactive \
  --identity work \
  --tools gh,codex \
  --project \
  --requirements-only \
  --dry-run
```

Teams can constrain handovers with `.ideality/policy.jsonc` and enforce the
contract in CI:

```bash
ideality policy check
```

See [team policy contracts](docs/policy.md) for the schema and CI patterns.

## Supported Tools

`ideality init` and `ideality identity add` offer packs first, followed by
fine-grained tool selection. Only enabled tools receive identity profiles and
managed shims.

<!-- generated:catalog-summary:begin -->
The built-in catalog ships 58 adapters across 7 selectable packs:

- **Developer essentials**: `cf`, `chrome`, `claude`, `codex`, `firefox`, `gh`, `opencode`, `railway`, `vercel`
- **Cloud accounts**: `aws`, `az`, `doctl`, `gcloud`
- **Source control**: `bitbucket`, `gerrit`, `glab`, `tea`
- **Editors and desktop**: `code`, `cursor`, `discord`, `goland`, `idea`, `pycharm`, `rustrover`, `slack`, `webstorm`, `windsurf`, `zed`
- **Package registries**: `bun`, `cargo`, `composer`, `gem`, `gradle`, `mvn`, `npm`, `nuget`, `pip`, `pnpm`, `uv`, `yarn`
- **Deployment platforms**: `firebase`, `fly`, `heroku`, `netlify`, `pulumi`, `render`, `shopify`, `sst`, `stripe`, `supabase`
- **AI tools**: `aider`, `amp`, `cn`, `copilot`, `gemini`, `goose`, `kiro-cli`, `qwen`
<!-- generated:catalog-summary:end -->

Adapters report `full`, `partial`, or `credentials` isolation based on the
controls exposed by the upstream application. The
[tool pack and isolation matrix](docs/tool-packs.md) documents the exact
mechanism for every built-in adapter.

Manage packs and tools after setup:

```bash
ideality tool packs
ideality tool enable-pack work cloud
ideality tool disable-pack work editors
ideality tool enable work stripe
ideality tool list
```

Bun is intentionally not shimmed because it may be the runtime starting
Ideality. Use `ideality run bun -- <args>` when registry isolation is required.

## Everyday Workflows

### Inspect And Run

```bash
ideality status
ideality explain vercel
ideality explain cf --path ~/code/work/project --json

ideality run gh --identity work -- auth status
ideality run chrome --identity personal -- https://github.com
```

### Authentication

```bash
ideality auth gh status
ideality auth railway login --identity work
ideality auth status --all
```

### Git And SSH

```bash
ideality identity ssh-public work
ideality identity bind work ~/projects/client
ideality identity unbind work ~/projects/legacy
```

Git integration uses generated `includeIf` configuration, including author,
signing, and `core.sshCommand`. Other tools use process-only shims and isolated
profile directories.

### Secrets

Starter profiles use logical references instead of literal tokens. The default
backend stores locked local files:

```bash
ideality secret set work railway RAILWAY_API_TOKEN
printf '%s' "$TOKEN" |
  ideality secret set work cf CLOUDFLARE_API_TOKEN --stdin
ideality secret list
```

Available backends include local files, age, macOS Keychain, `pass`,
1Password, Bitwarden, and Dashlane:

```bash
ideality secret backend age \
  --recipient age1... \
  --identity-file ~/.config/age/keys.txt

ideality secret backend keychain
ideality secret backend pass --prefix developer/ideality
ideality secret backend onepassword
```

Secret values are resolved only while starting the selected tool. Status,
doctor, explain, config output, audit history, and the TUI remain redacted.
Run `ideality env --reveal` only when you intentionally need resolved values.

### Network And VM Isolation

Network and VM profiles are folder-aware execution requirements. A selected
host VPN is enforced before Ideality starts a native tool or VM.

```bash
ideality network add
ideality vm add
ideality vm bind work dev-vm
ideality network bind work corp-vpn --tool chrome
ideality network up corp-vpn
ideality vm exec dev-vm -- bun test
ideality doctor --strict
```

Lima is the executable macOS/Linux VM backend. Apple VZ, Cloud Hypervisor, and
Firecracker are capability-checked helper backends. Mullvad, WireGuard,
OpenVPN, Tailscale exit nodes, Cloudflare WARP, and custom network wrappers are
supported with provider-specific enforcement boundaries.

See [network and VM isolation](docs/network-vm.md) for setup, enforcement
levels, secret handling, and leak-prevention guarantees.

### Terminal Dashboard

```bash
ideality tui
```

The dashboard stages identity, folder, tool, network, VM, plugin, and secret
backend changes in memory. It previews a readable diff and writes only after an
explicit save through transactional history. Press `g` for plugin manifest
administration and `k` for secret-backend administration. Plugin installation
or removal requires a clean staged draft; destructive actions require explicit
confirmation.

## Custom Adapters

Add a local tool directly:

```bash
ideality tool add acme --executable acme
ideality tool env work acme \
  ACME_HOME value:{{idealityHome}}/profiles/{{identity}}/acme
ideality tool env work acme ACME_TOKEN secret:{{identity}}/acme-token
ideality tool args work acme -- --region eu
```

Or distribute a portable declarative manifest:

```jsonc
{
  "schemaVersion": 1,
  "kind": "tool",
  "id": "acme",
  "displayName": "Acme CLI",
  "pack": "custom",
  "executable": {
    "primary": "acme",
    "alternatives": ["acme-cli"]
  },
  "isolation": {
    "scope": "process",
    "state": "credentials"
  },
  "auth": {
    "status": ["account", "show"]
  },
  "profile": {
    "env": {
      "ACME_TOKEN": {
        "from": "secret",
        "key": "{{identity}}/acme-token"
      }
    }
  }
}
```

```bash
ideality plugin validate acme.ideality.jsonc
ideality plugin install acme.ideality.jsonc
```

Tool manifests are data, not executable plugins. Commands and arguments are
strict argv arrays. Runtime plugins cannot inject privileged network, VM, or
secret-backend code. See [custom adapters](docs/custom-adapters.md).

## Security Model

| Boundary | Protection |
|:--|:--|
| **Registry** | Atomic writes, strict schemas, mode-restricted state, and the newest 50 valid snapshots |
| **Environment** | Variables owned by other identities are removed before the selected profile is applied |
| **Secrets** | Logical references resolve at launch; values stay out of config, diffs, logs, audit events, and argv |
| **Project files** | Opening a repository executes nothing; setup requires review and explicit application |
| **Tool adapters** | Declarative manifests are strictly parsed and cannot contain shell command strings |
| **Privileged adapters** | Network, VM, and secret lifecycle code is reviewed, statically bundled, and covered by behavior contracts |
| **Releases** | Metadata is authenticated, archives are checksum-verified, and updates validate migration readiness |
| **Recovery** | Dry runs, config snapshots, transactional rollback, and binary rollback protect mutations |

Useful checks:

```bash
ideality identity bind work ~/projects/client --dry-run
ideality plugin install acme.ideality.jsonc --dry-run
ideality rollback --list
ideality rollback latest --dry-run
ideality doctor --strict
```

Structured audit history is local and explicitly opt-in. By default Ideality
does not create an audit file or record events.

```bash
ideality audit enable --max-events 1000 --max-bytes 5242880
ideality audit list
ideality audit list --type secret.set --json
ideality audit prune --confirm
ideality audit disable
```

Audit payloads are allowlisted and redacted. They never include executable
paths, secret values, resolved environments, raw stdout or stderr, token-like
strings, or full argv. See [SECURITY.md](SECURITY.md) for operational guidance.

## Configuration

Managed state defaults to `~/.ideality`:

```text
~/.ideality/
├── audit/          # optional redacted JSONL history
├── bin/            # managed tool shims
├── completions/    # generated shell completions
├── config.jsonc    # identity and adapter registry
├── git/            # generated conditional Git configuration
├── history/        # transactional registry snapshots
├── plugins/        # installed declarative manifests
├── profiles/       # identity-specific tool state
├── secrets/        # local secret backend storage
├── shell/          # generated shell integration
└── ssh/            # generated SSH keys
```

| Variable | Purpose |
|:--|:--|
| `IDEALITY_HOME` | Relocate all managed state |
| `IDEALITY_CONFIG` | Select a registry file explicitly |
| `IDEALITY_IDENTITY` | Expose the resolved identity to child processes |

Inspect or edit the registry through the CLI:

```bash
ideality config path
ideality config validate
ideality config show
ideality config edit
ideality config migrate --dry-run
```

## Updates

Direct binary installs update in place. Package-manager installs are detected
and never overwritten. Update them through the manager that installed them:

```bash
npm update --global @0xjordan/ideality
pnpm update --global @0xjordan/ideality
bun update --global @0xjordan/ideality

# Yarn Classic
yarn global upgrade @0xjordan/ideality
```

Modern Yarn's `yarn dlx` mode has no persistent installation to update. Run
`yarn dlx @0xjordan/ideality@latest` whenever you want the latest release.

```bash
ideality update --check
ideality update --dry-run
ideality update
ideality update --version 0.1.0
```

An update verifies signed metadata and the archive checksum, proves the staged
binary version, checks migration readiness, snapshots config bytes, and rolls
back both the binary and config if migration fails. Legacy managed
installations are never overwritten; remove the old managed installation
first, then use the signed installer so only one `ideality` remains on `PATH`.

## Command Reference

| Area | Commands |
|:--|:--|
| **Start** | `init`, `setup`, `install`, `tui` |
| **Inspect** | `status`, `explain`, `env`, `doctor`, `prompt` |
| **Execute** | `run`, `auth` |
| **Identities** | `identity list|show|add|remove|bind|unbind|default|ssh-public` |
| **Tools** | `tool list|packs|enable-pack|disable-pack|add|remove|env|args|enable|disable` |
| **Networks** | `network list|show|add|bind|up|down|status|remove` |
| **Machines** | `vm list|show|add|bind|unbind|start|stop|status|exec|remove` |
| **Secrets** | `secret set|list|backend` |
| **Extensions** | `plugin list|validate|install|remove`, `skills install` |
| **Governance** | `policy check`, `audit status|enable|disable|list|prune|clear` |
| **Recovery** | `rollback`, `config path|validate|show|migrate|edit`, `update` |
| **Shell** | `hook`, `completion zsh|bash|fish` |

Run `ideality --help` or `ideality <command> --help` for flags and examples.

## Documentation

| Guide | Covers |
|:--|:--|
| [Architecture](docs/architecture.md) | Runtime layers, adapter trust boundaries, persistence, and release distribution |
| [Tool packs and isolation](docs/tool-packs.md) | Built-in adapters, isolation grades, mechanisms, and upstream controls |
| [Network and VM isolation](docs/network-vm.md) | VPN enforcement, VM backends, requirements, and security boundaries |
| [Custom adapters](docs/custom-adapters.md) | Portable tool manifests, templates, value sources, and contracts |
| [Team policy contracts](docs/policy.md) | Handover constraints, findings, and CI enforcement |
| [Releasing](docs/releasing.md) | Signed artifacts, provenance, and local rehearsal |
| [Agent skills](skills/README.md) | Vercel Skills installation and skills for operating or contributing to Ideality |
| [Security](SECURITY.md) | Credential handling and local operational guidance |
| [Changelog](CHANGELOG.md) | Release history |

## Development

```bash
bun install --frozen-lockfile
bun run dev -- --help
bun run check
bun run audit
bun run perf:check
bun run build
```

`bun run check` verifies formatting, lint, TypeScript, the built-in catalog,
privileged adapter contracts, generated documentation, and the full test suite.

Adding a built-in tool adapter is a two-file contribution: one manifest and one
behavior contract. The repository scaffolder registers it and regenerates the
catalog documentation:

```bash
bun run catalog:new acme --display-name "Acme CLI" --pack deployment
bun run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for adapter contracts, privileged
contribution rules, tests, and pull request templates.

## License

Ideality is available under the [MIT License](LICENSE).
