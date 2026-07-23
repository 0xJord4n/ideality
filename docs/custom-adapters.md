# Custom adapters

An adapter has two layers:

- A global tool definition describes the executable and default isolation.
- Each identity has a profile containing environment assignments and arguments.

Use `shell` isolation only for narrowly scoped variables designed by the tool
for profile selection. Use `process` when the adapter changes `HOME`, an XDG
directory, a browser profile, or any variable that could affect unrelated
commands.

## Value sources

`ideality tool env <identity> <tool> <variable> <source>` accepts:

```text
value:text        Store a non-secret literal
file:path         Read the value from a file at activation time
env:VARIABLE      Read the value from another environment variable
unset             Explicitly remove the variable
```

Add `--optional` to `file:` and `env:` sources when absence should disable the
credential rather than fail activation.

Paths and arguments support:

```text
{{identity}}      Selected identity ID
{{home}}          User home directory
{{idealityHome}}  Ideality state directory
{{root}}          Matched identity root, or the resolved path for an override
```

## Example

```bash
ideality tool add registry --executable registryctl --isolation process
ideality tool env work registry XDG_CONFIG_HOME value:{{home}}/.config/ideality/profiles/{{identity}}/registry
ideality tool env work registry REGISTRY_TOKEN file:{{home}}/.config/ideality/secrets/{{identity}}/registry-token
ideality secret set work registry REGISTRY_TOKEN
ideality tool args work registry -- --endpoint https://registry.example
ideality run registry --identity work -- whoami
```

The executable is started with an argument array, never through a shell. Shell
assignment rendering validates variable names and single-quotes values.
