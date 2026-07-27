---
name: ideality-network-vm
description: Configure Ideality network and VM isolation. Use when routing a tool through a VPN or VM, managing the host network lease, or diagnosing enforcement and backend availability.
---

# Network and VM isolation

Network and VM profiles are folder-aware execution requirements. The managed
shim enforces the selected host VPN before it starts a native tool or VM:

```text
tool shim
  -> resolve the longest matching folder identity
  -> resolve tool override, identity target, then VM network default
  -> acquire or verify the host network lease
  -> start the VM when selected
  -> inject only the selected identity environment
  -> execute the real tool
```

## Quick start

```bash
ideality network add
ideality vm add
ideality vm bind work secure-workspace
ideality network bind work private-europe --tool chrome
ideality status
ideality explain codex
ideality doctor --strict
```

Profile IDs are derived from labels; `--id` only overrides. Use
`ideality vm unbind <identity>` to return to host execution, or add
`--tool <name>` to override only one tool.

Non-interactive examples:

```bash
ideality network add --non-interactive \
  --label "Private Europe" --driver mullvad \
  --country de --dns provider --ipv6 tunnel --lan deny

ideality network add --non-interactive \
  --label "Team exit node" --driver tailscale \
  --exit-node exit.example.net --kill-switch provider

ideality network add --non-interactive \
  --label "Managed WARP" --driver warp --kill-switch provider

ideality vm add --non-interactive \
  --label "Secure workspace" --driver lima \
  --cpus 4 --memory 8192 --disk 60 \
  --mount '{{root}}' --network private-europe
```

## Enforcement levels

- `required` (default) fails unless leak prevention is verified.
- `provider` explicitly trusts the provider or operating-system setup.
- `off` starts the tunnel without claiming leak prevention.
- `--allow-unverified` is a one-invocation escape hatch recorded as
  `unverified` in the active lease.

Mullvad is the built-in strict adapter: ideality enables Lockdown mode before
connecting and reasserts it before every process. Raw `wg-quick` and OpenVPN
configure tunnels, not a host firewall, so `required` fails closed for those
drivers — use a custom OS adapter with `verifiedKillSwitch: true` or select
weaker enforcement. Tailscale (explicit exit node required) and WARP are
provider-level: the tunnel establishes the route, but a verified no-leak
claim still needs host firewall enforcement.

## The host lease

Only one host network profile can own the lease — changing the system route
affects every native application.

```bash
ideality network up private-europe
ideality network up team-exit-node --replace     # explicit switch
ideality network down                       # Mullvad: Lockdown stays active
ideality network down --release             # deliberately restore normal connectivity
ideality network list
ideality network show private-europe
ideality network status private-europe
ideality network remove private-europe --force
```

No VPN credentials are written to the workspace: WireGuard/OpenVPN values
resolve through the secret backend, are materialized under
`~/.ideality/runtime/networks` with mode `600`, and are removed after the
provider command returns.

## VM boundary

Lima is the directly executable backend (macOS: Apple VZ + VirtioFS; Linux:
QEMU + 9p). The generated profile mounts only the selected workspace,
disables automatic port forwards and containerd, disables Lima's host DNS
resolver when a VPN is required, and propagates only selected identity
variables into the guest. The VPN is enforced on the host before the VM
starts.

Apple VZ, Cloud Hypervisor, and Firecracker use explicit helpers
(`ideality-vz-helper`, `ideality-cloud-hypervisor-helper`,
`ideality-firecracker-helper`) and report unavailable until installed;
Firecracker also requires Linux and `/dev/kvm`. Lima targets CLI workloads —
native desktop apps should use a host target with the enforced VPN.

The guest must contain every selected tool: use a prebuilt image or pass
`--provision` as a JSON array of idempotent system shell scripts (run during
instance setup; changing them later does not rebuild the guest).

```bash
ideality vm list
ideality vm show secure-workspace
ideality vm start secure-workspace
ideality vm stop secure-workspace
ideality vm status secure-workspace
ideality vm remove secure-workspace --force
ideality vm exec secure-workspace -- bun test
```

## Boundary caveat

ideality prevents a configured application from starting before its declared
network is enforced; it cannot prevent traffic emitted during host boot
before the VPN daemon and firewall exist. `ideality doctor --strict` reports
missing helpers and unsupported strict profiles.

The boundary is ready when `network status` reports the intended enforcement,
`vm status` succeeds for a selected VM, `explain <tool>` shows the expected
route, and `doctor --strict` has no unresolved enforcement failure.
