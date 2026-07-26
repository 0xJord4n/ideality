## Privileged adapter

- Adapter: `<network|vm|secret>:<id>`
- Upstream project:
- Supported platforms:
- Trusted implementation source:
- Provenance repository and license:
- Maintainers:

## Permissions

Explain why each declared privilege, filesystem path, network capability, or
secret operation is required.

## Checklist

- [ ] Added `privileged-adapters/<kind>-<id>.jsonc`.
- [ ] Added `privileged-adapters/contracts/<kind>-<id>.contract.jsonc`.
- [ ] Declared every capability and covered it in the behavior contract.
- [ ] Declared exact platform and executable requirements.
- [ ] Declared the minimum required permissions.
- [ ] Added verifiable provenance and the required release-signing identity.
- [ ] Bound the manifest to reviewed source through `defineNetworkAdapter`,
      `defineVmAdapter`, or `defineSecretAdapter`.
- [ ] Did not add runtime dynamic imports, plugin-loaded privileged code, or
      shell command strings.
- [ ] Kept secrets out of argv, environment diagnostics, and error messages.
- [ ] Ran `bun run privileged:check`.
- [ ] Ran `bun run check`.
