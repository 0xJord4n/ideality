<!-- Synced from .claude/rules/ by $setup-rules on 2026-07-27. User-authored sections under "Additional Notes" are preserved. -->

# AGENTS.md

## Project

Ideality is a Bun/TypeScript CLI for folder-based developer identity
orchestration. Bunli defines the CLI, OpenTUI powers the dashboard, Zod
validates runtime data, and Biome formats and lints the repository.

Use the Bun version declared by `.bun-version` and
`package.json#packageManager`.

## Repository Map

- `src/index.ts`: CLI composition and command registration.
- `src/commands/`: command parsing and user-facing orchestration.
- `src/domain/`: schemas and domain types.
- `src/core/`: application logic and adapter registries.
- `src/integrations/`: filesystem, Git, shell, shim, and completion effects.
- `src/tui/`: OpenTUI state, views, and transactional effects.
- `catalog/`: declarative tool manifests plus mandatory behavior contracts.
- `privileged-adapters/`: reviewed network, VM, and secret
  manifests/contracts.
- `skills/`: Vercel-compatible Agent Skills for users and contributors.
- `test/`: Bun tests for observable behavior and repository contracts.

## Setup and Development

```bash
bun install --frozen-lockfile
bun run dev -- --help
```

Use the narrowest useful test while iterating:

```bash
bun test test/identity-id.test.ts
bun test --test-name-pattern "behavior name"
```

Before handing off a code change, run:

```bash
bun run check
bun run audit
```

`bun run check` verifies formatting, lint, TypeScript, the tool catalog,
privileged-adapter contracts, and the full test suite. Use `bun run format` to
apply formatting.

Also run:

- `bun run perf:check` after changing startup, bundling, imports, command
  registration, or performance-sensitive paths.
- `bun run build:native && bash scripts/smoke.sh dist/ideality` when changing
  native builds, installers, releases, updates, or distribution behavior.
- `bun run release:rehearsal` for release-contract changes.

## Change Discipline

- Preserve unrelated worktree changes. Do not revert, stage, or commit them.
- Keep changes focused and add behavioral tests for observable behavior.
- Follow existing TypeScript ESM imports and strict compiler settings.
- Let Biome decide formatting: double quotes, semicolons, trailing commas, and
  an 80-column target.
- Add top-level CLI commands to `src/commands/names.ts` and register them in
  `src/index.ts`. The shared command list also drives shell completions.
- Update `README.md`, relevant `docs/`, specs, tests, and `skills/` whenever
  public commands or behavior change.
- Do not edit generated catalog blocks in `README.md` or
  `docs/tool-packs.md` manually; run `bun run catalog:docs`.
- Do not commit generated output from `dist/`, `coverage/`, `.codegraph/`, or
  `.omc/`.

## Adapter Contracts

For a built-in tool adapter:

```bash
bun run catalog:new acme --display-name "Acme CLI" --pack deployment
bun run catalog:check
```

- Keep `catalog/<id>.jsonc` and
  `catalog/contracts/<id>.contract.jsonc` in lockstep.
- Keep every executable action as an argv array. Manifests are data; never add
  shell hooks or command strings.
- Do not invent packs. `catalog:new` rejects unknown pack IDs.

Network, VM, and secret adapters are privileged:

- Keep their manifests and contracts under `privileged-adapters/`.
- Bind implementations narrowly in trusted core and add focused integration
  tests.
- Runtime plugins must never install arbitrary privileged code.
- Run `bun run privileged:check` and
  `bun test test/privileged-adapters.test.ts`.

Read `CONTRIBUTING.md` before changing either adapter system.

## Security Boundaries

- Keep secrets as logical references resolved only at process activation.
- Never place tokens, passwords, private keys, resolved environment values, or
  session data in config, logs, fixtures, diagnostics, command arguments, or
  snapshots.
- Preserve redaction in `status`, `doctor`, `explain`, audit output, and TUI
  state. Treat `ideality env --reveal` as intentionally sensitive.
- Use argv-based process execution; do not interpolate user-controlled values
  into a shell command.
- Preserve atomic writes, file modes, transaction history, and dry-run
  behavior when changing filesystem effects.
- Do not add runtime dependencies without explicit maintainer approval.

## Git, CI, and Releases

- Use Conventional Commit subjects such as `feat:`, `fix:`, `docs:`, and
  `test:`. Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
- Release Please owns normal version bumps, changelog changes, tags, and GitHub
  releases. Do not bump or tag a normal release manually.
- The artifact release must remain an explicit dispatch after Release Please
  creates a matching tag; see `docs/releasing.md`.
- Do not push, publish, release, or mutate external services unless the user
  explicitly authorizes it.
- Report the checks run and any remaining uncommitted files at handoff.

## Canonical References

- `CONTRIBUTING.md`: full contribution and verification requirements.
- `SECURITY.md`: credential and sensitive-output rules.
- `docs/releasing.md`: release automation and recovery.
- `skills/ideality-contributor-workflow/SKILL.md`: contributor workflow.
- `.claude/rules/ideality-project.md`: compact modular source for these rules.
