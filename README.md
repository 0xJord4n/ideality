# ideality

Folder-based identity orchestration for developer tools, built with
[Bunli](https://bunli.dev/docs) and
[OpenTUI](https://opentui.com/docs/getting-started/).

Ideality selects an identity from the current directory and starts each tool
with only that identity's process environment. It supports Git plus
identity-aware packs for cloud accounts, source-control CLIs, editors and
desktop apps, package registries, deployment platforms, AI tools, browsers,
VPNs, VMs, and declarative custom plugins.

## Install

Requires Bun 1.3 or newer.

```bash
bun install
bun run check
bun run build
bun link
ideality init
```

Interactive mode is automatic in a terminal. The wizard fuzzy-searches folders
and SSH private keys, derives the identity ID from the display label, and can
generate an Ed25519 key. `--id` is only an explicit override.

For provisioning:

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

All managed state lives under `~/.ideality`:

```text
config.jsonc  bin/  completions/  git/  history/  plugins/
profiles/     secrets/  shell/    ssh/
```

Set `IDEALITY_HOME` to relocate the state directory or `IDEALITY_CONFIG` to
select a registry.

## Project Setup

Run the project wizard anywhere inside a repository:

```bash
ideality setup
```

The normal arrow-key flow has five decisions:

1. Store a complete handover in `.ideality/project.jsonc`, or activate locally.
2. Fuzzy-select an existing identity, import the project identity, or create one.
3. Select project tools with Up/Down, Space, and Enter.
4. Optionally select a host VPN or VM execution profile.
5. Review the exact identity, tools, files, and integrations before applying.

Only relevant branches appear. Creating an identity asks for Git details.
`--advanced` also exposes SSH key selection, full versus requirements-only
handover, and integration controls. Existing handovers preselect their tools
and can import their identity on a new machine.

The project file uses the complete Ideality configuration schema. It may carry
Git and SSH settings, built-in or custom tool definitions, isolated profiles,
arguments, environment sources, secret backend settings, and literal values.
Credential-like literals require an explicit interactive confirmation. The
same review covers custom adapter commands and VM provisioning scripts.
Non-interactive trust requires `--yes`. The file never executes commands
merely because a repository was opened; a teammate reviews and applies it with
`ideality setup`.

Automation uses the same operation without prompts:

```bash
ideality setup --non-interactive \
  --identity sample \
  --tools gh,cf,vercel,codex \
  --project \
  --yes

ideality setup --non-interactive \
  --identity sample \
  --tools gh,codex \
  --project \
  --requirements-only \
  --dry-run
```

The user registry under `~/.ideality` remains intact. Applying a project adds
the project root and selected profiles to its local identity without deleting
unrelated identities or tools.

## Tool Packs

`ideality init` and `ideality identity add` first select packs with arrow keys
and Space, then allow fine-grained tool selection. Only selected tools receive
identity profiles and managed shims.

```bash
ideality tool packs
ideality tool enable-pack <identity> cloud
ideality tool disable-pack <identity> editors
ideality tool enable <identity> stripe
ideality tool list
```

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
controls exposed by the upstream application. See the
[tool-pack and isolation matrix](docs/tool-packs.md).

## Automatic Dispatch

`ideality install` adds `~/.ideality/bin` to `PATH`. Managed shims in that
directory intercept every configured tool, resolve the identity from `$PWD`,
strip variables managed by other identities, inject the selected tool profile,
and execute the real binary. Running `vercel`, `gh`, `railway`, `cf`, an AI
CLI, or a browser needs no explicit wrapper.

Bun is intentionally not shimmed because it may be the runtime starting
Ideality itself. Use `ideality run bun -- <args>` when registry isolation is
required.

```bash
ideality status
ideality explain vercel
ideality explain cf --path ~/code/work/project --json
ideality auth gh status
ideality auth railway login --identity work
ideality tui
```

## VPN And VM Isolation

Network and VM profiles are folder-aware execution requirements. The shim
enforces the selected host VPN before it starts a native tool or VM. Mullvad
Lockdown mode is the built-in strict adapter; raw WireGuard and OpenVPN refuse
`required` mode until an operating-system kill-switch helper is configured.
Tailscale exit nodes and Cloudflare WARP are supported as provider-enforced
profiles.

```bash
ideality network add
ideality vm add
ideality vm bind <identity> <vm-profile>
ideality network bind <identity> <network-profile> --tool chrome
ideality network up <network-profile>
ideality vm exec <vm-profile> -- bun test
ideality doctor --strict
```

Lima is the executable macOS/Linux VM backend. Apple VZ, Cloud Hypervisor, and
Firecracker are capability-checked helper backends. Full configuration,
wizard steps, secret handling, and leak-prevention boundaries are in
[Network and VM isolation](docs/network-vm.md).

The longest matching folder root wins. Outside all roots, the configured
default identity is used. An explicit invocation remains available:

```bash
ideality run gh --identity work -- auth status
ideality run chrome --identity work -- https://github.com
```

## Identities

```bash
ideality identity add
ideality identity add --non-interactive --id work \
  --label Work \
  --root ~/code/work \
  --git-name "Work Developer" \
  --git-email developer@company.example \
  --generate-ssh
ideality identity ssh-public work
ideality identity bind work ~/projects/client
ideality identity default work
```

Git uses generated `includeIf` configuration, including author, signing, and
`core.sshCommand`. Other tools use process-only shims and identity-specific
profile directories.

## Secrets

Starter profiles use logical secret references, never literal tokens. The
default backend stores locked local files:

```bash
ideality secret set work railway RAILWAY_API_TOKEN
printf '%s' "$TOKEN" |
  ideality secret set work cf CLOUDFLARE_API_TOKEN --stdin
ideality secret list
```

Choose an encrypted or external backend:

```bash
ideality secret backend age \
  --recipient age1... \
  --identity-file ~/.config/age/keys.txt
ideality secret backend keychain
ideality secret backend pass --prefix developer/ideality
ideality secret backend onepassword
ideality secret backend bitwarden \
  --app-data-directory ~/.config/bitwarden-work
ideality secret backend dashlane
```

For 1Password, configure `secret:op://Vault/Item/credential`; Ideality reads it
with `op read`. Bitwarden uses `secret:bw://<item-id-or-name>` and retrieves the
login password with `bw get password`; an optional app-data directory isolates
the logged-in account. Dashlane uses its native
`secret:dl://<secret-id>/<field>` references with `dcli read`.

The 1Password, Bitwarden, and Dashlane backends are read-only in Ideality:
create or update their items using the native application or CLI. Secret values
are resolved only while starting the selected tool. Logical secrets are
forbidden in shell-scoped profiles. `status`, `doctor`, `explain`, config
output, and the TUI stay redacted.

Local secret directories are mode `700`; secret files and age ciphertext are
atomically written with mode `600`. The age and `pass` backends receive values
through stdin rather than command arguments.

## Custom Tools

```bash
ideality tool add acme --executable acme
ideality tool env work acme \
  ACME_HOME value:{{idealityHome}}/profiles/{{identity}}/acme
ideality tool env work acme ACME_TOKEN secret:{{identity}}/acme-token
ideality tool args work acme -- --region eu
```

Portable plugin manifest:

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
  "auth": { "status": ["account", "show"] },
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

Templates support `{{identity}}`, `{{home}}`, `{{idealityHome}}`, and
`{{root}}`. Existing version-1 plugin manifests are translated into this
canonical format during validation and installation. See
[custom adapters](docs/custom-adapters.md).

## Safety

Registry writes are atomic and retain the newest 50 previous valid configs in
`~/.ideality/history`.

```bash
ideality identity bind work ~/projects/client --dry-run
ideality plugin install acme.ideality.jsonc --dry-run
ideality install --dry-run
ideality rollback --list
ideality rollback latest --dry-run
ideality rollback latest
ideality doctor --strict
```

Shell support:

```bash
ideality completion zsh --install
ideality prompt
ideality prompt --format '{label}:{identity}'
```

## Command Map

```text
ideality init
ideality setup
ideality status|whoami|current
ideality env
ideality run|x
ideality explain
ideality prompt
ideality auth <tool> login|status|logout
ideality identity list|show|add|remove|bind|unbind|default|ssh-public
ideality tool list|packs|enable-pack|disable-pack|add|remove|env|args|enable|disable
ideality network list|show|add|bind|up|down|status|remove
ideality vm list|show|add|bind|unbind|start|stop|status|exec|remove
ideality plugin list|validate|install|remove
ideality secret set|list|backend
ideality install
ideality hook
ideality completion zsh|bash|fish
ideality rollback
ideality doctor
ideality config path|validate|show|edit
ideality tui
```

## Development

```bash
bun run dev -- --help
bun run check
bun run build
```

Adding a built-in tool adapter is fully tooled: `bun run catalog:new`
scaffolds the one manifest you author, and `bun run catalog:check` validates
the catalog, registry, docs, and editor schema. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
