import {
  parsePrivilegedAdapterManifest,
  type NetworkAdapterManifest,
  type PrivilegedAdapterManifest,
  type SecretAdapterManifest,
  type VmAdapterManifest,
} from "../core/privileged-adapters.js";

import networkWireguard from "../../privileged-adapters/network-wireguard.jsonc" with {
  type: "text",
};
import networkOpenvpn from "../../privileged-adapters/network-openvpn.jsonc" with {
  type: "text",
};
import networkMullvad from "../../privileged-adapters/network-mullvad.jsonc" with {
  type: "text",
};
import networkTailscale from "../../privileged-adapters/network-tailscale.jsonc" with {
  type: "text",
};
import networkWarp from "../../privileged-adapters/network-warp.jsonc" with {
  type: "text",
};
import networkCustom from "../../privileged-adapters/network-custom.jsonc" with {
  type: "text",
};
import vmLima from "../../privileged-adapters/vm-lima.jsonc" with {
  type: "text",
};
import vmAppleVz from "../../privileged-adapters/vm-apple-vz.jsonc" with {
  type: "text",
};
import vmCloudHypervisor from "../../privileged-adapters/vm-cloud-hypervisor.jsonc" with {
  type: "text",
};
import vmFirecracker from "../../privileged-adapters/vm-firecracker.jsonc" with {
  type: "text",
};
import vmCustom from "../../privileged-adapters/vm-custom.jsonc" with {
  type: "text",
};
import secretFile from "../../privileged-adapters/secret-file.jsonc" with {
  type: "text",
};
import secretAge from "../../privileged-adapters/secret-age.jsonc" with {
  type: "text",
};
import secretKeychain from "../../privileged-adapters/secret-keychain.jsonc" with {
  type: "text",
};
import secretPass from "../../privileged-adapters/secret-pass.jsonc" with {
  type: "text",
};
import secretOnepassword from "../../privileged-adapters/secret-onepassword.jsonc" with {
  type: "text",
};
import secretBitwarden from "../../privileged-adapters/secret-bitwarden.jsonc" with {
  type: "text",
};
import secretDashlane from "../../privileged-adapters/secret-dashlane.jsonc" with {
  type: "text",
};

function network(source: string): NetworkAdapterManifest {
  const manifest = parsePrivilegedAdapterManifest(source);
  if (manifest.adapterKind !== "network") {
    throw new Error(
      `Expected network adapter, received '${manifest.adapterKind}'`,
    );
  }
  return manifest;
}

function vm(source: string): VmAdapterManifest {
  const manifest = parsePrivilegedAdapterManifest(source);
  if (manifest.adapterKind !== "vm") {
    throw new Error(`Expected VM adapter, received '${manifest.adapterKind}'`);
  }
  return manifest;
}

function secret(source: string): SecretAdapterManifest {
  const manifest = parsePrivilegedAdapterManifest(source);
  if (manifest.adapterKind !== "secret") {
    throw new Error(
      `Expected secret adapter, received '${manifest.adapterKind}'`,
    );
  }
  return manifest;
}

export const BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS = {
  network: {
    wireguard: network(networkWireguard),
    openvpn: network(networkOpenvpn),
    mullvad: network(networkMullvad),
    tailscale: network(networkTailscale),
    warp: network(networkWarp),
    custom: network(networkCustom),
  },
  vm: {
    lima: vm(vmLima),
    "apple-vz": vm(vmAppleVz),
    "cloud-hypervisor": vm(vmCloudHypervisor),
    firecracker: vm(vmFirecracker),
    custom: vm(vmCustom),
  },
  secret: {
    file: secret(secretFile),
    age: secret(secretAge),
    keychain: secret(secretKeychain),
    pass: secret(secretPass),
    onepassword: secret(secretOnepassword),
    bitwarden: secret(secretBitwarden),
    dashlane: secret(secretDashlane),
  },
} as const;

export const BUILTIN_PRIVILEGED_ADAPTERS: readonly PrivilegedAdapterManifest[] =
  [
    ...Object.values(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.network),
    ...Object.values(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.vm),
    ...Object.values(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.secret),
  ];
