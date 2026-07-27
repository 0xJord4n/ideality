---
name: ideality-troubleshooting
description: Diagnose and repair Ideality. Use when identity dispatch or shims are wrong, configuration needs recovery or migration, an update is refused, or local audit history needs inspection.
---

# Troubleshooting ideality

## First moves

```bash
ideality status                    # which identity is active here, and why
ideality explain gh                # exact dispatch decision for one tool
ideality explain cf --path ~/code/work/project --json
ideality doctor --strict           # missing helpers, unsupported strict profiles
ideality config validate
ideality config path
ideality config show
```

## Wrong identity for a folder

Resolution is by longest matching folder root; outside all roots the default
identity is used. Check `ideality identity list` for overlapping roots, then
fix with `ideality identity bind`, `ideality identity unbind`, or
`ideality identity default`. For a one-off, bypass resolution:
`ideality run <tool> --identity <id> -- <args>`.

## Tool not intercepted

Shims live in `~/.ideality/bin`, which `ideality install` adds to `PATH`.

- Verify `~/.ideality/bin` precedes the real binary's directory in `PATH`.
- Re-run `ideality install` after enabling new tools (`--dry-run` to preview).
- Bun is intentionally never shimmed — use `ideality run bun -- <args>`.

## Roll back a bad registry change

Registry writes are atomic and retain the newest 50 previous valid configs in
`~/.ideality/history`:

```bash
ideality rollback --list
ideality rollback latest --dry-run
ideality rollback latest
```

The TUI (`ideality tui`) also previews and applies rollback snapshots; it
stages edits in memory, previews a readable diff, and only writes on an
explicit save through the transactional history.

## Config migration

```bash
ideality config migrate --dry-run
ideality config migrate
ideality config edit
```

## Audit history (opt-in)

By default ideality records no audit events. Enable a redacted, append-only
JSONL trail of security and lifecycle outcomes:

```bash
ideality audit status
ideality audit enable --max-events 1000 --max-bytes 5242880
ideality audit list
ideality audit list --type secret.set --json
ideality audit prune --confirm
ideality audit clear --confirm
ideality audit disable
```

Storage: `~/.ideality/audit` mode `700`, `history.jsonl` mode `600`; schema
version `1` with monotonic sequence numbers; malformed lines are reported and
ignored during listing. Retention defaults to 1000 events / 5 MiB
(`auditHistory.maxEvents`, `auditHistory.maxBytes`,
`auditHistory.retentionDays` in the v1 registry). Recorded payloads are
allowlisted — never executable paths, secret values, resolved env values, raw
stdout/stderr, token-like strings, or full argv. Audit writes are best-effort
after successful operations: a storage failure is reported by audit
administration/status but does not roll back the original operation.

## Updates

```bash
ideality update --check
ideality update --dry-run
ideality update
```

Package-manager installs are not overwritten. Remove a legacy managed
installation first, then use the signed installer so only one `ideality`
remains on `PATH`. Direct binary installs verify the signed release metadata
before replacing anything.

## Safety habits

Most mutating commands accept `--dry-run`:

```bash
ideality identity bind work ~/projects/client --dry-run
ideality plugin install acme.ideality.jsonc --dry-run
ideality install --dry-run
ideality rollback latest --dry-run
ideality config migrate --dry-run
```

Troubleshooting is complete when `status` and `explain` agree with the
intended dispatch, `config validate` succeeds, and `doctor --strict` has no
unresolved finding relevant to the incident.
