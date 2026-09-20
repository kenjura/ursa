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
```

If not installed, you can run:
```bash
node bin/ursa (same args)
```

### CLI Commands

#### `ursa [generate] <source>`
Generate a static site once and exit.

#### `ursa serve <source>`
Start a development server that:
- Starts an HTTP server over the output directory, then builds the site
- Watches the source and meta directories for changes — every file, no
  extension allow-list — and keeps the output continuously equal to what a
  build from the current source would produce: adds, deletes, renames, folder
  renames, inherited `style.css`/`script.js`/`menu.md`/`config.json` files
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

- `<source>` - Source directory containing markdown/wikitext files (required)
- `--meta, -m` - Meta directory containing templates and styles (default: "meta")
- `--output, -o` - Output directory for generated site (default: "output")
- `--port, -p` - Port for development server (default: 8080, serve command only)
- `--whitelist, -w` - Path to whitelist file containing patterns for files to include
- `--exclude, -e` - Folders to exclude: comma-separated paths relative to source, or path to file with one folder per line
- `--clean` - Delete the `.ursa` cache folder and clear output directory, forcing full regeneration
- `--json-only, -j` - Emit only the `.json` data files (generate command only)
- `--explain` - Log, for every output that was rebuilt, the input that changed

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
record list — the same files a normal build writes, byte for byte.

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
scratchpads, raw source material — put a `config.json` in it:

```json
{
  "hidden": true
}
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
`config.json` travels with the content and applies to every build and every
person who checks the repo out.

`config.json` accepts a few other keys, all of which apply to the folder it
sits in:

| Key | Type | Meaning |
| --- | --- | --- |
| `hidden` | boolean | Ignore this folder and its subtree entirely (above) |
| `label` | string | Name to show for this folder in menus and indices |
| `icon` | string | URL of an icon to show beside it in the menu |
| `openMenuItems` | string[] | Root `config.json` only: folders to expand by default |

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

Ursa's own stylesheet is scoped and layered so that your CSS wins without a fight:

- **Document content** — headings, images, figures, the article box itself — is styled inside `@layer ursa.content`. Your stylesheet is unlayered, and an unlayered rule beats a layered one no matter how specific it is, so a plain `h1 { position: static }` or `#main-content { width: 1000px }` overrides whatever Ursa sets. No `article#main-content h1` escalation, no `!important`.
- **Chrome** — the top bar, menus, widgets, search, footer, breadcrumbs, image hover controls and lightbox — is scoped but *not* layered, so a broad rule like `a { color: … }` in your stylesheet cannot bleed into the navigation. Overriding chrome works as it always did: use a more specific selector than the built-in one.
- **Nothing built in reaches into content it shouldn't.** Chrome rules stop at the article's children; content rules stop at the article's edge.
- **`class="ursa-unstyled"`** on any element puts it and its descendants outside every one of Ursa's scopes — none of Ursa's CSS applies in there at all, and the lightbox leaves images in there alone.

This uses the CSS `@scope` and `@layer` rules: Chrome 118+, Safari 17.4+, Firefox 128+.

### Styling one widget at a time

The two widget panels are shared containers — the right-hand one holds the table
of contents, search and profile in turn — so styling `.widget-dropdown` styles
all of them at once. While a panel is open it carries `data-active-widget` naming
whichever widget is showing, and the attribute is removed when it closes, so a
site can give each one its own treatment:

```css
/* Only the table of contents; search and profile keep the default panel. */
.widget-dropdown[data-active-widget="toc"] {
  background: rgba(20, 24, 28, 0.78);
  backdrop-filter: blur(10px);
}
```

Both panels carry it: `#widget-dropdown` for the right-hand widgets (`toc`,
`search`, `profile`) and `#widget-dropdown-left` for the left-hand ones
(`recent-activity`, `suggested`). The value is the widget's `data-widget` name.
Ursa uses this hook itself, to lay the TOC out along the bottom of the viewport
on a narrow screen.

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

Hydration works per component, not per page. Each component imported directly into the `.mdx` file becomes an **island**: the build wraps its output in `<ursa-island data-island="N">`, and in the browser each island is hydrated as its own React root against exactly the markup the build produced for it. The Markdown around the islands is never handed to React, so the template is free to rearrange it — section wrappers for sticky headings, breadcrumbs, the table of contents — without any hydration mismatch. Two things follow from this:

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
