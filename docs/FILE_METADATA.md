# File metadata

A document's metadata is its YAML frontmatter: a block between `---` lines at
the very top of a `.md`, `.mdx`, `.txt` or `.yml` document.

```markdown
---
title: Absorb
menu-label: Absorb!
class: Witch          # your own key
level: 3
---

# Absorb
```

Ursa acts on the keys below. Every other key is yours: it is carried in the
document's `.json` output (`metadata`), in its folder's `<folder>.json`, and it
can be shown on the page with `render-frontmatter`. Folders have metadata too,
in a different place; see [FOLDER_METADATA.md](FOLDER_METADATA.md).

## Documents

| Key | Type | Default | Effect |
|-----|------|---------|--------|
| `title` | string | from the file name | The page `<title>`, and the heading Ursa adds when the document does not start with an `h1`. |
| `template` | string | `default-template` | The meta template the page is rendered with (a folder under `meta/templates/`). |
| `menu-label` | string | from the file or folder name | The document's name in the site menu, auto-indexes and breadcrumbs. On a folder's `index` document it names the **folder**, and wins over the folder metadata's deprecated `label`. |
| `menu-sort-as` | string | the label | Sort key in the menu and auto-indexes, when the label alone sorts wrongly (`"05 Fifth"`). On an `index` document it sorts the folder. |
| `hydrate` | boolean | `false` | `.mdx` only: also ship the page's components to the browser so they run there. Without it the page is static HTML. See the README's MDX section. |
| `render-frontmatter` | boolean | `false` | Show the frontmatter as a definition list (`dl.ursa-frontmatter`) after the first heading. Ursa's own keys in this table are left out of the list. |
| `generate-auto-index` | boolean | `false` | Add a listing of the folder's contents to this document (use on an `index` document). |
| `auto-index-depth` | number | `1` | How many folder levels that listing descends. |
| `auto-index-position` | `top` \| `bottom` | `top` | Where the listing goes relative to the document's own content. |
| `template-source` | string (path) | — | Written by Ursa, not by hand: marks the document as an instance of a document template in `_templates/`, so edits to the template are merged into it. See `ursa template`. |

### Frontmatter-only index documents

An `index.md` (or `.mdx`) with frontmatter and no body renders no page of its
own. It exists to describe its folder — `menu-label`, `menu-sort-as` — and the
folder's page is the generated auto-index.

## Menu files

`menu.md`, `_menu.md`, `menu-<name>.md` (and `.txt` variants) are menus, not
documents. Their frontmatter:

| Key | Type | Default | Effect |
|-----|------|---------|--------|
| `id` | string | — | Makes the file a **named menu**, shown only where a document writes `{menu:<id>}` or a folder's `inject-menu` puts it. Required on `menu-<name>.md`. |
| `appearance` | `horizontal` \| `vertical` | `horizontal` | Named menus: a strip with dropdowns, or an indented list. |
| `auto-generate-menu` | boolean | `false` | Start from the generated folder menu; `{menu}` in the body marks where it goes. |
| `menu-position` | `top` \| `side` | `top` | Folder menus: where the site navigation appears. |
| `menu-depth` | number | — | How many levels of the generated menu to include. |

## Where metadata appears in the output

- `<doc>.json` — `metadata` is the parsed frontmatter, verbatim.
- `<folder>.json` — one record per document in the folder's subtree, each with
  its `metadata`.
- `_directory.json` — file entries carry only build metadata
  (`metadata._build.sourceUpdated` / `rendered`); read the document's own
  `.json` for its frontmatter. See [FOLDER_METADATA.md](FOLDER_METADATA.md).
- The page — only with `render-frontmatter: true`.
