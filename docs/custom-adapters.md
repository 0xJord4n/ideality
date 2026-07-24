# Custom adapters

An adapter has two layers:

- A global tool definition describes the executable and default isolation.
- Each identity has a profile containing environment assignments and arguments.

Use `process` isolation for identity-aware tools. Logical secrets are rejected
for shell-scoped profiles so credentials cannot leak into the parent shell.

## Value sources

`ideality tool env <identity> <tool> <variable> <source>` accepts:

```text
value:text        Store a non-secret literal
file:path         Read the value from a file at activation time
env:VARIABLE      Read the value from another environment variable
secret:key        Resolve a logical key through the configured backend
unset             Explicitly remove the variable
```

Add `--optional` to external sources when absence should disable the credential
rather than fail activation.

Password-manager references use their native schemes:

```text
op://Vault/Item/field       1Password
bw://item-id-or-name        Bitwarden login password
dl://secret-id/field        Dashlane
```

These password-manager backends are read-only in Ideality. Use their native
applications or CLIs to create and update vault items.

Paths and arguments support:

```text
{{identity}}      Selected identity ID
{{home}}          User home directory
{{idealityHome}}  Ideality state directory
{{root}}          Matched identity root, or the resolved path for an override
```

## Example

```bash
ideality tool add registry --executable registryctl --isolation process
ideality tool env work registry XDG_CONFIG_HOME value:{{idealityHome}}/profiles/{{identity}}/registry
ideality tool env work registry REGISTRY_TOKEN secret:{{identity}}/registry-token
ideality secret set work registry REGISTRY_TOKEN
ideality tool args work registry -- --endpoint https://registry.example
ideality run registry --identity work -- whoami
```

The executable is started with an argument array, never through a shell. Shell
assignment rendering validates variable names and single-quotes values.

For reusable integrations, prefer a plugin manifest. `ideality plugin install`
validates the manifest, creates a process-scoped definition and profile for
every identity, stores the manifest under `~/.ideality/plugins`, and
synchronizes the universal shim directory.
