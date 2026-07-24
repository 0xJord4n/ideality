# Team Policy Contracts

A team policy pins what a project handover may contain. It lives next to the
handover at `.ideality/policy.jsonc` (JSONC: comments and trailing commas are
allowed) and is validated against `.ideality/project.jsonc` with:

```bash
ideality policy check
ideality policy check --json
ideality policy check --path ~/code/work/project
```

The command prints every violation and exits with status `1` when the policy
is missing, malformed, or unsatisfied, which makes it usable directly as a CI
gate. The `p` key inside `ideality tui` shows the same summary and findings.

## Schema

`version` is required and must be `1`. Every other section is optional; an
absent section enforces nothing.

```jsonc
{
  "version": 1,
  "label": "Acme platform team",
  "tools": {
    // Only these tool names may be defined by the handover.
    "permitted": ["gh", "vercel", "railway"],
  },
  "network": {
    // Every enabled identity/tool pairing must route through a network.
    "required": true,
    // Network profiles may only use these drivers.
    "permittedDrivers": ["wireguard", "mullvad"],
  },
  "vm": {
    // Every enabled identity/tool pairing must execute inside a VM.
    "required": false,
    "permittedDrivers": ["lima"],
  },
  "secrets": {
    // The handover must declare a secret backend...
    "requireBackend": true,
    // ...and it must be one of these types.
    "permittedBackends": ["age", "onepassword", "pass"],
  },
  "custom": {
    // Forbid tool definitions with custom auth commands.
    "toolCommands": false,
    // Forbid `driver: "custom"` network profiles.
    "networkCommands": false,
    // Forbid `driver: "custom"` VM profiles.
    "vmCommands": false,
    // Forbid Lima provisioning scripts.
    "vmProvisioning": false,
  },
}
```

Driver and backend names match the main configuration schema: network drivers
are `wireguard`, `openvpn`, `mullvad`, `tailscale`, `warp`, and `custom`; VM
drivers are `lima`, `apple-vz`, `cloud-hypervisor`, `firecracker`, and
`custom`; secret backends are `file`, `age`, `keychain`, `pass`,
`onepassword`, `bitwarden`, and `dashlane`.

## Findings

Each violation carries a stable `code` plus the offending `subject`:

| Code | Meaning |
| --- | --- |
| `policy-missing` | No `.ideality/policy.jsonc` in the project |
| `policy-malformed` | The policy file is not valid JSONC |
| `policy-version-mismatch` | The policy declares an unsupported `version` |
| `policy-invalid` | The policy does not match the schema above |
| `project-missing` / `project-invalid` | The handover is absent or invalid |
| `tool-not-permitted` | A tool is not on the allowlist |
| `custom-tool-commands-denied` | A tool declares custom auth commands |
| `network-driver-not-permitted` | A network profile uses a forbidden driver |
| `custom-network-commands-denied` | A `custom` network profile is forbidden |
| `vm-driver-not-permitted` | A VM profile uses a forbidden driver |
| `custom-vm-commands-denied` | A `custom` VM profile is forbidden |
| `vm-provisioning-denied` | A Lima profile declares provisioning scripts |
| `vm-required` | An enabled tool does not execute inside a VM |
| `network-required` | An enabled tool does not route through a network |
| `secret-backend-required` | The handover declares no secret backend |
| `secret-backend-not-permitted` | The declared backend type is forbidden |

## CI Use

Commit both `.ideality/project.jsonc` and `.ideality/policy.jsonc`, then fail
the pipeline on drift. Example GitHub Actions step:

```yaml
- uses: oven-sh/setup-bun@v2
- name: Enforce ideality team policy
  run: |
    bun install --frozen-lockfile
    bun run src/index.ts policy check --json
```

With a compiled `ideality` binary on the runner the step is just
`ideality policy check`. The JSON output (`status`, `policy`, `findings[]`
with `code`, `subject`, and `message`) is stable for machine consumption, so
pipelines can annotate pull requests with the exact violations.
