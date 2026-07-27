---
name: ideality-catalog-adapter
description: Contribute built-in Ideality tool adapters. Use when adding or editing a catalog manifest, maintaining its behavior contract, or resolving catalog check failures.
---

# Contribute a built-in catalog adapter

The most common ideality contribution. You author **two files** — the
manifest and its behavior contract — and the scripts handle everything else.
Work inside a checkout of the ideality repo.

## 1. Scaffold

```bash
bun install
bun run catalog:new acme --display-name "Acme CLI" --pack deployment
```

Useful options: `--executable <name>` (when it differs from the ID),
`--alias <name>` (repeatable, alternative executables probed during
detection), `--description <text>`, `--scope process|shell`,
`--state full|partial|credentials`, `--no-shim`, `--dry-run`.

The scaffolder deterministically creates `catalog/<id>.jsonc` and
`catalog/contracts/<id>.contract.jsonc`, registers the import in
`src/adapters/builtins.ts`, and regenerates the generated blocks in
`docs/tool-packs.md` and `README.md`.

New packs are maintainer territory — `catalog:new` rejects unknown packs;
propose a new pack in the PR description instead of inventing one.

**Complete when:** the manifest and contract exist, `src/adapters/builtins.ts`
registers the manifest, and the generated README/tool-pack blocks changed only
as expected.

## 2. Author the manifest (`catalog/<id>.jsonc`)

VS Code validates against `schemas/tool-adapter.v1.schema.json`
(`.vscode/settings.json` wires it up). The manifest cannot carry a `$schema`
property — the runtime parser rejects unknown fields. Fill in, as applicable:

- `auth`: `login`/`status`/`logout` subcommand argv arrays, e.g.
  `["auth", "login"]`. Argv only — shell strings are rejected by design.
- `profile.env`: default environment assignments. Use
  `"{{idealityHome}}/profiles/{{identity}}/<id>"` paths for relocatable state
  and `{ "from": "secret", "key": "{{identity}}/<id>-token", "optional": true }`
  for credentials. Never commit literal tokens.
- `profile.args`: default argv entries, including identity-derived arguments
  such as `{ "fromIdentity": "sshKey", "prefix": ["-i"] }`.
- `isolation.state`: `full`, `partial`, or `credentials` per the definitions
  in `docs/tool-packs.md`, based on relocation controls the upstream tool
  actually documents.

Value-source and template semantics: `docs/custom-adapters.md`.

**Complete when:** every documented upstream identity control is represented,
the isolation grade matches those controls, and no placeholder or literal
credential remains.

## 3. Keep the behavior contract in lockstep

`catalog/contracts/<id>.contract.jsonc` declares the adapter's observable
compiled behavior (schema: `schemas/tool-adapter-contract.v1.schema.json`).
Contracts are pure data — nothing in them (or the manifest) ever runs the
third-party tool.

- `detection`: executable probe order — primary first, then every alias.
- `auth`: full argv per action **including the executable**, e.g.
  `["gh", "auth", "login"]`. Required exactly when the manifest declares
  `auth`, covering the same actions.
- `profiles`: named identity shapes with the exact compiled `env`/`args`
  (omitted means empty). Adapters with identity-derived args need one case
  where the identity provides the field and one where it is omitted.
- `redactions`: the exact set of env vars carrying secret material. Declaring
  a non-secret var fails; shipping a secret-bearing var undeclared fails.

**Complete when:** detection, every declared auth action, compiled profile
env/args, redactions, and both emit/omit cases for identity-derived values are
accounted for.

## 4. Verify

```bash
bun run check        # format, lint, typecheck, both adapter harnesses, tests
```

`bun run catalog:check` enforces (among others): strict parsing, safe IDs,
argv-only commands, filename/ID/pack consistency, catalog-wide unique IDs and
executables, registration in `src/adapters/builtins.ts`, fresh generated doc
blocks (`bun run catalog:docs` rewrites them), no editor-schema drift, exact
contract match against the compiled manifest, exactly one contract per
manifest, registry coverage, and safety invariants: no sensitive-named env
var with a literal value, no secret sources in shell-scoped adapters, every
secret key identity-scoped with `{{identity}}`.

Failures show a deterministic expected-versus-actual diff — update the
contract (or manifest) until they agree.

**Complete when:** `bun run check` exits zero and the generated documentation
is clean on a second `bun run catalog:docs`.

## 5. Open the PR

Use the catalog PR template: append `?template=catalog-adapter.md` to the
compare URL, or copy `.github/PULL_REQUEST_TEMPLATE/catalog-adapter.md` into
the description. A catalog PR contains your authored manifest and behavior
contract plus the mechanical changes from scaffolding — nothing else.
Runtime behavior changes (parser, plugins, shims) need tests and are out of
scope for a catalog PR.

Ground rules: manifests are data (no shell hooks or command strings), no new
runtime dependencies, secrets stay logical (`secret:` references resolved at
activation time).

**Complete when:** the catalog PR template is fully answered and the diff
contains only the manifest, contract, registration, generated documentation,
and any focused behavior tests required by the change.
