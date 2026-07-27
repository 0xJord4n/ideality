---
name: ideality-contributor-workflow
description: Develop and release Ideality. Use when preparing repository changes, fixing CI gates, contributing privileged adapters, or rehearsing an automated release.
---

# ideality contributor workflow

Work inside a checkout of the ideality repo. For built-in tool adapters
(the most common contribution) use the `ideality-catalog-adapter` skill.

## Setup

Install Bun 1.3.14 or a compatible 1.3.x release, then:

```bash
bun install --frozen-lockfile
bun run dev -- --help          # run the CLI from source
```

Keep changes focused, add tests for observable behavior, and avoid committing
generated output from `dist/`, `.codegraph/`, or `.omc/`.

## Gates

```bash
bun run check            # format:check + lint + typecheck + catalog:check
                         #   + privileged:check + bun test
bun run audit            # fail on high-severity dependency advisories
bun run perf:check       # build + enforce performance-budgets.json
bun run format           # apply Biome formatting
bun test                 # full test suite
bun run smoke            # smoke-test the dev entrypoint
```

Run both `bun run check` and `bun run audit` before opening a PR. Run
`bun run perf:check` when changing startup, bundling, imports, or command
registration.

## Privileged adapters (network / VM / secret)

Separate contribution format because they can control host networking,
virtualization, or secret stores. They are reviewed and statically bundled —
ideality never installs arbitrary privileged TypeScript from a plugin, and
there is no unsigned runtime installation path.

A privileged adapter PR includes:

- `privileged-adapters/<kind>-<id>.jsonc`
  (schema: `schemas/privileged-adapter.v1.schema.json`) declaring the complete
  capability set, OS/arch and executable requirements, filesystem/network/
  secret permissions, provenance, maintainers, and the release-signing
  identity. `trusted-core` implementations cannot request `custom-command`;
  user-configured argv wrappers must.
- `privileged-adapters/contracts/<kind>-<id>.contract.jsonc`
  (schema: `schemas/privileged-adapter-contract.v1.schema.json`) covering
  every action: network `up`/`down`/`status` plans and enforcement; VM
  `start`/`stop`/`status`/`exec` argv and platform/KVM capability; secret
  executable selection, writability, and every declared
  `read`/`write`/`list`/`delete` operation.
- The narrowly scoped trusted-core implementation bound with
  `defineNetworkAdapter`, `defineVmAdapter`, or `defineSecretAdapter`, plus
  any domain schema changes to bind `<kind>:<id>`.
- Focused integration tests for side-effecting orchestration.

```bash
bun run privileged:check
bun test test/privileged-adapters.test.ts
bun run check
```

The harness only invokes deterministic registry methods with fake probes and
recorded runners — it never executes provider CLIs. Use
`.github/PULL_REQUEST_TEMPLATE/privileged-adapter.md` for the PR.

## Commits and releases

Use Conventional Commit subjects — Release Please derives versions and
changelog entries from them (`feat:`, `fix:`, `docs:`; breaking changes use
`!` or a `BREAKING CHANGE:` footer). Merging a Release Please PR updates
`CHANGELOG.md`, bumps the version, tags, and creates the GitHub release.

Release Please dispatches `.github/workflows/release.yml` at the created tag.
The workflow refuses a tag that doesn't match `package.json`, runs
`bun run check`, builds four target archives, rehearses offline, signs with
Sigstore cosign (keyless), attests build provenance, and publishes the GitHub
release.

Do not bump or tag a normal release manually. A recovery run is explicit and
only valid after Release Please has created a matching tag:

```bash
gh workflow run release.yml --ref v0.2.0
```

Local dry runs:

```bash
bun run release:rehearsal
bun install --os '*' --cpu '*'                  # once: all target runtimes
bun run build:release
bash scripts/release-rehearsal.sh --no-build
bun run build:native
bash scripts/smoke.sh dist/ideality
```

Full details: `docs/releasing.md` and `CONTRIBUTING.md`.
