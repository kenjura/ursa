# Ursa Static Site Generator

A flexible static site generator that converts Markdown, Wikitext, and YAML files into beautiful HTML sites.

There are many like it, but this one's mine.

## Installation

### As a CLI tool (global installation)
```bash
npm install -g @kenjura/ursa
```

### As a library dependency
```bash
npm install @kenjura/ursa
```

## CLI Usage

After global installation, you can use the `ursa` command:

```bash
# Generate site once
ursa <source-directory>
ursa generate <source-directory>

# Development server with live reloading
ursa serve <source-directory>

# With custom meta and output directories
ursa content --meta=templates --output=dist
ursa serve content --meta=templates --output=dist --port=3000

# Using a whitelist file to filter which files are processed
ursa content --whitelist=my-whitelist.txt
ursa serve content --whitelist=my-whitelist.txt

# Using default meta and output directories (meta/ and output/)
ursa content
ursa serve content

# Using a build config file instead of flags (see docs/BUILD_CONFIG.md)
ursa build prod.yml
ursa serve dev.json --port 3000
```

If not installed, you can run:
```bash
node bin/ursa (same args)
```

### CLI Commands

#### `ursa [generate|build] <source>`
Generate a static site once and exit. `build` is an alias of `generate`.

`<source>` may be a build config file (`.yml`, `.yaml` or `.json`) holding
the options below and more; see [docs/BUILD_CONFIG.md](docs/BUILD_CONFIG.md).

#### `ursa serve <source>`
Start a development server that:
- Starts an HTTP server over the output directory, then builds the site
- Watches the source and meta directories for changes — every file, no
  extension allow-list — and keeps the output continuously equal to what a
  build from the current source would produce: adds, deletes, renames, folder
  renames, inherited `style.css`/`script.js`/`menu.md` and folder metadata files
  appearing or disappearing, images and linked documents that come alive,
  template and shared-asset edits
- Rebuilds only the outputs whose inputs actually changed (see
  [Incremental builds](#incremental-builds)), the page a connected browser is
  looking at first, and tells that browser to reload the moment it is written
- Tells other open tabs to refetch the menu, search indices and recent
  activity in place when those change, instead of reloading them

The same incremental pass runs under `generate`, so the two never disagree
about the output; `docs/SERVE.md` is the specification.

### CLI Options

- `<source>` - Source directory containing markdown/wikitext files, or a build config file (required)
- `--meta, -m` - Meta directory containing templates and styles (default: "meta")
- `--output, -o` - Output directory for generated site (default: "output")
- `--port, -p` - Port for development server (default: 8080, serve command only)
- `--whitelist, -w` - Path to whitelist file containing patterns for files to include
- `--exclude, -e` - Folders to exclude: comma-separated paths relative to source, or path to file with one folder per line
- `--clean` - Delete the `.ursa` cache folder and clear output directory, forcing full regeneration
- `--json-only, -j` - Emit only the `.json` data files (generate command only)
- `--explain` - Log, for every output that was rebuilt, the input that changed
- `--directory-depth` - Levels of nested `directory` objects in each `_directory.json` (default: unlimited)
- `--no-directory-json` - Do not write `_directory.json` files

### Incremental builds

Every build — `generate` and each `serve` pass alike — runs over a persisted
build graph (`.ursa/graph.json`). Every output file is owned by exactly one
node of the graph, and every file, path probe and directory listing a node
consumed while producing it is recorded as an input. A pass re-checks the
inputs that changed, recomputes only the nodes that consumed them, stops
propagating where a recomputed value came out identical, writes only files
whose bytes differ, and deletes the outputs of anything whose source is gone.

Consequences:

- `generate` after an edit rewrites the edited document's page and data, the
  full-text index and recent activity — nothing else. A `menu-label` edit
  rewrites the menu data and the listings that show the label. A root
  `style.css` edit rewrites every page (the bundle's URL, which carries its
  content hash, appears in every one of them). Run with `--explain` to see the
  reason for each rewrite.
- Deleting or renaming a source removes its outputs; hiding a folder with
  `config.json` deletes the folder's outputs. `output/` no longer accumulates
  ghosts, and `--clean` is corruption recovery, not a routine step.
- Asset URLs carry `?v=<content hash>` rather than a build timestamp, so
  identical inputs give identical output. The one exception is the footer's
  build id and timestamp, which are fixed once per `serve` session or
  `generate` run and are not an input of anything.
- Starting `serve` (or running `generate`) against a tree that changed while
  ursa was not running converges on the startup pass, without `--clean`.
- Upgrading ursa discards the graph and rebuilds everything.

Files that used to live in `.ursa/` (`content-hashes.json`, `nav-cache.json`,
`dependency-graph.json`, `image-cache.json`, `fulltext-index.json`) are
replaced by the graph.

### JSON-Only Builds

`--json-only` builds the data and skips the site:

```bash
ursa content --json-only --output data
```

What it emits: every document's `<name>.json` and every directory's `<dir>.json`
record list — the same files a normal build writes, byte for byte — and
`public/ursa-content.css`, the stylesheet for rendering a `bodyHtml` (see
[Embedding a document](#embedding-a-document)).

What it skips: HTML, XML, images and their previews, meta/template assets, the
React runtime, per-folder CSS/JS bundles, static file copying (fonts, audio,
video, PDFs), the search and full-text indices, `menu-data.json`,
`recent-activity.json`, and auto-generated index pages.

This is for pipelines that consume ursa's JSON as data rather than publishing a
site — ingesting a docs repo into an application at build time, for example.
Everything skipped operates on the assembled *page*; the JSON's `bodyHtml` is
the pre-template render, which none of those steps touch. That is why the output
is identical rather than merely similar.

Mixing modes against one source tree is safe. The build mode is an input of
the data nodes, so a full build following a JSON-only build writes the HTML and
XML it is missing, and a JSON-only build after a full one leaves the rest of
the output in place.

### Whitelist File Format

The whitelist file is a plain text file where each line specifies a pattern for files to include. Patterns can be:

```text
# Comments start with # and are ignored
# Empty lines are also ignored

# Full absolute paths
/full/path/to/file.md

# Relative paths from source root
character/classes/psion.md
character/classes/

# Directory paths (include trailing slash to match directories)
spells/
documentation/

# Just filenames (matches anywhere in the source tree)
index.md
README.md

# Partial path matches
important-document
classes/wizard
```

### Exclude Option

The `--exclude` option allows you to skip certain folders during generation. This can be specified as:

1. **Comma-separated paths** directly on the command line:
```bash
ursa content --exclude=archive,drafts,old-content
ursa serve content --exclude=test,backup
```

2. **A file path** containing one folder per line:
```bash
ursa content --exclude=exclude-list.txt
```

The exclude file format is similar to the whitelist:

```text
# Comments start with # and are ignored
# Empty lines are also ignored

# Folders to exclude (relative to source)
archive
drafts
old-content/v1
test/fixtures
```

### Ignoring a Folder

To keep a folder out of the build permanently — working notes, prompt
scratchpads, raw source material — give it folder metadata saying so, in a
`metadata.yml` (or `metadata.json`, or the deprecated `config.json`):

```yaml
hidden: true
```

The folder and everything beneath it then take no part in the build:

- no HTML is rendered from its documents
- its images, fonts and other static assets are not copied to the output
- it does not appear in the sidebar menu, in any auto-index, or in breadcrumbs
- its text is not added to the search index
- `ursa serve` returns 404 for anything under it, matching what `generate`
  produces

The files stay where they are in the source tree; the site simply behaves as
though they were not there.

This differs from `--exclude` in scope and in lifetime: `--exclude` is a flag on
one invocation, useful for a one-off or a per-environment build, while
folder metadata travels with the content and applies to every build and every
person who checks the repo out.

### Folder metadata and `_directory.json`

Folder metadata accepts a few other keys, all of which apply to the folder it
sits in, and any keys of your own:

| Key | Type | Meaning |
| --- | --- | --- |
| `hidden` | boolean | Ignore this folder and its subtree entirely (above) |
| `thumbnail` | string | An image representing the folder (relative to it, or `/`-rooted). A `thumb.jpg`/`thumbnail.png`/… in the folder does the same |
| `label` | string | Name to show for this folder in menus and indices (deprecated: prefer `menu-label` in its index document) |
| `icon` | string | URL of an icon to show beside it in the menu |
| `lang` | string | Root only: the pages' `<html lang>` |
| `openMenuItems` | string[] | Root only: folders to expand by default |
| `inject-menu` | object or object[] | Put a named menu on every document in this folder and below; see [Injected menus](#injected-menus) |

Every folder in the output gets a `_directory.json` listing its files and
subfolders, each subfolder with its metadata and its own listing nested, and
each entry with when its source was last edited and when its output was last
written — enough for a page to build a gallery of sections at runtime.
[docs/FOLDER_METADATA.md](docs/FOLDER_METADATA.md) describes both in full;
[docs/FILE_METADATA.md](docs/FILE_METADATA.md) lists the frontmatter keys
documents can set.

### Large Workloads

For sites with many documents (hundreds or thousands), you may need to increase Node.js memory limits:

```bash
# Increase heap size to 8GB for large sites
node --max-old-space-size=8192 $(which ursa) serve content

# Or use the npm scripts
npm run serve:large content
npm run generate:large content

# You can also set environment variables to tune batch processing
URSA_BATCH_SIZE=25 ursa serve content  # Process fewer files at once (default: 50)
```

**Environment Variables for Performance Tuning:**
- `URSA_BATCH_SIZE` - Number of files to process concurrently (default: 50). Lower values use less memory but are slower.
- `NODE_OPTIONS="--max-old-space-size=8192"` - Increase Node.js heap size for very large sites.

## Library Usage

### ES Modules (recommended)

```javascript
import generateSite, { generate, serve } from '@kenjura/ursa';

// One-time generation using the default export
await generateSite({
  source: './content',
  meta: './meta',
  output: './dist',
  whitelist: './my-whitelist.txt' // optional
});

// One-time generation using the named export (matches internal API)
await generate({
  _source: './content',
  _meta: './meta', 
  _output: './dist',
  _whitelist: './my-whitelist.txt' // optional
});

// Development server with live reloading
await serve({
  _source: './content',
  _meta: './meta',
  _output: './dist',
  port: 3000  // optional, defaults to 8080
});
```

### CommonJS

```javascript
const generateSite = require('@kenjura/ursa').default;
const { generate, serve } = require('@kenjura/ursa');

// Usage is the same as above
```

### Library Functions

#### `generateSite({ source, meta, output })`
Default export. Generates the site once with user-friendly parameter names.

#### `generate({ _source, _meta, _output })`
Named export that matches the internal API. Generates the site once.

#### `serve({ _source, _meta, _output, port? })`
Starts a development server with live reloading:
- Generates the site initially
- Starts HTTP server on specified port (default: 8080)
- Watches for file changes in source and meta directories
- Automatically regenerates when changes are detected

#### `@kenjura/ursa/build`
The incremental build and the dev server, for programs that drive builds
themselves: `createBuild`, `createDevServer`, `createIgnoreFilter`. See
[docs/LIBRARY.md](docs/LIBRARY.md).

## Project Structure

Your project should have the following structure:

```
your-project/
├── source/           # Source files (markdown, wikitext, yaml)
│   ├── index.md     # Required: main page
│   └── ...
├── meta/            # Templates, styles, and configuration
│   ├── templates/
│   ├── styles/
│   └── ...
└── output/          # Generated site (created automatically)
```

## Styling a Site

Drop a `style.css` (or `style-ursa.css`, or `_style.css`) in any source folder and it applies to every document in that folder and below. Every such file from the docroot down to the document's own folder is included, nearest last, so a deeper file overrides a shallower one.

Ursa's markup and stylesheet follow one contract, written up in [docs/changes/semantic-css/SPEC.md](docs/changes/semantic-css/SPEC.md). A site upgrading from 0.100.x or earlier should follow [MIGRATION.md](docs/changes/semantic-css/MIGRATION.md): the old selectors (`#main-content`, `nav#nav-main`, `.sectionOuter`, `.widget-dropdown`, …) no longer match anything, and the build warns about each site stylesheet or script that still uses them.

### Tokens first

Every colour, font and size in Ursa's stylesheet comes from a custom property declared on `.ursa` (the `<body>`). Theme a site by setting them there — not on `:root`, where Ursa's own defaults on `.ursa` would shadow them:

```css
.ursa {
  --ursa-bg: light-dark(#f4ecd8, #1b1712);
  --ursa-fg: light-dark(#2b2118, #e8dcc2);
  --ursa-accent: #b33;
  --ursa-font-heading: "Site Goudy", serif;
  --ursa-doc-width: 56rem;
}
```

The full list is in [SPEC.md §6](docs/changes/semantic-css/SPEC.md#6-tokens). Borders and hover tints are mixes of `currentColor`, so they follow whatever colour a region is given.

### The content scope

Everything Ursa ships is in `@layer ursa.*`; a site stylesheet is unlayered, so any site rule beats any Ursa rule regardless of specificity — no ID chains, no `!important`. The flip side is that a broad rule like `a { … }` now reaches the navigation too. Put rules for document content inside the content scope:

```css
@scope (.ursa-doc) to (.ursa-unstyled) {
  h1 { color: darkred; }
  .ursa-section[data-level="1"] > p:first-of-type::first-letter { font-size: 3em; }
}
```

Documents are sectioned when they render: each h1 and what follows it is a `section.ursa-section[data-level="1"]`, with one `data-level="2"` section per h2 inside it, and every heading has an id slugged from its text. `.ursa-doc[data-ursa-path="/classes/fighter"]` targets one document.

### Components

Restyle a component with its tokens, then with one class: `.ursa-sitefooter`, `.ursa-panel[data-widget="toc"]`, `.ursa-sitenav .ursa-nav-link`, `.ursa-breadcrumbs`. State is attributes, not classes — `[aria-current="page"]`, `[aria-expanded="true"]`, `[data-trail]`, `[hidden]`. Each widget panel is its own `aside.ursa-panel[data-widget]`, so styling one widget is a single attribute selector:

```css
.ursa-panel[data-widget="toc"] { background: rgb(20 24 28 / .78); }
```

**`class="ursa-unstyled"`** on any element puts it and its descendants outside every one of Ursa's scopes — none of Ursa's CSS applies in there at all, and the lightbox leaves images in there alone.

### Colour schemes

`.ursa` has `color-scheme: light dark` and every colour token is a `light-dark()` pair, so a site follows the OS by default. `data-ursa-color-scheme="light|dark"` on the root pins one; `color-scheme` on any element flips that subtree. See [examples/site-color-scheme.css](docs/changes/semantic-css/examples/site-color-scheme.css).

### Embedding a document

Every build (including `--json-only`) writes `/public/ursa-content.css`: the base and content styles alone, with no page frame. A document's JSON `bodyHtml` is its sections only — no breadcrumbs or injected menus — so an application can render it with:

```html
<link rel="stylesheet" href="/public/ursa-content.css">
<article class="ursa ursa-doc">${bodyHtml}</article>
```

Nothing in Ursa's CSS matches outside `.ursa`. See [examples/embed.html](docs/changes/semantic-css/examples/embed.html).

If the host shows the document in an `<iframe>`, the framing page needs `<meta name="color-scheme" content="light dark">`. Without it, a frame whose `--ursa-bg` is transparent shows the browser's white canvas under dark-scheme text.

This needs `@scope`, `@layer` and `light-dark()`: Chrome 123+, Safari 17.5+, Firefox 128+.

## Recent Activity

The site's Recent Activity widget lists the ten most recently edited documents. A document is dated by the last git commit that touched it — one `git log` pass over the source directory at the start of a build — or by its file mtime if it has uncommitted changes, is untracked, or the source is not in a git work tree. The build's own time never enters into it, so `--clean` does not reset the feed.

This needs git history to be present. A shallow checkout (GitHub Actions' `actions/checkout` defaults to depth 1) makes every document look edited in the one fetched commit; ursa warns when it sees one. Use `fetch-depth: 0`.

## MDX and Interactive Components

A `.mdx` document is Markdown that can import and use React components. Put components in a `_components/` folder anywhere from the docroot down to the document's own folder, and import them without a relative prefix:

```mdx
---
hydrate: true
---
import PowerList from '_components/PowerList.jsx';

# Spells

<PowerList class="Witch" groupBy="school" />
```

Every document is rendered to HTML at build time, components included, so a page reads the same with JavaScript off. `hydrate: true` in the frontmatter additionally ships the page's components to the browser so they can run there.

Hydration works per component, not per page. Each component imported directly into the `.mdx` file becomes an **island**: the build wraps its output in `<ursa-island data-island="N">`, and in the browser each island is hydrated as its own React root against exactly the markup the build produced for it. The Markdown around the islands is never handed to React, so the template is free to add to it — breadcrumbs, image actions, the table of contents — without any hydration mismatch. Two things follow from this:

- A component's first render must produce the same markup in the browser as it did at build time (the usual hydration contract). Fetch data in an effect and render a placeholder first.
- React context does not cross from one island to another. Components that need to share state should be one island, with the shared state inside it.

`island` wrapping applies to the default export of any `.jsx`/`.tsx` file the `.mdx` imports, and of `.js`/`.ts` files under `_components/`. Components that a component imports are not islands themselves — they render inside their parent's root. Non-function imports (JSON, data) pass through untouched.

### Telling the template the article changed

The template's scripts read the article once, when the page loads: the sticky headings and the table of contents are both built from the headings present at that moment. A component that renders content later — a list fetched from a JSON file, say, with headings of its own — should say so once it has:

```jsx
useEffect(() => {
  if (items.length) window.ursa?.contentChanged?.(rootRef.current);
}, [items]);
```

`contentChanged(root)` dispatches `ursa:content-changed` on `document` with the changed element in `event.detail.root` (the article, if omitted). Sticky headings and the table of contents re-read the article on it; calls within the same task are coalesced into one event. A site's own scripts can listen for the same event.

## Menus

The site's navigation is generated from the folder tree. A folder can replace
it with its own menu by holding a `menu.md` (or `menu.txt`, `_menu.md`,
`_menu.txt`); that menu applies to the folder and everything below it, until a
deeper folder holds a menu of its own.

```markdown
---
auto-generate-menu: true   # start from the folder tree…
menu-position: top         # top (default) or side
menu-depth: 3
---

- [Custom link](./somewhere.md)
{menu}                     # …and put the generated items here
- [Another](https://example.com)
```

Items are Markdown list links (`- [Label](./path.md)`, nested by indentation)
or wikitext (`* [[path|Label]]`). Relative paths resolve from the menu file's
folder.

### Named menus

A menu file whose frontmatter has an `id` is a **named menu**. It does not
replace the folder's navigation; instead any document in that folder or below
it places the menu in its body with an anchor on a line of its own:

```markdown
---
id: classes
appearance: horizontal     # horizontal (default) or vertical
---

- [Arcanist](./arcanist.md)
- [Fighter](./fighter.md)
- [Witch](./witch.mdx)
```

```markdown
# Fighter

{menu:classes}

Fighters are…
```

- Name the file `menu.md` or `menu-<anything>.md` (`menu-classes.md`,
  `menu-2.txt`); a folder can hold several. The `id` is required for
  `menu-<anything>.md`; `menu.md` without one is the folder menu above.
- The anchor renders as a static
  `<nav class="ursa-nav ursa-menu" data-layout="bar|tree">` exactly where it
  stands in the document, not as a fixed element. The link to the current page
  gets `aria-current="page"` (the items above it `data-trail`), so a menu of
  sibling pages works as a category switcher. An item whose folder holds the
  current page without being it — "Ancestry" (`ancestry/index.md`) while
  reading `ancestry/dragon.md` — gets `data-path`, styled more lightly than
  current: you are inside that section, and can still click through to its page.
  `appearance: horizontal` (`data-layout="bar"`) is a strip of items with hover
  dropdowns for nested items; `vertical` (`data-layout="tree"`) is a stacked,
  indented list.
- The nearest file with that `id` wins, so a deeper folder can shadow a menu
  defined above it. `auto-generate-menu` and `menu-depth` work as in `menu.md`.
- A menu anchored above the first heading stays above the page title, in the
  document header (`header.ursa-doc-header`, with the breadcrumbs). Like the
  breadcrumbs, it is page furniture and is not part of the JSON's `bodyHtml`.
- The anchor must be on its own line. It works in `.md`, `.txt` and `.mdx`.
  An anchor inside a code span or code block is left as written.
- Anything in the menu file that is not a list item — a label before the
  list, a note after it — is rendered as Markdown inside the menu, in order.
  Its relative links and images are resolved against the menu file's own
  folder, since the menu is shown on pages elsewhere. (With
  `auto-generate-menu` the body is a template around `{menu}` and only its
  items count, as in `menu.md`.)
- Menu files are navigation, not documents: they are not rendered to pages,
  listed in menus or indices, or searched.

**Failure is quiet.** An anchor whose menu does not exist, or whose menu file
cannot be parsed, is replaced by `<!-- ursa: menu "id" not found -->` and
reported as a build warning naming the document. The page renders normally
with nothing where the menu would have been, and the surrounding Markdown is
untouched. Under `ursa serve`, creating the missing menu file fills the anchor
without editing the page.

### Injected menus

To put a named menu on every document in a folder and its subfolders without
anchoring it in each one, name it in the folder's metadata (shown as JSON; `metadata.yml` works the same):

```json
{ "inject-menu": { "id": "classes", "position": "top" } }
```

- `id` is the menu's frontmatter `id`, resolved from each document's folder
  exactly as an anchor is (nearest file up the tree with that id). `position`
  is `top` (default) or `bottom`. An array injects several:
  `[{ "id": "classes" }, { "id": "footer-links", "position": "bottom" }]`.
- A menu injected at the top goes above the page title, in the document
  header, like an anchor on the first line; one at the bottom goes in the
  document footer (`footer.ursa-doc-footer`) after the last content. Neither is
  part of the JSON's `bodyHtml`. A document that
  already anchors the same id is left alone — it is not given the menu twice.
- Menus **accumulate** down the tree. A deeper folder's metadata with
  its own `inject-menu` adds its menus after the ones its ancestors inject:
  at each position the least specific folder's menu comes first and the most
  specific last. A folder without the key changes nothing, and the same id
  at the same position is injected once.
- To start over instead, give an entry `"replace-ancestor-menus": true`:
  `{ "id": "subsection", "replace-ancestor-menus": true }` drops every menu
  the ancestor folders inject at that entry's position (the other position
  is untouched) and puts this one in their place. Folders below it add to
  the replacement as usual.
- A menu that cannot be resolved from a document's folder gets the same quiet
  treatment as an anchor: an HTML comment and a warning naming the document.
- Editing a folder's metadata re-renders exactly the documents beneath it.

## Auto-Index Generation

Ursa automatically generates index pages for folders that don't have one. You can also explicitly control auto-index generation in your index documents using frontmatter:

```yaml
---
title: My Section
generate-auto-index: true
auto-index-depth: 2
auto-index-position: bottom
---

# Welcome to My Section

This is the introduction to my section. The auto-generated file listing will appear below.
```

### Auto-Index Frontmatter Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `generate-auto-index` | boolean | false | When true, generates an auto-index listing for this folder |
| `auto-index-depth` | number | 1 | Recursion depth: 1 = current folder only, 2 = include subfolders, etc. |
| `auto-index-position` | 'top' \| 'bottom' | 'top' | Where to insert the auto-index relative to document content |

### Examples

**Basic auto-index (top of page):**
```yaml
---
generate-auto-index: true
---
```

**Deep auto-index at bottom:**
```yaml
---
generate-auto-index: true
auto-index-depth: 3
auto-index-position: bottom
---

# Section Overview

Here's some content explaining this section...
```

## Developing

For development on ursa itself:

```bash
npm run serve
```

Watches source and meta folder; on change, writes HTML to build folder.

### Environment Variables

- `SOURCE`: path to the source folder, default `${cwd}/source`
- `META`: path to the meta folder, default `${cwd}/meta`
- `BUILD`: path to the build folder, default `${cwd}/build`

## Running Locally

```bash
npm start
```

Generates the site once using default directories.

## Requirements

SOURCE folder should have at least an index.md in it.


## Link logic
Links are allowed to be extensionless. Link resolution works as follows:
- If link has an extension, look for exact match, and 404 if not found
  (`.md`/`.mdx` links are rewritten to `.html` optimistically)
- If link has no extension:
  - `/foo` names the document `foo.*` if there is one — the file wins over a
    folder of the same name — and otherwise the folder's index, `foo/index.html`
  - `/foo/` always names the folder's index
- Every folder that holds documents has an index page. Which source produces
  it is decided by one precedence list, highest first:
  1. a hand-written `index.html`
  2. `index.mdx`, `index.md`, `index.txt`, `index.yml`
  3. `_index.*` in the same extension order
  4. `home.*`, then `_home.*`
  5. `<foldername>.*` (the file also renders to its own path)
  6. the generated auto-index listing
- The same list decides which of several sources for one output path is
  rendered (`index.mdx` beside `index.md`: the `.mdx`; `foo.md` beside a
  hand-written `foo.html`: the `.html`). The shadowed source is not rendered,
  indexed or listed, and a warning names both files. Removing the winner
  promotes the next candidate on the next build.
- A frontmatter-only `index.md` supplies the folder's label; the auto-index is
  still the page.
