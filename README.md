# ideality

Folder-based identity orchestration for developer tools.

Ideality resolves an identity from the current directory, applies only that
identity's environment, and keeps tools with broad variables such as `HOME` or
`XDG_CONFIG_HOME` isolated to a child process. The CLI is built with
[Bunli](https://bunli.dev/docs), and its dashboard uses
[OpenTUI](https://opentui.com/docs/getting-started/).

## Features

- Deterministic longest-root matching with a configured fallback identity
- Git author, signing, and per-directory SSH private key selection
- GitHub CLI, Railway, Cloudflare, Vercel, Codex, Claude Code, and OpenCode
- Isolated Chrome and Firefox profiles
- Custom executables, environment variables, arguments, and secret sources
- Zsh, Bash, and Fish hooks with process-scoped wrappers
- Secure Ed25519 key generation and file-backed credential storage
- JSON output for automation and an interactive OpenTUI dashboard
- Local diagnostics for paths, permissions, executables, and unsafe literals

## Install

Requires Bun 1.3 or newer.

```bash
bun install
bun run check
bun run build
bun link
```

Run the guided setup:

```bash
ideality init
```

For scripts and provisioning, use the prompt-free mode:

```bash
ideality init --non-interactive \
  --id default \
  --label Default \
  --root ~/code \
  --git-name "Example Developer" \
  --git-email developer@example.com \
  --generate-ssh \
  --install \
  --shell zsh
```

Interactive mode is selected automatically in a terminal. Use `--interactive`
to force the wizard or `--non-interactive` to guarantee that no prompt occurs.

All managed files live under one root:

```text
~/.ideality/
  config.jsonc
  secrets/
  profiles/
  ssh/
  git/
  shell/
```

Set
`IDEALITY_HOME` to relocate all managed files, or `IDEALITY_CONFIG` to select a
specific registry.

## Daily Use

```bash
ideality status
ideality status --json
ideality tui

ideality identity add work \
  --root ~/code/work \
  --git-name "Work Developer" \
  --git-email developer@company.example \
  --generate-ssh

ideality identity ssh-public work
ideality identity bind work ~/projects/client-a
ideality identity default personal
```

The shell hook re-evaluates the identity whenever the directory changes. Tools
that need process-only isolation are exposed as shell functions, so `claude`,
`vercel`, `opencode`, `chrome`, and `firefox` transparently pass through
`ideality run`.

Use an explicit identity or directory when scripting:

```bash
ideality run gh --identity work -- auth status
ideality run chrome --identity personal -- https://github.com
ideality env --path ~/code/work/project --shell zsh
```

## Credentials

Starter identities use file references rather than literal tokens. Write them
without placing values in shell history:

```bash
ideality secret set work railway RAILWAY_API_TOKEN
ideality secret set work cf CLOUDFLARE_API_TOKEN
printf '%s' "$TOKEN" | ideality secret set work railway RAILWAY_API_TOKEN --stdin
ideality secret list
```

File sources using `{{root}}` require `secret set --path <directory>`. The
directory must match a root owned by that identity.

Secret directories are created with mode `700`; files are atomically written
with mode `600`. `status`, `doctor`, and the TUI never print resolved values.
`ideality env --reveal` is the explicit escape hatch for debugging.

## Tool Isolation

| Tool | Scope | Mechanism |
| --- | --- | --- |
| Git | native | generated `includeIf` files and `core.sshCommand` |
| GitHub CLI | shell | `GH_CONFIG_DIR` |
| Railway | shell | `RAILWAY_API_TOKEN` file source |
| Cloudflare | shell | token, account, and zone variables |
| Codex | shell | `CODEX_HOME` |
| Vercel | process | identity-specific XDG directories |
| Claude Code | process | `CLAUDE_CONFIG_DIR` |
| OpenCode | process | identity-specific XDG directories |
| Chrome | process | `--user-data-dir` |
| Firefox | process | `-profile` |

Authenticate from a matching directory after installation, or use
`ideality run <tool> --identity <id>`. Each tool then writes into its selected
profile.

## Custom Tools

```bash
ideality tool add acme --executable acme --isolation process
ideality tool env work acme ACME_HOME value:{{idealityHome}}/profiles/work/acme
ideality tool env work acme ACME_TOKEN file:{{idealityHome}}/secrets/work/acme-token --optional
ideality tool args work acme -- --region eu
ideality run acme --identity work -- account show
```

String templates in values and arguments support `{{identity}}`, `{{home}}`,
`{{idealityHome}}`, and `{{root}}`. See
[custom adapters](docs/custom-adapters.md).

## Command Map

```text
ideality init
ideality status|whoami|current
ideality env
ideality run|x
ideality identity list|show|add|remove|bind|unbind|default|ssh-public
ideality tool list|add|remove|env|args|enable|disable
ideality secret set|list
ideality install
ideality hook
ideality doctor
ideality config path|validate|show|edit
ideality tui
```

## Development

```bash
bun run dev -- --help
bun run typecheck
bun test
bun run build
```

`bun run build` targets Linux x64 for local development. Cross-platform
standalone builds require OpenTUI's optional runtime packages for each target,
then `bun run build:all`.

## License

MIT
