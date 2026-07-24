import type { AuthAction, ToolDefinition } from "../domain/config.js";

export function authArguments(
  definition: ToolDefinition,
  action: AuthAction,
): string[] {
  const args = definition.auth?.[action];
  if (!args) {
    throw new Error(
      `Tool '${definition.description ?? definition.executable}' does not support auth ${action}`,
    );
  }
  return [...args];
}
