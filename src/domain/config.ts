export type ValueSource =
  | string
  | { from: "file"; path: string; optional?: boolean }
  | { from: "env"; name: string; optional?: boolean }
  | { from: "secret"; key: string; optional?: boolean };

export type SecretBackendConfig =
  | { type: "file"; directory?: string }
  | {
      type: "age";
      directory?: string;
      recipient: string;
      identityFile: string;
    }
  | { type: "keychain"; service?: string }
  | { type: "pass"; prefix?: string }
  | { type: "onepassword" }
  | { type: "bitwarden"; appDataDirectory?: string }
  | { type: "dashlane" };

export interface ToolProfile {
  enabled?: boolean;
  executable?: string;
  isolation?: "shell" | "process";
  execution?: ExecutionTarget;
  env?: Record<string, ValueSource | null>;
  args?: string[];
}

export type ExecutionTarget =
  | {
      target: "host";
      network?: string;
    }
  | {
      target: "vm";
      vm: string;
      network?: string;
    };

export interface GitIdentity {
  name: string;
  email: string;
  sshKey?: string;
  signingKey?: string;
  gpgSign?: boolean;
}

export interface IdentityConfig {
  label: string;
  roots: string[];
  color?: string;
  git?: GitIdentity;
  execution?: ExecutionTarget;
  tools: Record<string, ToolProfile>;
}

export interface ToolDefinition {
  executable: string;
  displayName?: string;
  description?: string;
  isolation?: "shell" | "process";
  pack?: string;
  stateIsolation?: "full" | "partial" | "credentials";
  shim?: boolean;
  detect?: string[];
  auth?: Partial<Record<AuthAction, string[]>>;
}

export type AuthAction = "login" | "status" | "logout";

export type NetworkDnsConfig =
  | "provider"
  | "system"
  | {
      servers: string[];
      search?: string[];
    };

export interface NetworkProfileBase {
  label?: string;
  sudo?: boolean;
  killSwitch?: "required" | "provider" | "off";
  dns?: NetworkDnsConfig;
  ipv6?: "tunnel" | "block";
  lan?: "deny" | "allow";
}

export type NetworkProfile =
  | (NetworkProfileBase & {
      driver: "wireguard";
      config: ValueSource;
      executable?: string;
      interface?: string;
    })
  | (NetworkProfileBase & {
      driver: "openvpn";
      config: ValueSource;
      username?: ValueSource;
      password?: ValueSource;
      executable?: string;
      extraArgs?: string[];
    })
  | (NetworkProfileBase & {
      driver: "mullvad";
      executable?: string;
      location?: {
        country?: string;
        city?: string;
        hostname?: string;
      };
    })
  | (NetworkProfileBase & {
      driver: "tailscale";
      executable?: string;
      exitNode: string;
      allowLanAccess?: boolean;
      acceptRoutes?: boolean;
      shieldsUp?: boolean;
    })
  | (NetworkProfileBase & {
      driver: "warp";
      executable?: string;
    })
  | (NetworkProfileBase & {
      driver: "custom";
      connect: string[];
      disconnect: string[];
      status: string[];
      env?: Record<string, ValueSource>;
      verifiedKillSwitch?: boolean;
    });

export interface VmMount {
  source: string;
  target: string;
  writable?: boolean;
}

export interface VmProfileBase {
  label?: string;
  cpus?: number;
  memoryMiB?: number;
  diskGiB?: number;
  image?: string;
  guestHome?: string;
  workspaceTarget?: string;
  mounts?: VmMount[];
  network?: string;
  video?: boolean;
}

export type VmProfile =
  | (VmProfileBase & {
      driver: "lima";
      instance?: string;
      vmType?: "auto" | "vz" | "qemu";
      mountType?: "auto" | "virtiofs" | "9p" | "reverse-sshfs";
      rosetta?: boolean;
      provision?: string[];
    })
  | (VmProfileBase & {
      driver: "apple-vz" | "cloud-hypervisor" | "firecracker";
      helper?: string;
    })
  | (VmProfileBase & {
      driver: "custom";
      start: string[];
      stop: string[];
      status: string[];
      exec: string[];
    });

export interface IdealityConfig {
  version: 1;
  defaultIdentity: string;
  secretBackend?: SecretBackendConfig;
  identities: Record<string, IdentityConfig>;
  tools: Record<string, ToolDefinition>;
  networks?: Record<string, NetworkProfile>;
  vms?: Record<string, VmProfile>;
}

export interface ResolvedIdentity {
  id: string;
  identity: IdentityConfig;
  path: string;
  matchedRoot: string | null;
  isDefault: boolean;
}
