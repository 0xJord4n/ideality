---
name: ideality-custom-tools
description: Add declarative custom tools to Ideality. Use when a CLI is absent from the catalog, needs identity-specific env or args, or should be shared as a portable plugin manifest.
---

# Custom tools and plugin manifests

An adapter has two layers: a global tool definition (executable + default
isolation) and a per-identity profile (environment assignments + arguments).
Use `process` isolation for identity-aware tools.

## Ad-hoc definition

```bash
ideality tool add acme --executable acme
ideality tool env work acme \
  ACME_HOME value:{{idealityHome}}/profiles/{{identity}}/acme
ideality tool env work acme ACME_TOKEN secret:{{identity}}/acme-token
ideality tool args work acme -- --region eu
ideality run acme --identity work -- whoami
```

The executable is started with an argument array, never through a shell.

## Value sources

`ideality tool env <identity> <tool> <variable> <source>` accepts:

```text
value:text        Store a non-secret literal
file:path         Read the value from a file at activation time
env:VARIABLE      Read the value from another environment variable
secret:key        Resolve a logical key through the configured backend
unset             Explicitly remove the variable
```

Add `--optional` to external sources when absence should disable the
credential rather than fail activation. Logical secrets are rejected for
shell-scoped profiles. Password-manager references remain read-only.

Templates available in paths and arguments:

```text
{{identity}}      Selected identity ID
{{home}}          User home directory
{{idealityHome}}  Ideality state directory
{{root}}          Matched identity root, or the resolved path for an override
```

## Portable plugin manifest

For reusable integrations, prefer the canonical version-1 tool manifest:

```jsonc
{
  "schemaVersion": 1,
  "kind": "tool",
  "id": "acme",
  "displayName": "Acme CLI",
  "pack": "custom",
  "executable": {
    "primary": "acme",
    "alternatives": ["acme-cli"]
  },
  "isolation": {
    "scope": "process",
    "state": "credentials"
  },
  "auth": { "status": ["account", "show"] },
  "profile": {
    "env": {
      "ACME_TOKEN": {
        "from": "secret",
        "key": "{{identity}}/acme-token"
      }
    }
  }
}
```

```bash
ideality plugin validate acme.ideality.jsonc
ideality plugin install acme.ideality.jsonc
ideality plugin install acme.ideality.jsonc --dry-run
ideality plugin list
ideality plugin remove acme --force
```

`plugin install` validates the manifest, creates a process-scoped definition
and profile for every identity, stores the manifest under
`~/.ideality/plugins`, and synchronizes the universal shim directory.
Existing version-1 plugin manifests are translated into the canonical format
during validation and installation, with the same strict safety checks: safe
executable names, process isolation, known fields only, no shell hooks.

Manifests are data — parsed, never executed. Auth commands and args are argv
arrays appended to the tool's own executable; hooks, dynamic imports, and
shell command strings cannot be expressed.

In `ideality tui`, press `g` to list and install local plugin manifests with
redacted metadata inspection; removal requires an explicit confirmation and a
clean staged draft.

Do not promote a plugin by only changing its `pack`. A built-in contribution
also needs catalog placement and registration, a behavior contract, generated
documentation, and a clean catalog check. Use the
`ideality-catalog-adapter` skill for that complete path.
