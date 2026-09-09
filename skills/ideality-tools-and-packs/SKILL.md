---
name: ideality-tools-and-packs
description: Manage Ideality tool adapters and packs. Use when enabling tools, inspecting isolation or dispatch, or running authentication under a selected identity.
---

# Tool packs and adapters

The built-in catalog ships 58 adapters across 7 selectable packs: Developer
essentials, Cloud accounts, Source control, Editors and desktop, Package
registries, Deployment platforms, and AI tools. The complete registry stays in
the config, but identity profiles and shims are created only for selected
tools.

## Enable and disable

```bash
ideality tool packs
ideality tool list
ideality tool enable-pack work cloud
ideality tool disable-pack work editors
ideality tool enable work stripe
ideality tool disable work stripe
ideality install            # refresh shims after changing selections
```

Recommended `ideality init` enables the Developer essentials pack. Choose
Advanced setup to select packs with arrow keys and Space, then fine-tune the
tools. `ideality identity add` always exposes the pack and tool selectors.

## Isolation grades

Adapters report isolation from the controls the upstream application exposes:

- `full` — the upstream CLI exposes a dedicated profile directory or complete
  user-data arguments; credentials, configuration, history, and caches move
  under `~/.ideality/profiles/<identity>`.
- `partial` — supported state is relocated, but the app may still use an OS
  keychain, machine service, platform-specific location, or unrelocatable
  cache.
- `credentials` — account selection is isolated through logical secrets or
  SSH; noncredential state may remain shared.

Every adapter still receives process isolation: variables managed by other
identities are removed before the selected profile is injected. When shared
host state is not acceptable for a `partial`/`credentials` tool, use a VM
profile (see the `ideality-network-vm` skill).

## Bun exception

Bun has a profile but no automatic shim (a Bun shim could intercept the
`#!/usr/bin/env bun` used to start ideality itself and recurse). Run it
explicitly:

```bash
ideality run bun -- install
ideality run bun -- publish
```

## Inspect dispatch

```bash
ideality status
ideality explain vercel
ideality explain cf --path ~/code/work/project --json
ideality env
```

## Per-identity auth

```bash
ideality auth gh status
ideality auth railway login --identity work
ideality auth gh login
ideality auth gh status
ideality auth gh logout
ideality auth status --all
```

Starter profiles use logical secret references, never literal tokens — a
missing optional secret does not block interactive login; once set, the
secret backend overrides ambient credentials for that identity (see the
`ideality-secrets` skill).
