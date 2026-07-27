# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities through GitHub's
[private vulnerability reporting form](https://github.com/0xJord4n/ideality/security/advisories/new).
Do not open a public issue, discussion, or pull request with vulnerability
details.

Include enough information to reproduce and assess the problem:

- the Ideality version, installation method, operating system, and architecture;
- the affected command, adapter, or release artifact;
- the expected and observed behavior, impact, and minimal reproduction steps;
- any relevant logs with credentials, identity data, paths, and session data
  removed; and
- a suggested remediation or disclosure constraint, if applicable.

Do not include real tokens, passwords, private keys, resolved environments, or
other people's data. Do not test against systems or accounts you do not own or
have permission to assess.

If the private reporting form is unavailable, email
[me@0xjordan.dev](mailto:me@0xjordan.dev). If neither private channel is
reachable and the issue tracker is accessible, open a public issue containing
only a request to establish a private contact channel. Do not include the
vulnerability, exploit, or affected-user details in that issue.

## Supported versions

Security fixes target the latest published release.

| Version | Security support |
|:--|:--|
| Latest published release | Supported |
| Older releases | Not supported; upgrade to the latest release |
| Unreleased `main` branch | Receives fixes, but is not a supported release |

Backports are not guaranteed. A serious vulnerability may trigger an
accelerated release rather than a patch to an older version.

## Response and disclosure

Maintainers aim to acknowledge a complete report within three business days,
provide an initial assessment within seven business days, and send a status
update at least every fourteen days while remediation is active. These are
targets, not service-level guarantees; complex or upstream issues may take
longer.

Please keep the report private until maintainers confirm that a fix is
available and users have had a reasonable opportunity to upgrade. Maintainers
will coordinate the disclosure date and, when appropriate, publish a GitHub
Security Advisory, request a CVE, and credit the reporter. Credit can be
omitted on request.

Maintainers may share the minimum necessary details with affected upstream
projects, release infrastructure providers, or other responders under an
embargo. Active exploitation or immediate risk to users may require an
accelerated fix or disclosure.

## Operational safety

Ideality manages references to credentials and profile directories. The main
registry must not contain tokens, passwords, private keys, resolved environment
values, or session data.

- Prefer `file:` sources and `ideality secret set`.
- Keep generated private keys and secret files at mode `600`.
- Run `ideality doctor --strict` after adding an identity or adapter.
- Review `ideality hook <shell>` before sourcing it on a shared machine.
- Keep `~/.ideality` out of backups that are not encrypted.
- Use argv-based adapter actions; never interpolate untrusted values into shell
  commands.
- Verify release metadata and checksums when installing artifacts manually.

`ideality status`, `secret list`, `doctor`, `explain`, audit output, and the TUI
show references and redacted state only. `ideality env --reveal` intentionally
emits resolved values and should not be pasted into logs, issue reports, or
chat transcripts.

Project handovers are data, not hooks: opening a repository does not execute
them. Review the proposed changes and team-policy findings before applying a
handover with `ideality setup`.
