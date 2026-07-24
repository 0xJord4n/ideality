# Contributing

Thanks for helping improve Ideality.

## Development setup

Install Bun 1.3.14 or a compatible 1.3.x release, then install the locked dependencies:

```sh
bun install --frozen-lockfile
```

Run the CLI from source with `bun run dev`. Keep changes focused, add tests for observable
behaviour, and avoid committing generated output from `dist/`, `.codegraph/`, or `.omc/`.

## Required checks

Run the same checks used by CI before opening a pull request:

```sh
bun run check
bun run audit
bun run perf:check
```

`bun run check` verifies Biome formatting and lint rules, TypeScript types, and the test
suite. Use `bun run format` to apply the repository formatter.

The performance check builds the Linux x64 standalone executable and enforces the budgets
in `performance-budgets.json`:

- standalone executable: at most 122 MB;
- median `ideality --version` startup: at most 5,000 ms across five measured runs after
  one warmup.

If an intentional change needs more budget, include measurements and the reason for the
new threshold in the same pull request. Do not silently loosen a budget.

## Dependencies and security

Dependabot proposes weekly updates for npm-compatible packages and GitHub Actions. Run
`bun run audit` after changing dependencies. High- or critical-severity advisories must be
resolved or explicitly documented before merge.

## Commits and releases

Use Conventional Commit subjects because Release Please derives versions and changelog
entries from them:

```text
feat: add a new command
fix: handle an unavailable adapter
docs: clarify VM setup
```

Breaking changes must include `!` in the type or a `BREAKING CHANGE:` footer. Merging a
Release Please pull request updates `CHANGELOG.md`, bumps the package version, tags the
release, and creates the GitHub release.

## Pull requests

- Explain the user-visible outcome and important design choices.
- Include or update tests for behavioural changes.
- Update documentation for commands, configuration, or compatibility changes.
- Confirm formatting, linting, types, tests, audit, and relevant performance budgets pass.
