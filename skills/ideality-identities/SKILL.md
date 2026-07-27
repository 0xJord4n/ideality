---
name: ideality-identities
description: Manage Ideality identities. Use when creating accounts, changing folder ownership or the default identity, exporting SSH keys, or overriding identity resolution for one command.
---

# ideality identities

An identity bundles git author details, an SSH key, tool profiles, and one or
more folder roots. The identity for a command is resolved from `$PWD`: the
longest matching folder root wins; outside all roots, the configured default
identity is used.

## Create an identity

```bash
ideality identity add
ideality identity add --non-interactive --id work \
  --label Work \
  --root ~/code/work \
  --git-name "Work Developer" \
  --git-email developer@company.example \
  --generate-ssh
```

Interactive mode fuzzy-searches folders and SSH private keys and can generate
an Ed25519 key. The identity ID is derived from the display label; `--id` is
only an explicit override. Pack and tool selection happens during `add` — see
the `ideality-tools-and-packs` skill.

## Folder bindings and default

```bash
ideality identity list
ideality identity show work
ideality identity bind work ~/projects/client
ideality identity bind work ~/projects/client --dry-run
ideality identity unbind work ~/projects/client
ideality identity default work
```

## Git integration

Git uses generated `includeIf` configuration, including author, signing, and
`core.sshCommand`. Other tools use process-only shims and identity-specific
profile directories under `~/.ideality/profiles/<identity>`.

Export the SSH public key (e.g. to register with a forge):

```bash
ideality identity ssh-public work
```

## Explicit invocation

Automatic dispatch resolves the identity from the working directory. To
override it for one invocation:

```bash
ideality run gh --identity work -- auth status
ideality run chrome --identity work -- https://github.com
```

`ideality x` is an alias for `ideality run`.

## Inspect resolution

```bash
ideality status                                   # active identity here
ideality whoami                                   # aliases: whoami, current
ideality explain vercel                           # why this identity/profile
ideality explain cf --path ~/code/work/project --json
```

## Remove

```bash
ideality identity remove client
```

Registry writes are atomic and keep the newest 50 previous valid configs in
`~/.ideality/history` — recover with `ideality rollback` (see the
`ideality-troubleshooting` skill).

The change is complete when `ideality status` from each affected root selects
the intended identity and `ideality explain <tool>` shows its expected
profile.
