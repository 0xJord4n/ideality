# Tool packs and isolation

Ideality keeps the complete built-in catalog in the registry, but creates
identity profiles and shims only for selected tools. A tool can be added later
without rebuilding the registry:

```bash
ideality tool packs
ideality tool enable-pack sample cloud
ideality tool enable sample stripe
ideality install
```

Project handovers contain only the tools selected by `ideality setup`.

## Isolation grades

- `full`: the upstream CLI exposes a dedicated profile directory or complete
  user-data arguments. Credentials, configuration, history, and caches covered
  by that control move under `~/.ideality/profiles/<identity>`.
- `partial`: Ideality relocates supported state, but the application may still
  use an OS keychain, machine service, platform-specific location, or
  unrelocatable cache.
- `credentials`: account selection is isolated through logical secrets or SSH,
  while noncredential application state may remain shared.

Every adapter still receives process isolation: variables managed by other
identities are removed before the selected profile is injected.

## Built-in matrix

| Pack | Tools | Grade and mechanism |
| --- | --- | --- |
| Essentials | `gh`, `railway`, `cf`, `vercel`, `codex`, `claude`, `opencode`, `chrome`, `firefox` | Dedicated config homes where available; secret-backed tokens for Railway and Cloudflare; browser profile arguments |
| Cloud | `aws`, `gcloud`, `az`, `doctl` | Full: `AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE`, `CLOUDSDK_CONFIG`, `AZURE_CONFIG_DIR`, and `doctl --config` |
| Source control | `glab`, `tea`, `bitbucket`, `gerrit` | GitLab is full through `GLAB_CONFIG_DIR`; Tea is partial through XDG; Bitbucket is a credential adapter for community CLIs; Gerrit dispatches SSH and uses identity keys |
| Editors | `code`, `cursor`, `windsurf`, `zed`, `idea`, `pycharm`, `webstorm`, `goland`, `rustrover`, `slack`, `discord` | VS Code is full; Electron-compatible and XDG profiles are partial because support varies by application and operating system |
| Registries | `npm`, `pnpm`, `yarn`, `bun`, `cargo`, `uv`, `pip`, `gem`, `composer`, `mvn`, `gradle`, `nuget` | Dedicated npmrc, cache, Cargo, XDG, Composer, and Gradle homes; Maven and NuGet are partial |
| Deployment | `fly`, `netlify`, `supabase`, `firebase`, `heroku`, `render`, `sst`, `pulumi`, `shopify`, `stripe` | Netlify, Firebase, and Pulumi relocate state; other adapters prioritize logical token isolation and supported XDG state |
| AI | `gemini`, `copilot`, `aider`, `amp`, `goose`, `cn`, `kiro-cli`, `qwen` | Gemini, Copilot, Amp, Kiro, and Qwen expose profile homes; Aider and Continue isolate credentials; Goose uses XDG state |

Bun has a profile but no automatic shim. A Bun shim could intercept the
`#!/usr/bin/env bun` used to start Ideality and recurse. Run it explicitly:

```bash
ideality run bun -- install
ideality run bun -- publish
```

## Secrets

Optional starter secrets are logical references. A missing optional value does
not block interactive login; once set, the secret backend overrides ambient
credentials for that identity.

```bash
ideality secret set sample glab GITLAB_TOKEN
ideality secret set sample stripe STRIPE_API_KEY
ideality secret set sample copilot COPILOT_GITHUB_TOKEN
```

The default file backend stores mode-`600` values under `~/.ideality/secrets`.
Age, OS keychain, `pass`, 1Password, Bitwarden, and Dashlane remain available.

## Upstream controls

The profiles are based on the controls documented by
[AWS](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html),
[Google Cloud](https://docs.cloud.google.com/sdk/docs/configurations),
[Azure](https://learn.microsoft.com/en-us/cli/azure/azure-cli-configuration),
[GitLab](https://docs.gitlab.com/cli/),
[VS Code](https://code.visualstudio.com/docs/configure/command-line),
[Cargo](https://doc.rust-lang.org/cargo/reference/environment-variables.html),
[uv](https://docs.astral.sh/uv/reference/storage/),
[Gradle](https://docs.gradle.org/current/userguide/directory_layout.html),
[Pulumi](https://www.pulumi.com/docs/iac/cli/environment-variables/),
[Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md),
[GitHub Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference),
[Continue](https://docs.continue.dev/cli/configuration),
[Kiro](https://kiro.dev/docs/cli/reference/settings/), and
[Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/).

Where an upstream tool has no complete relocation control, the adapter remains
marked `partial` or `credentials`. Use a VM profile when shared host state is
not acceptable.
