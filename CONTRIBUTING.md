# Contributing

Thanks for improving Ideality. The most common contribution is a new built-in
tool adapter, and that workflow is fully tooled: you author **one file**, the
scripts handle everything else.

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

- creates `catalog/<id>.jsonc` (the only file you author),
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

### 3. Verify

```bash
bun run check        # typecheck + catalog:check + full test suite
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
- the editor JSON schema has not drifted from the runtime parser.

### 4. Open the PR

Use the catalog PR template: append `?template=catalog-adapter.md` to the
compare URL, or copy `.github/PULL_REQUEST_TEMPLATE/catalog-adapter.md` into
the description. A catalog PR contains your one authored manifest plus the
mechanical changes from step 1 — nothing else. CI runs the same
`typecheck` / `catalog:check` / `bun test` gate as `bun run check`.

## Ground rules

- **Manifests are data.** They are parsed, never executed; auth commands and
  args are argv arrays appended to the tool's own executable. Don't propose
  shell hooks or command strings.
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
