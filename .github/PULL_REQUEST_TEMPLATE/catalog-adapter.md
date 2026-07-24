<!-- PR template for catalog contributions. Open your PR with
     ?template=catalog-adapter.md appended to the compare URL, or paste this
     file's contents into the description. -->

## New tool adapter: `<id>`

**Upstream tool:** <!-- name plus a link to the project -->
**Isolation grade:** <!-- full | partial | credentials -->
**Upstream isolation controls:** <!-- link to the upstream docs for the
    environment variable or flag that relocates the tool's state,
    e.g. GH_CONFIG_DIR for the GitHub CLI -->

## Checklist

- [ ] I authored exactly one new file: `catalog/<id>.jsonc`. The other changes
      in this PR (`src/adapters/builtins.ts` import, generated blocks in
      `docs/tool-packs.md` and `README.md`) are the mechanical output of
      `bun run catalog:new` / `bun run catalog:docs`.
- [ ] `bun run check` passes locally (typecheck, `catalog:check`, tests).
- [ ] Auth commands and profile args are argv arrays; the manifest contains no
      shell strings.
- [ ] `profile.env` credentials use logical secret references
      (`{ "from": "secret", "key": "{{identity}}/..." }`), never literal
      tokens.
- [ ] The isolation grade matches the definitions in `docs/tool-packs.md` and
      the upstream controls linked above.
