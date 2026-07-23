# Security

Ideality manages references to credentials and profile directories. The main
registry should not contain tokens, passwords, private keys, or session data.

- Prefer `file:` sources and `ideality secret set`.
- Keep generated private keys and secret files at mode `600`.
- Run `ideality doctor --strict` after adding an identity or adapter.
- Review `ideality hook <shell>` before sourcing it on a shared machine.
- Keep `~/.ideality` out of backups that are not
  encrypted.

`ideality status`, `secret list`, `doctor`, and the TUI show references and
redacted state only. `ideality env --reveal` intentionally emits resolved
values and should not be pasted into logs.
