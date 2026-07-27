# Project: Ideality

**Last updated:** 2026-07-27

## Overview

- Ideality is a Bun/TypeScript CLI for folder-based developer identity
  orchestration.
- Bunli defines the CLI, OpenTUI powers the dashboard, Zod validates runtime
  data, and Biome formats and lints the codebase.
- Use the Bun version declared by `.bun-version` and
  `package.json#packageManager`.

## Structure

- `src/index.ts`: CLI composition and command registration.
- `src/commands/`: command parsing and user-facing orchestration.
- `src/domain/`: schemas and domain types.
- `src/core/`: application logic and adapter registries.
- `src/integrations/`: filesystem, Git, shell, shim, and completion effects.
- `src/tui/`: OpenTUI state, views, and transactional effects.
- `catalog/`: declarative tool manifests and behavior contracts.
- `privileged-adapters/`: reviewed network, VM, and secret manifests/contracts.
- `skills/`: Vercel-compatible Agent Skills; keep these aligned with the CLI.
- `test/`: Bun tests, normally mirroring observable behavior.

## Commands

```bash
bun install --frozen-lockfile
bun run dev -- --help
bun test test/identity-id.test.ts
bun run check
bun run audit
```

- Run `bun run perf:check` after changing startup, bundling, imports, or command
  registration.
- Run `bun run build:native && bash scripts/smoke.sh dist/ideality` for native
  distribution-path changes.
- Use `bun run format` to apply formatting; `bun run check` only verifies it.

## Repository Rules

- Preserve unrelated worktree changes and keep each change focused.
- Add or update behavioral tests for observable changes.
- Add top-level commands to `src/commands/names.ts` and register them in
  `src/index.ts`; the shared list also drives completions.
- Scaffold built-in tools with `bun run catalog:new`; keep each manifest and
  behavior contract in lockstep. Regenerate catalog docs with
  `bun run catalog:docs`.
- Keep adapter commands as argv arrays. Never add shell hooks or executable
  command strings to manifests.
- Keep privileged network, VM, and secret lifecycle code reviewed and
  statically bundled; runtime plugins cannot install privileged code.
- Keep secrets as logical references and prevent values from entering config,
  logs, diagnostics, tests, or command arguments.
- Do not add runtime dependencies without explicit maintainer approval.
- Update `README.md`, relevant `docs/`, specs, tests, and `skills/` when
  behavior or public commands change.
- Use Conventional Commit subjects. Release Please owns normal version bumps,
  tags, changelog updates, and GitHub releases; do not perform them manually.

## References

- `CONTRIBUTING.md`: complete contribution contracts and PR expectations.
- `SECURITY.md`: secret-handling and disclosure boundaries.
- `docs/releasing.md`: automated release and recovery workflow.
- `skills/ideality-contributor-workflow/SKILL.md`: concise contributor flow.
