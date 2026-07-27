# ideality agent skills

Agent Skills for working with [ideality](../README.md) — folder-based identity
orchestration for developer tools. Each skill is a directory containing a
`SKILL.md` with YAML frontmatter (`name`, `description`) and focused
instructions, following the open Agent Skills format used by Claude Code and
compatible agent harnesses.

## Skills

### Operating ideality

| Skill | Use when |
| --- | --- |
| [`ideality-getting-started`](ideality-getting-started/SKILL.md) | Installing ideality, running `ideality init`, enabling shims, completions, updating |
| [`ideality-identities`](ideality-identities/SKILL.md) | Creating identities, binding folders, default identity, SSH keys, identity resolution |
| [`ideality-project-setup`](ideality-project-setup/SKILL.md) | `ideality setup`, project handovers (`.ideality/project.jsonc`), team policy contracts |
| [`ideality-tools-and-packs`](ideality-tools-and-packs/SKILL.md) | Enabling tool packs and adapters, isolation grades, `explain`, `auth` |
| [`ideality-secrets`](ideality-secrets/SKILL.md) | Secret references, choosing/configuring secret backends |
| [`ideality-network-vm`](ideality-network-vm/SKILL.md) | VPN network profiles, VM execution profiles, kill-switch enforcement |
| [`ideality-custom-tools`](ideality-custom-tools/SKILL.md) | Adding custom tool adapters and portable plugin manifests |
| [`ideality-troubleshooting`](ideality-troubleshooting/SKILL.md) | Diagnosing dispatch/shim issues, doctor, rollback, audit, config migration |

### Contributing to this repository

| Skill | Use when |
| --- | --- |
| [`ideality-catalog-adapter`](ideality-catalog-adapter/SKILL.md) | Adding a built-in tool adapter (manifest + behavior contract) |
| [`ideality-contributor-workflow`](ideality-contributor-workflow/SKILL.md) | Dev setup, check gates, privileged adapters, commits, releases |

## Install with Vercel Skills

The recommended installer is Vercel's open
[`skills`](https://github.com/vercel-labs/skills) CLI. It discovers this
repository's `skills/<name>/SKILL.md` layout and offers the supported coding
agents and skills interactively:

```bash
npx skills add 0xJord4n/ideality
```

The same package works through Bun:

```bash
bunx skills add 0xJord4n/ideality
```

After Ideality itself is installed, its wrapper selects `bunx` when available
and falls back to `npx`:

```bash
ideality skills install
ideality skills install --list
ideality skills install --runner bunx
ideality skills install \
  --skill ideality-getting-started \
  --skill ideality-troubleshooting \
  --agent codex \
  --global \
  --yes
```

Use `--copy` when symlinks are unsuitable, or `--all` to install every
Ideality skill into every detected agent. Repeat `--skill` or `--agent` to
make multiple selections; comma-separated values are also accepted.
`--dry-run` prints the exact external command without executing it. The
upstream CLI supports Codex, Claude Code, Cursor, GitHub Copilot, OpenCode,
and many other agents.

The Vercel CLI documents anonymous installation telemetry. Set
`DISABLE_TELEMETRY=1` when invoking `npx`, `bunx`, or the Ideality wrapper to
opt out.

## Manual installation

The operating skills are self-contained and can be used outside this repo;
the two contributor skills reference repo paths and assume a checkout.

- **Claude Code (project scope)**: copy or symlink the skill directories into
  the project's `.claude/skills/` directory.
- **Claude Code (user scope)**: copy or symlink them into `~/.claude/skills/`.
- **Other harnesses**: any runner that understands `SKILL.md` frontmatter can
  load the directories as-is.

Example (user scope, all skills):

```bash
mkdir -p ~/.claude/skills
for d in skills/ideality-*/; do
  ln -s "$(pwd)/$d" ~/.claude/skills/"$(basename "$d")"
done
```

## Maintenance

Skill content is cross-checked against [README.md](../README.md),
[CONTRIBUTING.md](../CONTRIBUTING.md), the CLI definitions, and
[docs/](../docs/). When commands, packs, backends, or drivers change, update
the matching skill in the same change. `test/agent-skills.test.ts` guards the
roster, frontmatter, self-containment, executable examples, and installer
documentation; catalog counts remain protected by the generated catalog
checks.
