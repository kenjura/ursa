# Folder metadata

Any folder in the docroot, the docroot included, can carry metadata: a few keys
Ursa acts on, and any keys of your own. Ursa passes all of it through to the
folder's entry in [`_directory.json`](#_directoryjson), so a component can read
it at runtime.

## Where it lives

| File | Format | Status |
|------|--------|--------|
| `metadata.yml` | YAML | preferred |
| `metadata.json` | JSON | supported |
| `config.json` | JSON | **deprecated** — still read; the build warns once per run |

Each file must hold a mapping (an object). A folder may have more than one; they
are merged key by key, and when two files set the same key the one higher in
the table wins (`metadata.yml` over `metadata.json` over `config.json`). A file
that does not parse, or parses to something other than a mapping, is skipped
with a warning.

None of these files is a document: `metadata.yml` is not rendered to a page,
and none of them is listed in the menu, an auto-index, a folder listing or
`_directory.json`'s entries.

```yaml
# campaigns/bnw/metadata.yml
title: Brave New World
thumbnail: img/bnw.webp
status: active        # your own key: Ursa ignores it, _directory.json carries it
players: [Ann, Bo]
```

Metadata files are build inputs like any other: adding, editing or deleting one
under `ursa serve` rebuilds what reads it, and nothing else.

## System keys

| Key | Type | Where | Effect |
|-----|------|-------|--------|
| `hidden` | boolean | any folder | `true` **ignores** the folder and everything beneath it: nothing is rendered or copied, and it is absent from the menu, auto-indexes, breadcrumbs, search, `_directory.json` and `ursa serve`. The files stay in the docroot. |
| `thumbnail` | string | any folder | An image that represents the folder. See [Thumbnails](#thumbnails). |
| `label` | string | any folder | The folder's name in the menu, auto-indexes and breadcrumbs. **Deprecated**: `menu-label` in the folder's `index` document's frontmatter wins over it (see [FILE_METADATA.md](FILE_METADATA.md)). |
| `icon` | string (URL) | any folder | An image shown beside the folder in the site menu. |
| `inject-menu` | object or array | any folder | Puts a named menu (`menu-<name>.md` with an `id`) on every document in the folder and below: `{"id": "classes", "position": "top" \| "bottom", "replace-ancestor-menus": false}`. Menus from ancestor folders accumulate, least specific first, unless an entry sets `replace-ancestor-menus: true`. See the README's Menus section. |
| `lang` | string | docroot only | The pages' `<html lang>`. Default `en`. |
| `openMenuItems` | string[] | docroot only | Top-level folder names whose menu sections start expanded. |

Any other key is yours. Keys are not namespaced, so avoid the names above for
your own purposes; Ursa may add system keys in future, and will document them
here.

## Thumbnails

A folder's thumbnail comes from one of two places:

1. **`thumbnail` in its metadata.** A path with no leading slash is relative to
   the folder (`img/bnw.webp` in `campaigns/bnw/` means
   `/campaigns/bnw/img/bnw.webp`); a leading slash makes it relative to the
   docroot (`/img/everdew.png`). A full URL (`https://…`) is used as written.
2. **An image named `thumb` or `thumbnail`** directly in the folder, with
   extension `.jpg`, `.jpeg`, `.gif`, `.png`, `.webp` or `.svg` (any case).
   This is exactly as if the metadata said `thumbnail: thumb.jpg`.

If both are present, the metadata wins — it is the more specific statement —
and the build (and `ursa serve`) logs a warning naming both. A `thumbnail` path
inside the docroot that does not exist is also warned about.

In `_directory.json` the thumbnail is always given resolved, as a
docroot-absolute URL path (or the external URL).

## `_directory.json`

Every folder in the output, the root included, gets a `_directory.json`
describing the folder and what is directly in it:

```jsonc
// /campaigns/_directory.json
{
  "name": "campaigns",
  "path": "/campaigns",
  "metadata": {                       // this folder's metadata…
    "_build": {                       // …plus what the build knows
      "sourceUpdated": "2026-09-28T19:02:11.000Z",
      "rendered": "2026-09-29T08:15:40.512Z"
    }
  },
  "entries": [
    {
      "name": "bnw",
      "type": "folder",
      "path": "bnw",                  // relative to this folder
      "absolutePath": "/campaigns/bnw", // relative to the docroot
      "url": "/campaigns/bnw/index.html",
      "metadata": {
        "title": "Brave New World",
        "thumbnail": "/campaigns/bnw/img/bnw.webp",
        "status": "active",
        "players": ["Ann", "Bo"],
        "_build": { "sourceUpdated": "…", "rendered": "…" }
      },
      "directory": { /* the whole of /campaigns/bnw/_directory.json */ }
    },
    {
      "name": "LIS.md",
      "type": "file",
      "path": "LIS.md",
      "absolutePath": "/campaigns/LIS.md",
      "url": "/campaigns/LIS.html",   // documents only
      "metadata": { "_build": { "sourceUpdated": "…", "rendered": "…" } }
    }
  ]
}
```

- **Entries** are every file and folder directly in the folder, folders first,
  each group in name order. Folders ignored with `hidden`, and files and
  folders excluded by `--exclude`/`--whitelist` or hidden by name (`.x`,
  `_templates`, `node_modules`), are not listed. The folder's metadata files
  are not entries; they are the folder's `metadata`.
- **`url`** is the page a document is rendered to, or a folder's
  `index.html`. A document shadowed by another source for the same page (say
  `index.md` beside `index.mdx`) has no `url`.
- **`metadata._build.sourceUpdated`** is when the source was last edited: the
  last commit that touched it when the docroot is in a git work tree (the
  working-file time if it has uncommitted changes), else the file's mtime.
  **`rendered`** is when the output it produces — the page, or the `.json` in
  `--json-only` builds, or the copied image or media file — was last written.
  Ursa writes an output only when its bytes change, so `rendered` moves when
  the page actually changed. Files that produce nothing have `rendered: null`.
  A folder's timestamps are the latest of everything beneath it.
- **`directory`** on a folder entry is that folder's own `_directory.json`
  content, nested. How many levels are nested is the `directory-depth` build
  option (default: unlimited, so the root's file describes the whole site).
  See [BUILD_CONFIG.md](BUILD_CONFIG.md). `directory-json: false` turns the
  files off.

`_directory.json` is rebuilt only when something it describes changes: editing
one document rewrites the `_directory.json` of its folder and of each folder
above it, and no others.
