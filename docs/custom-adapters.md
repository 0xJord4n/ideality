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
synchronizes the universal shim directory. The same installed manifests are
available in `ideality tui` with redacted metadata inspection, local manifest
installation, and confirmation-gated removal.

The canonical plugin format is `schemas/tool-adapter.v1.schema.json`. Existing
version-1 plugin manifests remain supported through a compatibility
translation, but they now receive the same strict safety checks: safe
executable names, process isolation, known fields only, and no shell hooks.

## Unified adapter registry

Ideality has one versioned core adapter envelope for all integration classes:
tool, network, VM, and secret. Custom tool plugins still use the same manifest
formats and install commands; during install the manifest is wrapped as a
declarative tool adapter with no contributor executable code.

Privileged network, VM, and secret adapters use a separate reviewed
contribution format under `privileged-adapters/`. Their manifests declare
capabilities, permissions, platform constraints, provenance, implementation
type, and the release-signing identity. They are validated and bundled at
build time; a project file or installed plugin cannot dynamically load or
replace privileged implementation code. Custom network and VM profiles are
represented in that registry too, but as non-trusted user-configured argv
wrappers because the configured commands come from the user's registry.

Format boundaries:

- `catalog/<id>.jsonc` and plugin manifests describe observable behavior only.
  They cannot add hooks, dynamic imports, shell command strings, or arbitrary
  lifecycle code.
- `privileged-adapters/<kind>-<id>.jsonc` can only bind to a reviewed
  implementation already present in the source tree. The manifest itself is
  not executable.
- `bun run catalog:check` requires a behavior contract for every built-in tool
  adapter.
- `bun run privileged:check` requires a privileged manifest and behavior
  contract for every built-in network, VM, and secret adapter, verifies the
  runtime registry, and exercises deterministic lifecycle plans without
  running host commands.

## Contributing a built-in adapter

Built-in adapters are declarative manifests under `catalog/<id>.jsonc`,
validated by `schemas/tool-adapter.v1.schema.json` in the editor (see
`.vscode/settings.json`) and by the runtime parser in CI. Scaffold one with
`bun run catalog:new`, verify with `bun run catalog:check`, and follow the
checklist in [CONTRIBUTING.md](../CONTRIBUTING.md). Plugin manifests use the
same schema, so a proven local plugin can be promoted to the catalog by
changing its `pack`.

### Behavior contracts

Each catalog adapter must ship a behavior contract at
`catalog/contracts/<id>.contract.jsonc` (`bun run catalog:new` scaffolds one
for every new adapter, and `schemas/tool-adapter-contract.v1.schema.json`
describes the format for editors). A contract is versioned, declarative data —
it cannot express hooks, shell strings, or code — that pins the adapter's
observable compiled behavior:

- `detection`: the executable probe order (primary, then aliases).
- `auth`: the full argv per auth action, executable included.
- `profiles`: the exact compiled `env`/`args` per named identity shape,
  including both branches of identity-derived arguments such as
  `fromIdentity: "sshKey"`.
- `redactions`: the exact set of env vars that carry secret material and must
  surface redacted.

`bun run catalog:check` recompiles every manifest with the runtime compiler
and reports each drift as a deterministic expected-versus-actual failure. It
never executes the third-party tool. Independent of contracts, the same check
enforces catalog-wide safety invariants for every manifest: sensitive-named
env vars must use secret/env/file sources rather than literals, shell-scoped
adapters cannot resolve secrets, and secret keys must be identity-scoped with
`{{identity}}`.

### Privileged behavior contracts

Every privileged adapter must also ship
`privileged-adapters/contracts/<kind>-<id>.contract.jsonc`, validated by
`schemas/privileged-adapter-contract.v1.schema.json`. The contract pins the
observable lifecycle plans and enforcement decisions for each declared
capability. The harness uses synthetic profiles and platform inputs, so it
checks exact argv, executable requirements, kill-switch enforcement, and
every declared secret operation without starting a VPN, VM, or credential
process.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the required provenance,
permissions, signing, and test checklist. New privileged implementations are
accepted only as reviewed source changes and must use the narrow
`defineNetworkAdapter`, `defineVmAdapter`, or `defineSecretAdapter` SDK
boundary.
