---
name: ideality-project-setup
description: Set up projects and team handovers with Ideality. Use when onboarding a repository, sharing reviewed identity requirements, automating setup, or enforcing a handover policy in CI.
---

# Project setup and team handovers

## The wizard

Run anywhere inside a repository:

```bash
ideality setup
```

Five decisions in the normal arrow-key flow:

1. Store a complete handover in `.ideality/project.jsonc`, or activate locally.
2. Fuzzy-select an existing identity, import the project identity, or create one.
3. Select project tools with Up/Down, Space, and Enter.
4. Optionally select a host VPN or VM execution profile.
5. Review the exact identity, tools, files, and integrations before applying.

Only relevant branches appear. `--advanced` also exposes SSH key selection,
full versus requirements-only handover, and integration controls. Existing
handovers preselect their tools and can import their identity on a new
machine.

## Trust model

The project file uses the complete ideality configuration schema: Git and SSH
settings, built-in or custom tool definitions, isolated profiles, arguments,
environment sources, secret backend settings, and literal values.

- Credential-like literals require an explicit interactive confirmation.
- The same review covers custom adapter commands and VM provisioning scripts.
- Non-interactive trust requires `--yes`.
- The file never executes commands merely because a repository was opened; a
  teammate reviews and applies it with `ideality setup`.

Applying a project adds the project root and selected profiles to the local
identity without deleting unrelated identities or tools — the user registry
under `~/.ideality` remains intact.

## Automation

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

Requirements-only handovers omit execution profiles; full handovers include
referenced network and VM profiles.

## Team policy contracts

A policy pins what a handover may contain. It lives at
`.ideality/policy.jsonc` (JSONC — comments and trailing commas allowed) and is
validated against `.ideality/project.jsonc`:

```bash
ideality policy check
ideality policy check --json
ideality policy check --path ~/code/work/project
```

Exit status is `1` when the policy is missing, malformed, or unsatisfied —
directly usable as a CI gate. `ideality setup` enforces a present policy file
before writing anything; `--allow-policy-violations` is an explicit
one-invocation override (`--yes` does NOT bypass policy).

Policy sections (all optional; `version: 1` required): `tools.permitted`,
`network.required` / `network.permittedDrivers`, `vm.required` /
`vm.permittedDrivers`, `secrets.requireBackend` / `secrets.permittedBackends`,
and `custom.{toolCommands,networkCommands,vmCommands,vmProvisioning}` to
forbid custom commands and Lima provisioning scripts.

Valid names: network drivers `wireguard`, `openvpn`, `mullvad`, `tailscale`,
`warp`, `custom`; VM drivers `lima`, `apple-vz`, `cloud-hypervisor`,
`firecracker`, `custom`; secret backends `file`, `age`, `keychain`, `pass`,
`onepassword`, `bitwarden`, `dashlane`.

CI example (GitHub Actions):

```yaml
- name: Install ideality
  run: curl -fsSL https://raw.githubusercontent.com/0xJord4n/ideality/main/scripts/install.sh | bash
- name: Enforce ideality team policy
  run: ~/.local/bin/ideality policy check --json
```

If the released binary is already on `PATH`, the check is simply
`ideality policy check --json`.
The JSON output (`status`, `policy`, `findings[]` with `code`, `subject`,
`message`) is stable for machine consumption. Violation codes include
`tool-not-permitted`, `network-driver-not-permitted`, `vm-required`,
`secret-backend-required`, `custom-tool-commands-denied`, and
`vm-provisioning-denied`.

Setup is complete when `ideality status` selects the intended local identity,
the reviewed `.ideality/project.jsonc` contains only the intended handover
scope, and `ideality policy check` exits zero when a policy is present.
