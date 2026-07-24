# Network and VM isolation

Ideality can attach an identity, or one tool inside an identity, to a host VPN
and an optional virtual machine. The managed shim is the middleware:

```text
tool shim
  -> resolve the longest matching folder identity
  -> resolve tool override, identity target, then VM network default
  -> acquire or verify the host network lease
  -> start the VM when selected
  -> inject only the selected identity environment
  -> execute the real tool
```

No VPN credentials are written to the project workspace. WireGuard and OpenVPN
values are resolved through the secret backend, materialized under
`~/.ideality/runtime/networks` with mode `600`, and removed after the provider
command returns. Persistent network state contains only profile and identity
IDs, the driver, enforcement level, and activation time.

## Quick start

```bash
ideality network add
ideality vm add
ideality vm bind <identity> <vm-profile>
ideality status
ideality explain codex
```

Profile IDs are derived from labels. Use `--id` only to override them.

The equivalent non-interactive setup is:

```bash
ideality network add \
  --non-interactive \
  --label "Private Europe" \
  --driver mullvad \
  --country de \
  --dns provider \
  --ipv6 tunnel \
  --lan deny

ideality vm add \
  --non-interactive \
  --label "Secure workspace" \
  --driver lima \
  --cpus 4 \
  --memory 8192 \
  --disk 60 \
  --mount '{{root}}' \
  --network private-europe

ideality vm bind <identity> secure-workspace
```

Use `ideality vm unbind <identity>` to return to normal host execution, or add
`--tool <name>` to override only one tool.

Running `codex`, `gh`, `vercel`, a browser, or another managed tool from that
identity now performs the complete dispatch automatically.

## Wizard flow

`ideality network add`:

1. Profile label.
2. Provider: Mullvad, WireGuard, OpenVPN, or custom.
3. Fuzzy file search for WireGuard/OpenVPN configuration when applicable.
4. Provider settings, DNS, IPv6, LAN policy, and required kill-switch level.
5. Review and confirmation.

`ideality vm add`:

1. Profile label.
2. Backend: Lima, Apple VZ helper, Cloud Hypervisor helper, Firecracker helper,
   or custom.
3. Fuzzy directory search for the only host workspace exposed to the guest.
4. Optional host-enforced VPN.
5. CPU, memory, disk, image, and optional idempotent provisioning scripts.
6. Review and confirmation.

`ideality setup` adds an optional execution step after tool selection. It can
leave the identity on the host, select a host VPN, or select a VM. Full project
handovers include referenced network and VM profiles. Requirements-only
handovers omit execution profiles.

Full handovers can contain custom adapter commands and root-level Lima
provisioning scripts. Interactive setup identifies these hooks and requires a
separate trust confirmation; non-interactive setup requires `--yes`.

## Enforcement levels

- `required` is the default and fails unless leak prevention is verified.
- `provider` explicitly trusts the provider or operating-system setup.
- `off` starts the tunnel without claiming leak prevention.
- `--allow-unverified` is a one-invocation escape hatch recorded as
  `unverified` in the active lease.

Mullvad is the built-in strict host adapter because Ideality enables Lockdown
mode before connecting and reasserts it before every process. Raw `wg-quick`
and OpenVPN configure tunnels, not an independent host firewall, so `required`
fails closed for those drivers. Use a custom operating-system adapter with
`verifiedKillSwitch: true`, or explicitly select weaker enforcement.

Only one host network profile can own the lease. Changing the system route
affects every native application, not only the child process.
`ideality network up <profile> --replace` performs an explicit switch.

Disconnecting Mullvad leaves Lockdown mode active by default:

```bash
ideality network down
ideality network down --release
```

The second form deliberately restores ordinary connectivity.

## VM boundary

Lima is the directly executable backend. On macOS it defaults to Apple VZ with
VirtioFS; on Linux it defaults to QEMU with 9p. The generated profile:

- mounts only the selected workspace;
- disables automatic port forwards and containerd;
- disables Lima's host DNS resolver when a VPN is required;
- propagates only selected identity variables into the guest.

The VPN is enforced on the host before the VM starts. A guest process cannot
choose a non-VPN host route, and provider Lockdown mode keeps traffic blocked
if the tunnel drops. Native host applications use the same active VPN.

Apple VZ, Cloud Hypervisor, and Firecracker profiles use explicit helpers named
`ideality-vz-helper`, `ideality-cloud-hypervisor-helper`, and
`ideality-firecracker-helper`. Ideality reports them unavailable until those
helpers are installed. Firecracker also requires Linux and `/dev/kvm`.

Lima is optimized for CLI workloads. Native macOS applications such as Discord
or a normal browser should use a host target with the enforced VPN. A complete
guest desktop requires a GUI-capable helper/backend and is not simulated by
the Lima adapter.

The guest must contain every selected tool. Use a prebuilt image or pass
`--provision` as a JSON array of idempotent system shell scripts. Lima runs
these scripts during instance setup; changing them after the instance exists
does not rebuild the guest automatically.

## Complete configuration

```jsonc
{
  "version": 1,
  "defaultIdentity": "sample",
  "secretBackend": {
    "type": "bitwarden",
    "appDataDirectory": "~/.config/bitwarden-private"
  },
  "identities": {
    "sample": {
      "label": "Sample",
      "roots": ["~/code/sample"],
      "execution": {
        "target": "vm",
        "vm": "secure-workspace"
      },
      "tools": {
        "codex": {},
        "chrome": {
          "execution": {
            "target": "host",
            "network": "private-europe"
          }
        }
      }
    }
  },
  "tools": {
    "codex": { "executable": "codex", "isolation": "process" },
    "chrome": { "executable": "google-chrome", "isolation": "process" }
  },
  "networks": {
    "private-europe": {
      "driver": "mullvad",
      "label": "Private Europe",
      "killSwitch": "required",
      "dns": "provider",
      "ipv6": "tunnel",
      "lan": "deny",
      "location": { "country": "de" }
    },
    "team-wireguard": {
      "driver": "wireguard",
      "killSwitch": "provider",
      "config": {
        "from": "secret",
        "key": "sample/vpn/wireguard"
      }
    },
    "legacy-openvpn": {
      "driver": "openvpn",
      "killSwitch": "provider",
      "config": {
        "from": "file",
        "path": "~/.config/vpn/team.ovpn"
      },
      "username": {
        "from": "secret",
        "key": "sample/vpn/username"
      },
      "password": {
        "from": "secret",
        "key": "sample/vpn/password"
      }
    }
  },
  "vms": {
    "secure-workspace": {
      "driver": "lima",
      "label": "Secure workspace",
      "cpus": 4,
      "memoryMiB": 8192,
      "diskGiB": 60,
      "vmType": "vz",
      "mountType": "virtiofs",
      "guestHome": "/home/ideality",
      "workspaceTarget": "/workspace",
      "mounts": [
        {
          "source": "{{root}}",
          "target": "/workspace",
          "writable": true
        }
      ],
      "network": "private-europe",
      "provision": [
        "#!/bin/sh\nset -eu\napt-get update\napt-get install -y git curl"
      ],
      "video": false
    }
  }
}
```

## Security boundary

Ideality prevents a configured application from starting before its declared
network is enforced. It cannot prevent traffic emitted earlier during host
boot, before the VPN daemon and host firewall exist. A true "no process ever
uses the physical route" policy requires an operating-system boot firewall or
an external gateway that permits only the VPN endpoint. `ideality doctor
--strict` reports missing helpers and unsupported strict profiles so this
boundary remains visible.
