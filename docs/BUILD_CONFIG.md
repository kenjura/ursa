# Build config files

`ursa generate` (alias `ursa build`) and `ursa serve` take either a source
directory or a **build config file**:

```bash
ursa build prod.yml
ursa serve dev.json
ursa serve dev.json --port 3000   # flags still work, and win over the file
```

The positional argument is read as a config file when it names an existing
file ending in `.yml`, `.yaml` or `.json`; otherwise it is the source
directory, as before.

```yaml
# prod.yml
source: docs
output: dist
exclude:
  - legacy/bertball
directory-depth: 2
```

## Rules

- **Keys** are the long command-line flag names (`json-only`, `strict-port`).
  The camelCase spelling (`jsonOnly`) is accepted too.
- **Relative paths resolve against the config file's folder**, not the
  directory you run `ursa` from, so a config means the same thing wherever it
  is invoked. (Paths given as flags still resolve against the working
  directory.)
- **Precedence:** a flag typed on the command line beats the config file,
  which beats the default.
- An unknown key, or a key for the other command (`port` in a `build`
  config), is warned about and ignored. A value of the wrong type is an error.

## Options

| Key | Type | Default | Commands | Meaning |
|-----|------|---------|----------|---------|
| `source` | path | — (required) | both | The docroot: markdown, wikitext, MDX and YAML sources. |
| `meta` | path | Ursa's bundled `meta/` | both | Templates and shared assets. |
| `output` | path | `output` | both | Where the site is written. |
| `whitelist` | path | — | both | File of patterns; only matching files are built. |
| `exclude` | string or list | — | both | Folders to leave out, relative to `source` (a list, a comma-separated string, or the path of a file with one per line). |
| `clean` | boolean | `false` | both | Discard the build cache and empty `output` first. |
| `explain` | boolean | `false` | both | Log, for each output rebuilt, the input that changed. |
| `promote-changelog` | path | — | both | A markdown file rendered at the output root beside `index.html`. |
| `json-only` | boolean | `false` | build | Emit only the `.json` data files (documents, folder records, `_directory.json`). |
| `port` | number | `8080` | serve | Port to serve on. |
| `strict-port` | boolean | `false` | serve | Fail if the port is taken rather than choosing another. |
| `directory-json` | boolean | `true` | both | Write `_directory.json` in every folder. `false` stops writing them and deletes existing ones. |
| `directory-depth` | integer or `infinite` | `infinite` | both | How many levels of nested `directory` objects each `_directory.json` holds. `0`: the folder's own entries only; `1`: plus each subfolder's entries; and so on. `infinite` (or `-1`) nests the whole subtree, which makes the root file a map of the entire site — set a limit on large sites whose pages fetch it. |
| `concurrency` | integer | `50` (or `URSA_BATCH_SIZE`) | both | How many build nodes are computed at once. Lower it to reduce peak memory. |

`directory-depth` and `directory-json` also exist as flags
(`--directory-depth 2`, `--no-directory-json`).

Changing an option that affects output — `json-only`, `directory-json`,
`directory-depth` — rebuilds exactly the outputs it affects on the next run;
there is no need for `clean`.

## Not yet configurable

Two build settings are still read from environment variables at start-up and
have no config key: `DEFAULT_TEMPLATE_NAME` (the template used when a document
names none) and `INCLUDE_FILTER` (a regular expression every built path must
match). Both would be natural additions.
