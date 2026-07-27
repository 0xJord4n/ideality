# Architecture

Ideality is a Bun/TypeScript CLI with a small set of explicit layers. The
design keeps identity selection and policy decisions testable while isolating
filesystem, process, network, VM, and secret effects.

## Request flow

```text
src/index.ts
  -> src/commands/*
     -> src/core/* + src/domain/*
        -> src/integrations/*
        -> trusted network / VM / secret implementations

src/commands/tui.ts
  -> src/tui/app.tsx
     -> src/tui/state.ts + src/tui/model.ts
     -> src/tui/effects.ts
        -> the same core and integration layers
```

`src/index.ts` creates the Bunli CLI, imports every top-level command, checks
the registry against `src/commands/names.ts`, and then registers commands in
the shared order. Command modules own flag parsing, prompts, user-facing
errors, and orchestration. They delegate schemas and data shapes to
`src/domain/`, and selection, validation, policy, environment construction,
execution planning, and persistence to `src/core/`.

`src/integrations/` contains host-facing effects such as generated shims, Git
configuration, shell hooks, completions, and SSH key creation. Process launches
use argv arrays rather than interpolated shell commands.

The OpenTUI dashboard is another presentation layer, not a second
implementation of the application. `src/tui/model.ts` derives display state
from the validated registry and core resolution logic. `src/tui/state.ts`
holds staged UI state, while `src/tui/effects.ts` calls the same config,
policy, secret, plugin, and integration services used by commands. Mutations
are previewed or staged before persistence and use the registry snapshot and
rollback paths.

## Adapter trust boundary

Ordinary tool adapters are declarative. Each built-in `catalog/<id>.jsonc`
manifest is strictly parsed and compiled by `src/adapters/builtins.ts`; its
matching `catalog/contracts/<id>.contract.jsonc` freezes observable detection,
argv, profile, and redaction behavior. Installed tool plugins use the same
data-only model. A manifest can describe executable argv and logical value
sources, but cannot install or execute arbitrary TypeScript or embed shell
hooks.

Network, VM, and secret adapters cross a stronger boundary because they can
control host networking, virtualization, or credential stores. Their
manifests and behavior contracts live under `privileged-adapters/`, but the
implementations are narrowly bound in trusted core and statically bundled.
Adding one requires maintainer review, declared privileges and provenance,
focused integration tests, and the privileged-adapter harness. There is no
runtime path for a plugin to install privileged code.

Custom network and VM profiles remain user-configured argv wrappers. They are
not promoted to trusted built-ins and cannot bypass core lifecycle checks.

## Configuration and secrets

Managed state defaults to `~/.ideality`, or to `IDEALITY_HOME` when set. The
main registry defaults to `~/.ideality/config.jsonc` and can be selected
explicitly with `IDEALITY_CONFIG`.

The registry is JSONC validated with Zod. Writes create mode-`600` temporary
files and atomically rename them into place; changed registries are snapshotted
under `history/`, with the newest fifty retained. Generated integrations and
profile directories live under `IDEALITY_HOME`. Setting `IDEALITY_HOME`
relocates the managed state root together, while `IDEALITY_CONFIG` relocates
only the registry and its history.

Configuration stores logical secret, file, or environment references rather
than resolved secret values. Values are resolved only when a process is
activated. The default file backend stores mode-`600` values under
`~/.ideality/secrets`; supported external backends keep the value in their own
store and leave only the reference in Ideality configuration. Diagnostics,
audit history, and TUI state must remain redacted. `ideality env --reveal` is
the deliberate exception and should be treated as sensitive output.

Project state in `.ideality/project.jsonc` is portable declarative input.
Opening a repository never executes it: `ideality setup` parses it, evaluates
team policy, previews the changes, and applies them explicitly.

## Release distribution

Release Please owns normal version changes, changelog updates, tags, and
GitHub release creation. A matching tag explicitly dispatches the artifact
workflow, which runs the repository checks and offline release rehearsal
before publication.

The artifact workflow builds standalone Linux and macOS binaries for x64 and
arm64, packages them as single-binary archives, generates checksums and release
metadata, and signs the metadata and artifacts with Sigstore. It uploads the
native GitHub release first, then publishes the dependency-free
`@0xjordan/ideality` npm launcher through trusted publishing. The launcher
installs the native artifact matching its package version.

The install script, npm launcher, and direct updater authenticate release
metadata before trusting archive checksums. Direct updates also prove the
staged binary version, check config migration readiness, snapshot config, and
roll back the binary and config on failure. Package-manager installations are
not overwritten by the direct updater; their manager remains responsible for
upgrades.

See [Releasing](releasing.md) for the workflow, recovery, rehearsal, and manual
verification contracts.
