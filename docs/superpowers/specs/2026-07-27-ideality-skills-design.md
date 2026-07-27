# Design: Agent skillset in `skills/` for ideality

Date: 2026-07-27
Status: Approved (interactive approval during design session)

## Goal

Ship a full agent skillset in a top-level `skills/` folder so AI coding agents
can both **operate** ideality on a user's machine and **contribute** to this
repository, with precise skill triggering and no invented commands.

## Format

- Agent Skills format: one directory per skill, `skills/<name>/SKILL.md`.
- Vercel Skills compatible: the repository is installable with
  `npx skills add 0xJord4n/ideality` or
  `bunx skills add 0xJord4n/ideality`.
- Frontmatter: `name` + trigger-rich third-person `description` ("Use when…").
- Bodies stay concise (≤ ~200 lines); no `references/` subfolders initially —
  the repo `docs/` tree is the deep reference and contributor skills link to it.
- `skills/README.md` indexes the set and explains installation into an agent
  harness through Vercel Skills, Ideality's wrapper, or a manual copy/symlink.
- `ideality skills install` invokes the Vercel Skills CLI with argv (never a
  shell), supports explicit `npx`/`bunx` selection, and forwards skill, agent,
  scope, copy, confirmation, list, and all-skills controls. Skill and agent
  selections may be repeated, matching the upstream CLI.

## Roster (10 skills)

Operating ideality (self-contained; usable outside this repo):

1. `ideality-getting-started` — install (signed script/source), `ideality init`
   interactive + `--non-interactive`, `ideality install` shims, completions,
   prompt, update.
2. `ideality-identities` — identity add/bind/unbind/default/ssh-public,
   longest-matching-root resolution, git includeIf, `ideality run --identity`.
3. `ideality-project-setup` — `ideality setup` wizard + non-interactive,
   `.ideality/project.jsonc` handovers, trust model, `--requirements-only`,
   policy contracts (`.ideality/policy.jsonc`, `ideality policy check`, CI).
4. `ideality-tools-and-packs` — 7 packs / 58 adapters, enable/disable(+pack),
   isolation grades full/partial/credentials, `explain`, `status`, `auth`.
5. `ideality-secrets` — logical `secret:` references, 7 backends (file, age,
   keychain, pass, 1Password, Bitwarden, Dashlane), read-only backends,
   redaction guarantees, file modes.
6. `ideality-network-vm` — network profiles (mullvad/tailscale/warp/
   wireguard/openvpn/custom), enforcement levels, lease semantics, VM
   profiles (lima + helper backends), bind/up/down/exec, doctor --strict.
7. `ideality-custom-tools` — `tool add`/`tool env`/`tool args`, value
   sources, templates, plugin manifests, `plugin validate|install|remove`.
8. `ideality-troubleshooting` — status/explain/doctor/rollback/config
   migrate/audit/update; wrong-identity dispatch and shim diagnosis.

Contributing to this repo (may reference repo paths):

9. `ideality-catalog-adapter` — `bun run catalog:new`, manifest authoring,
   behavior contract lockstep, `catalog:check` invariants, PR shape.
10. `ideality-contributor-workflow` — dev setup, `bun run check` gates,
    perf budgets, privileged adapters overview, conventional commits,
    Release Please, release rehearsal.

## Content rules

- Every command, flag, path, and schema name is copied from README.md,
  CONTRIBUTING.md, or `docs/*.md` — nothing invented.
- Operating skills are self-contained (they may be copied out of the repo).
- Contributor skills may point at `docs/*.md`, `schemas/*.json`,
  `catalog/`, and `privileged-adapters/` by repo-relative path.

## Error handling / testing

- Skill packages are Markdown only. Verification is structural: frontmatter
  parses, names match directories, operating skills remain self-contained,
  contributor paths exist, examples are executable rather than pipeline-like
  alternative notation, and installation docs cover Vercel Skills.
- The CLI wrapper is covered by unit tests for runner selection, deterministic
  argv, dry runs, and failure propagation.

## Alternatives considered

- 3–4 broad skills: rejected (poor trigger precision) per user choice.
- Merging the two contributor skills: rejected; catalog adapters are the
  most common contribution and deserve their own trigger surface.
