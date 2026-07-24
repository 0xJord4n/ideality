export type ValueSource =
  | string
  | { from: "file"; path: string; optional?: boolean }
  | { from: "env"; name: string; optional?: boolean };

export interface ToolProfile {
  enabled?: boolean;
  executable?: string;
  isolation?: "shell" | "process";
  env?: Record<string, ValueSource | null>;
  args?: string[];
}

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
  tools: Record<string, ToolProfile>;
}

export interface ToolDefinition {
  executable: string;
  description?: string;
  isolation?: "shell" | "process";
  detect?: string[];
  auth?: Partial<Record<AuthAction, string[]>>;
}

export type AuthAction = "login" | "status" | "logout";

export interface IdealityConfig {
  version: 1;
  defaultIdentity: string;
  identities: Record<string, IdentityConfig>;
  tools: Record<string, ToolDefinition>;
}

export interface ResolvedIdentity {
  id: string;
  identity: IdentityConfig;
  path: string;
  matchedRoot: string | null;
  isDefault: boolean;
}
