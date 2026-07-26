# Contributing

Thanks for improving Ideality. The most common contribution is a new built-in
tool adapter, and that workflow is fully tooled: you author **two files** — the
manifest and its behavior contract — and the scripts handle everything else.

## Development setup

Install Bun 1.3.14 or a compatible 1.3.x release, then install the locked
dependencies:

```bash
bun install --frozen-lockfile
```

Run the CLI from source with `bun run dev`. Keep changes focused, add tests for
observable behavior, and avoid committing generated output from `dist/`,
`.codegraph/`, or `.omc/`.

Before opening a pull request, run:

```bash
bun run check
bun run audit
```

Run `bun run perf:check` when changing startup, bundling, imports, or command
registration. It enforces the budgets in `performance-budgets.json`. Use
`bun run format` to apply the repository formatter.

## Add a built-in tool adapter

### 1. Scaffold

```bash
bun install
bun run catalog:new acme --display-name "Acme CLI" --pack deployment
```

Useful options: `--executable <name>` (when it differs from the ID),
`--alias <name>` (repeatable, alternative executables probed during
detection), `--description <text>`, `--scope process|shell`,
`--state full|partial|credentials`, `--no-shim`, and `--dry-run`.

The scaffolder deterministically:

- creates `catalog/<id>.jsonc` (the manifest you author),
- creates `catalog/contracts/<id>.contract.jsonc` (the behavior contract you
  keep in lockstep with the manifest),
- registers the manifest import in `src/adapters/builtins.ts`,
- regenerates the generated blocks in `docs/tool-packs.md` and `README.md`
  from catalog data.

### 2. Edit the manifest

`catalog/<id>.jsonc` is the complete description of the adapter. VS Code
validates it against `schemas/tool-adapter.v1.schema.json` as you type (wired
up in `.vscode/settings.json`); other editors can point their JSONC schema
support at the same file. The manifest cannot carry a `$schema` property — the
runtime parser rejects unknown fields.

Fill in, as applicable:

- `auth`: `login`/`status`/`logout` subcommand argv arrays, e.g.
  `["auth", "login"]`. Argv only — shell strings are rejected by design.
- `profile.env`: default environment assignments. Use
  `"{{idealityHome}}/profiles/{{identity}}/<id>"` paths for relocatable state
  and `{ "from": "secret", "key": "{{identity}}/<id>-token", "optional": true }`
  for credentials. Never commit literal tokens.
- `profile.args`: default argv entries, including identity-derived arguments
  such as `{ "fromIdentity": "sshKey", "prefix": ["-i"] }`.
- `isolation.state`: `full`, `partial`, or `credentials` — pick per the
  definitions in [docs/tool-packs.md](docs/tool-packs.md), based on the
  relocation controls the upstream tool actually documents.

See [docs/custom-adapters.md](docs/custom-adapters.md) for value-source and
template semantics.

### 3. Update the behavior contract

`catalog/contracts/<id>.contract.jsonc` declares the adapter's observable
compiled behavior; `catalog:check` compiles your manifest with the runtime
compiler and fails with an expected-versus-actual diff on any drift. Contracts
are pure data validated against
`schemas/tool-adapter-contract.v1.schema.json` — nothing in them (or in the
manifest) ever runs the third-party tool. Keep in lockstep with the manifest:

- `detection`: the executable probe order — primary first, then every alias.
- `auth`: the full argv per action including the executable, e.g.
  `["gh", "auth", "login"]`. Required exactly when the manifest declares
  `auth`, covering the same actions.
- `profiles`: named identity shapes with the exact compiled `env`/`args`
  (omitted means empty). Adapters with identity-derived args (e.g.
  `fromIdentity: "sshKey"`) need one case where the identity provides the
  field and one where it is omitted, so both branches stay locked.
- `redactions`: the exact set of env vars carrying secret material (secret,
  env, or file sources, or sensitive names). Declaring a var that is not
  secret-bearing fails, and so does shipping a secret-bearing var without
  declaring it.

### 4. Verify

```bash
bun run check        # format, lint, typecheck, both adapter harnesses, tests
```

`bun run catalog:check` enforces:

- every manifest parses strictly (schema version, safe IDs, argv-only
  commands, no unknown fields),
- filename, manifest ID, and pack are consistent (`catalog/<id>.jsonc`,
  known pack),
- tool IDs and executable names/aliases are unique across the whole catalog,
- every catalog file is registered in `src/adapters/builtins.ts` and the
  registry contains nothing else,
- the generated docs blocks are fresh (`bun run catalog:docs` rewrites them),
- the editor JSON schema has not drifted from the runtime parser,
- every behavior contract matches the compiled manifest exactly (detection
  order, auth argv, profile env/args per identity shape, redaction set),
- every catalog manifest has exactly one behavior contract,
- the versioned adapter registry covers every catalog manifest plus every
  trusted network, VM, and secret backend adapter,
- catalog-wide safety invariants hold for every manifest: no sensitive-named
  env var with a literal value, no secret sources in shell-scoped adapters,
  and every secret key scoped per identity with `{{identity}}`.

### 5. Open the PR

Use the catalog PR template: append `?template=catalog-adapter.md` to the
compare URL, or copy `.github/PULL_REQUEST_TEMPLATE/catalog-adapter.md` into
the description. A catalog PR contains your authored manifest and behavior
contract plus the mechanical changes from step 1 — nothing else. CI runs the
same `typecheck` / `catalog:check` / `privileged:check` / `bun test` gate as
`bun run check`.

## Add a privileged adapter

Network, VM, and secret adapters use a separate contribution format because
they can control host networking, virtualization, or secret stores. They are
reviewed and statically bundled; Ideality never installs arbitrary privileged
TypeScript from a plugin.

A privileged adapter PR includes:

- `privileged-adapters/<kind>-<id>.jsonc`, validated against
  `schemas/privileged-adapter.v1.schema.json`,
- `privileged-adapters/contracts/<kind>-<id>.contract.jsonc`, validated
  against `schemas/privileged-adapter-contract.v1.schema.json`,
- the narrowly scoped trusted-core implementation and any domain schema
  changes needed to bind `<kind>:<id>`,
- focused integration tests for side-effecting orchestration.

The manifest must declare its complete capability set, OS/architecture and
executable requirements, filesystem/network/secret permissions, provenance,
maintainers, and the repository release-signing identity. `trusted-core`
implementations cannot request `custom-command`; user-configured argv wrappers
must.
The release workflow signature is the distribution trust boundary, so there
is no unsigned runtime installation path.

Behavior contracts cover every action for the adapter kind:

- network: capability, enforcement, and `up`/`down`/`status` plans,
- VM: platform/KVM capability and `start`/`stop`/`status`/`exec` argv,
- secret: executable selection, writability, and every declared
  `read`/`write`/`list`/`delete` operation, including argv, stdin,
  environment, results, and platform-specific errors.

The harness invokes only deterministic registry methods with fake platform and
executable probes, recorded command runners, and isolated temporary storage.
It never executes provider CLIs or performs privileged host operations.

```bash
bun run privileged:check
bun test test/privileged-adapters.test.ts
bun run check
```

Use `.github/PULL_REQUEST_TEMPLATE/privileged-adapter.md` for this PR shape.

## Ground rules

- **Manifests are data.** They are parsed, never executed; auth commands and
  args are argv arrays appended to the tool's own executable. Don't propose
  shell hooks or command strings.
- **Core owns privileged lifecycle.** Privileged contributions are accepted
  through reviewed PRs and statically bound with `defineNetworkAdapter`,
  `defineVmAdapter`, or `defineSecretAdapter`. They are never runtime plugins.
  Custom network and VM profiles remain non-trusted argv-array wrappers.
- **No new runtime dependencies.** Tooling and adapters must work with the
  existing dependency set.
- **Secrets stay logical.** `secret:` references resolve through the user's
  configured backend at activation time.
- **New packs are maintainer territory.** `catalog:new` rejects unknown packs;
  propose a new pack in the PR description instead of inventing one.
- Runtime behavior changes (parser, plugins, shims) need tests and are out of
  scope for a catalog PR.

## Development commands

```bash
bun run dev -- --help    # run the CLI from source
bun run format           # apply Biome formatting
bun run lint             # run Biome lint rules
bun run typecheck        # tsc --noEmit
bun run catalog:check    # catalog validation (add --write via catalog:docs)
bun run catalog:docs     # regenerate generated doc blocks
bun run privileged:check # privileged manifests and behavior harness
bun test                 # full test suite
bun run check            # all of the above gates
bun run audit            # fail on high-severity dependency advisories
bun run perf:check       # build and enforce startup/binary-size budgets
```

## Dependencies and releases

Dependabot proposes weekly updates for Bun packages and GitHub Actions. Resolve
high- or critical-severity advisories before merge, or document why a fix is
not currently available.

Use Conventional Commit subjects because Release Please derives versions and
changelog entries from them:

```text
feat: add a new command
fix: handle an unavailable adapter
docs: clarify VM setup
```

Breaking changes use `!` in the type or a `BREAKING CHANGE:` footer. Merging a
Release Please pull request updates `CHANGELOG.md`, bumps the package version,
tags the release, and creates the GitHub release.

For every pull request, explain the user-visible outcome, include behavioral
tests where appropriate, update affected documentation, and confirm the
relevant formatting, linting, type, test, audit, catalog, and performance
checks pass.
