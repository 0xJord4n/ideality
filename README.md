# ideality

Folder-based identity orchestration for developer tools, built with
[Bunli](https://bunli.dev/docs) and
[OpenTUI](https://opentui.com/docs/getting-started/).

Ideality selects an identity from the current directory and starts each tool
with only that identity's process environment. It supports Git, GitHub CLI,
Railway, Cloudflare, Vercel, Codex, Claude Code, OpenCode, Chrome, Firefox, and
declarative custom plugins.

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

## Automatic Dispatch

`ideality install` adds `~/.ideality/bin` to `PATH`. Managed shims in that
directory intercept every registered tool, resolve the identity from `$PWD`,
strip variables managed by other identities, inject the selected tool profile,
and execute the real binary. Running `vercel`, `gh`, `railway`, `cf`, an AI
CLI, or a browser needs no explicit wrapper.

```bash
ideality status
ideality explain vercel
ideality explain cf --path ~/code/work/project --json
ideality auth gh status
ideality auth railway login --identity work
ideality tui
```

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
  "version": 1,
  "name": "acme",
  "executable": "acme",
  "detect": ["acme-cli"],
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
`{{root}}`. See [custom adapters](docs/custom-adapters.md).

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
ideality status|whoami|current
ideality env
ideality run|x
ideality explain
ideality prompt
ideality auth <tool> login|status|logout
ideality identity list|show|add|remove|bind|unbind|default|ssh-public
ideality tool list|add|remove|env|args|enable|disable
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

## License

MIT
