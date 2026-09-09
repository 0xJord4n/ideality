# Reversible integration lifecycle commands

## Goal

Users can pause Ideality's automatic dispatch without uninstalling the CLI or
deleting identities, credentials, plugins, history, or other managed state.

## Commands

`ideality disable` removes the managed block from the selected shell rc file
and unregisters only `~/.ideality/git/includes.gitconfig` from Git's global
`include.path`. Generated hooks, shims, completions, and configuration remain
on disk so the operation is reversible.

`ideality enable` restores shell shims, completions, the managed rc block, and
Git routing. It is an explicit lifecycle alias for `ideality install`.

Both commands support:

- `--shell zsh|bash|fish`
- `--rc <path>`
- `--no-shell`
- `--no-git`
- `--dry-run`

## Safety and behavior

- Disable is idempotent and preserves unrelated shell and Git configuration.
- Dry-run performs no writes and reports the exact targets and preserved state.
- A child process cannot alter its parent shell. After disabling, the CLI tells
  the user to open a new shell session.
- Enabling regenerates integrations from the current validated registry rather
  than restoring stale generated files.

## Verification

Regression tests cover managed shell-block removal, unrelated Git include
preservation, repeated disable operations, command dry-run output, and command
registration through generated completions.
