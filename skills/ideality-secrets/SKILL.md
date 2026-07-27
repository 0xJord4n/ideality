---
name: ideality-secrets
description: Manage Ideality secret references and backends. Use when storing tool credentials, selecting a local or password-manager backend, or auditing redaction and file protections.
---

# Secrets in ideality

Profiles reference secrets logically (`secret:` sources), never literal
tokens. Values are resolved through the configured backend only while
starting the selected tool.

## Set and list references

```bash
ideality secret set work railway RAILWAY_API_TOKEN
printf '%s' "$TOKEN" |
  ideality secret set work cf CLOUDFLARE_API_TOKEN --stdin
ideality secret list
```

## Backends

The default backend stores locked local files (mode-`600` values under
`~/.ideality/secrets`). Switch to an encrypted or external backend:

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

Password-manager references use their native schemes:

| Backend | Reference | Read via |
| --- | --- | --- |
| 1Password | `secret:op://Vault/Item/credential` | `op read` |
| Bitwarden | `secret:bw://<item-id-or-name>` | `bw get password` (login password; optional app-data directory isolates the account) |
| Dashlane | `secret:dl://<secret-id>/<field>` | `dcli read` |

The 1Password, Bitwarden, and Dashlane backends are **read-only** in
ideality: create or update their items with the native application or CLI.

## Guarantees and rules

- Logical secrets are forbidden in shell-scoped profiles (credentials cannot
  leak into the parent shell).
- `status`, `doctor`, `explain`, config output, audit history, and the TUI
  stay redacted. Run `ideality env --reveal` only when you intentionally need
  resolved values.
- Local secret directories are mode `700`; secret files and age ciphertext
  are atomically written with mode `600`.
- The age and `pass` backends receive values through stdin rather than
  command arguments.
- Secret values are never shown in TUI state, diffs, logs, or command
  arguments; secret entry in the TUI is masked.

## TUI administration

In `ideality tui`, press `k` to inspect the selected backend, stage backend
settings, list backend-owned logical references where safe listing is
supported, create or update writable backend secrets through masked input,
and delete references (deletion requires an explicit confirmation).
Secret list/write/delete requires any staged secret-backend change to be
saved or discarded before side effects run.

## Custom tool credentials

Wire a secret into a custom tool's environment per identity:

```bash
ideality tool env work acme ACME_TOKEN secret:{{identity}}/acme-token
ideality secret set work acme ACME_TOKEN
```

Secret keys must be identity-scoped with `{{identity}}` (enforced for the
built-in catalog). Add `--optional` when absence should disable the
credential rather than fail activation.
