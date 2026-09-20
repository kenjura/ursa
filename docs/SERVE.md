# `ursa serve`: change detection and regeneration

**Status:** implemented in 0.97.0 (Part I); Part II is the gap analysis
against v0.92.0 that motivated it, kept as history. The decisions Part II §C
leaves open were taken as the spec proposes, except where noted below.
**Written:** 2026-09-03. **Implemented:** 2026-09-20.

Implementation notes (0.97.0):

- The engine is `src/helper/build/graph.js`; the node catalogue is
  `src/helper/build/site.js`; the pass is `src/helper/build/pass.js`, run by
  both `generate` and `serve`. The precedence list of §8.2 is
  `src/helper/build/precedence.js`.
- Recorded inputs are exact without threading a context through every
  helper: helpers that touch the disk import their `fs` calls from
  `src/helper/build/tracedFs.js`, which reports each read, probe and listing to
  the node currently computing (via `AsyncLocalStorage`). Label lookups the
  menu, breadcrumbs and auto-indices make are answered from `docMeta`
  projections pre-loaded into the recorder, so a body edit does not reach them.
- §4.1: leaf ids are stored relative to the docroot (`$S/…`) and meta (`$M/…`),
  so the persisted graph survives the tree moving. Directory fingerprints hash
  the sorted `(name, kind)` list minus dot-files and editor scratch names.
- §4.2: `linkResolution(href)` and `outputOwner(path)` read `validPaths` /
  `documentSet` rather than per-candidate lookups; early cutoff gives the same
  observable behaviour with far fewer leaves. `dirIndexJson`, `dirListingHtml`
  and `customMenu` read a per-folder projection `dirSet(dir)` for the same
  reason. `docJson`/`docXml` are one node, `docData`. `fullTextIndex` merges
  per-document `docWords` nodes. `cssChain`/`jsChain` are folded into
  `cssBundle`/`jsBundle`.
- §4.4: the meta bundle's `fetch('/public/x.json')` calls are not versioned by
  the JSON's content hash — that would rewrite the bundle, and so every page,
  whenever the menu changed. They carry the page's `data-build` (the session's
  build id) at runtime instead; `serve` sends `Cache-Control: no-store`.
- §5.6: orphans found while a pass is running are deleted at the end of the
  pass, skipping any path that is owned again, case-insensitively (the
  `Foo.md` → `foo.md` case); orphans of removed nodes are deleted before the
  pass writes.
- §7: the footer's build metadata is excluded from the `footer` node's
  fingerprint, so a `generate` run rewrites nothing just to stamp a new build
  id into unchanged pages. `expectConverged` in
  `src/helper/build/__test__/pass.test.js` is the §10 comparison.
- §6.1: "affects you" is decided from the dirty set (an upper bound, as
  specified); "reload" is decided by comparing the bytes of the viewed output
  before and after, so a page whose owner moved (auto-index taking over a
  deleted `index.md`) or that was deleted reloads to the truth. A 404 page
  carries the reload script too, so a tab parked on a URL loads the page when
  it appears.
- Part II §C.7 (`dev` mode) is still open: `dev.js` now reads the shared
  precedence list but is otherwise unchanged.
- §C.10/§C.11: yes — `generate` deletes outputs whose source is gone or hidden.
  Only files a node recorded as owned are ever deleted; files ursa never wrote
  are left alone.
- The listing pages (`<dir>.html`) now emit root-absolute links and fill
  `${customScript}`; the auto-index no longer lists a folder's listing page
  beside the folder itself.

**Supersedes** the design sections of `docs/changes/serve-logic.md` and all of
`docs/1.0/REGENERATION.md`. The root-cause history in `serve-logic.md` is still
accurate and worth reading; its architecture section is folded into this document.

The brief this document is written to:

> - watch docs and meta for all file changes
> - any change to html/js/css on any html file (or content change to a json
>   file) should regenerate the necessary files, prioritizing pages currently
>   being watched (with a linked websocket awaiting hot reload)
> - consider edge cases like: adding an `index.mdx` when `index.md` exists;
>   adding `foo/index.md` when `foo.md` existed; renaming files; adding an
>   image where a dead image link existed; etc.
> - consider the bundling system, which creates large "catchment zones" for
>   regeneration

---

# Part I — Specification

## 1. What `serve` promises

`ursa serve <source>` starts an HTTP server over the output directory, builds
the site, then keeps the output directory continuously equal to what a build
from the current source would produce, while telling connected browsers when
the page they are looking at has changed.

Three invariants define correct behaviour. Everything else in this document is
a consequence of them.

1. **Convergence.** Once the filesystem has been quiet for one debounce window
   and the pass that follows has finished, the output directory is
   byte-identical to `ursa generate --clean` run against the same source and
   meta at that moment (§7 lists the one deliberate exception, the footer's
   per-session build metadata). No sequence of edits, adds, deletes or renames
   requires a restart or `--clean` to reach that state.
2. **Minimality.** A pass rewrites an output file only if at least one input
   that output actually consumed has changed. Saving a file without changing
   its bytes rewrites nothing. Editing a paragraph in one article does not
   touch the menu, the other articles, or the search index's entries for other
   documents.
3. **Viewer first.** When a change affects a page a connected browser is
   looking at, that page and the assets it loads are brought up to date before
   anything else, and that browser is told to reload as soon as they are —
   before the rest of the affected set is processed.

Two supporting rules:

- **Nothing is dropped.** Changes that arrive while a pass is running are
  processed by the next pass. Passes run one at a time.
- **No filename heuristics decide invalidation.** What to rebuild is decided
  only by recorded inputs. A file's name and extension decide how it is
  *processed*, never what it *invalidates*. This is the single rule that the
  current implementation lacks, and the reason it has a history of missed
  updates (see `serve-logic.md`, root causes).

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **docroot** | The `<source>` directory. Documents, static assets and inherited files live here. |
| **meta** | The templates directory (`--meta`, default: ursa's own `meta/`). Templates, template assets, shared assets. |
| **output** | The directory served over HTTP and written by ursa. Nothing else writes to it. |
| **document** | A source file rendered to a page: `.md`, `.mdx`, `.txt` (wikitext), `.yml`. Also hand-written `.html`, which is copied through with link processing. |
| **inherited file** | A file whose effect applies to its own folder and every folder beneath it: `style.css` / `style-ursa.css` / `_style.css`, `script.js` / `_script.js`, `menu.md` / `menu.txt` / `_menu.md` / `_menu.txt`, `config.json`. Plus root-only `footer.md`, and folder-only `transformMetadata.js`. |
| **catchment zone** | The set of outputs that consume a given inherited file: every page in the folder subtree, minus subtrees that override it (for menus), plus that subtree's generated index pages. |
| **leaf** | An observed fact about the filesystem: a file's content, a path's existence, or a directory's listing. Leaves are the only things the watcher changes. |
| **node** | A derived value with recorded inputs (leaves or other nodes). Some nodes write output files; some are in-memory only. |
| **output node** | A node that owns one or more files in `output/`. Every file in `output/` is owned by exactly one node. |
| **pass** | One run of the incremental build: refresh stale leaves, recompute dirty nodes in dependency order, write, delete orphans, notify. |
| **batch** | The set of watcher events collected during one debounce window. A batch starts a pass. |
| **viewed URL** | A URL a connected WebSocket client has reported it is currently displaying. |

## 3. Watching

### 3.1 What is watched

Both trees, recursively, **without an extension allow-list**:

- the docroot, and
- the meta directory.

Allow-lists are how meta fonts, and later `.otf`/`.wav`/`.zip`, came to be
invisible to the watcher while being copied by `generate`. The correct filter
is a *deny*-list of things that are never inputs:

- `.ursa/` and `.ursa.json` inside the docroot (ursa's own cache and state);
- the output directory, if it lies inside the docroot;
- `node_modules/`, `.git/`;
- editor scratch files: names ending in `~`, `.swp`, `.swx`, `.tmp`, names
  beginning with `.#`, and the vim `4913` probe file.

Everything else — including files with no extension, files with unknown
extensions, and **directories** — produces events. A file that ursa does not
process is still an input: its existence can shadow another file (§8.2), and
its name appears in directory listings that menus and indices read.

The whitelist file (`--whitelist`) and the exclude file (`--exclude`, when it
names a file) are watched too. They are inputs to the document set (§4.3).

### 3.2 Events

The watcher library reports only "something happened at this path" with a
coarse kind (`update` / `remove`). Ursa does not trust the kind. An event is
normalised to a **path**, and the truth about that path is established by
`stat` at the start of the next pass. This makes atomic saves (write temp file,
rename over original), truncate-then-write, and remove+create pairs from
renames all collapse to "this path may have changed; look at it."

A path event marks three leaves stale:

- `file:<path>` — content may have changed or the file may be gone;
- `lookup:<path>` — existence may have flipped;
- `dir:<dirname(path)>` — the parent's listing may have changed.

A directory event (creation, removal or rename of a folder) additionally
triggers a **subtree rescan**: the directory is walked, its current contents
are diffed against every known leaf beneath it, and a path event is
synthesised for every difference. This is required because recursive watchers
on macOS report a renamed or moved directory as a single event for the
directory itself and say nothing about the files inside it.

### 3.3 Debounce

Events are collected until the filesystem has been quiet for **500 ms**, or
until **2000 ms** have elapsed since the first event in the batch, whichever
comes first. The upper bound exists so a bot or a bulk-rename that writes
continuously cannot postpone regeneration indefinitely.

On the first event of a batch, every client is sent `update-start` (§6).

### 3.4 Ursa's own writes

Ursa writes to `output/`, to `.ursa/`, and to `.ursa.json`; all are excluded
from watching. Two ursa features write into the **docroot** and therefore do
produce events, deliberately:

- document-template reconciliation (`_templates/`) rewrites instance documents
  after a three-way merge;
- nothing else. (`--promote-changelog` stages a file into the docroot before
  the build starts and removes it on exit; both are ordinary events.)

These are correct events — the document really did change — and cannot loop:
the pass that wrote the file already consumed its new content, so the
follow-up event finds an unchanged fingerprint and stops (§5.3).

### 3.5 Warm start

On startup with an existing `.ursa/graph.json`, the persisted leaf set is
re-checked in full (stat every file leaf, probe every lookup leaf, list every
directory leaf) and a single pass is run. Anything that changed while ursa was
not running — including renames and deletions — is caught by that pass exactly
as if the watcher had reported it. The cost is one `stat` per known leaf, which
on a 10k-document site is under a second; content is re-hashed only where size
or mtime moved.

Only after the startup pass completes does the watcher start delivering
batches. Events that occur during the startup pass are queued, not dropped
(§5.5).

## 4. The build graph

Every output is a **derived node**. A node's compute function receives a
context through which it reads files, probes existence, lists directories, and
gets other nodes' values; the engine records every such access as an edge.
Edges are re-recorded on every recompute (replace, not append), so
content-dependent inputs — which template a document's frontmatter selects,
which components an MDX file imports — are always current and can shrink.

A node recomputes if and only if at least one recorded input's fingerprint
differs from the fingerprint recorded when the node last read it. After a
recompute, the node's own fingerprint is derived from its value; if it did not
change, dependents are not disturbed (**early cutoff**). Verification is
demand-driven and topological: verifying a node verifies its inputs first, so
bundles are always current before the pages that link them, and pages before
the indices that list them.

The engine already exists (`src/helper/build/graph.js`, unit-tested, not yet
wired in). This section specifies what is *built on it*: the leaf kinds, the
node catalogue, and which inputs each node must record.

### 4.1 Leaves

| Leaf | Fingerprint | Notes |
|---|---|---|
| `file:<abs path>` | content hash; `missing` if absent | size+mtime fast path, hash to confirm. A touch that changes nothing is a no-op. |
| `lookup:<abs path>` | `exists` / `absent` | Recorded whenever a compute function *probes* for a file that may not exist. Creation and deletion become observable changes. |
| `dir:<abs path>` | hash of the sorted `(name, kind)` list of direct children | Hidden names (dot-prefixed) and deny-listed names excluded. Adding, removing or renaming an entry changes it; editing a file's content does not. **New leaf kind; `graph.js` does not have it yet.** |
| `ursa:version` | the running ursa version | Every persisted graph is stamped with it; a mismatch discards the graph (cold start). Keeps the current `enforceCacheVersion` behaviour. |

Directory leaves are what make the menu, the directory listings, the
auto-indices, index-file precedence and folder-named promotion reactive
without any of them depending on file *contents*.

### 4.2 Node catalogue

Notation: `node(key)` is a family of nodes, one per key. "Reads" lists the
inputs the compute function must access through the context so the edges are
recorded. Where a node writes files, "Owns" lists them.

#### Site-wide

| Node | Reads | Value / Owns |
|---|---|---|
| `templates` | `dir:meta/templates`; `file:meta/templates/<t>/index.html` for each subfolder; legacy `*-template.html` at the meta root when no subfolders exist | map of template name → raw HTML |
| `metaBundle(t)` | `templates`; for every `/public/...` asset the template references, `lookup:` in the template folder then in `meta/shared`, then `file:` of the one found; `metaAsset(a)` for every asset referenced by `url()` inside those CSS files | rewritten template HTML with one bundle `<link>` and one bundle `<script>`; owns `public/<t>.bundle.css`, `public/<t>.bundle.js`. Bundle URLs carry `?v=<content hash>` (§4.4). |
| `metaAsset(a)` | `dir:` of `meta/shared` and each template folder (to enumerate); `file:a` | copies `a` to `public/…`; value = URL and content hash |
| `reactRuntime` | `ursa:version` | owns `public/react-runtime.js` |
| `footer` | `lookup:`/`file:` for `<docroot>/footer.md`, `<docroot>/package.json`, `<docroot>/../package.json` | footer HTML. Build id and timestamp are computed **once per serve session**, not per pass (§7). |
| `folderConfig(dir)` | `lookup:`/`file:` for `<dir>/config.json` | parsed config or `null` |
| `hidden(dir)` | `folderConfig(d)` for `d` = dir and each ancestor up to the docroot | boolean. Hidden folders produce no output. |
| `documentSet` | `dir:` for every directory in the docroot (recursively — each directory listing is its own leaf, so adding a file dirties one leaf); `hidden(dir)` for each; `file:` of the whitelist / exclude file if given | the list of documents, static assets, hand-written HTML and directories that participate in the build. This is a projection: it changes only when a *name* appears, disappears or changes kind. |
| `validPaths` | `documentSet` | the canonical-URL map used for link resolution. Changes only on add/remove/rename. |
| `linkResolution(href)` | `validPaths` | canonical `.html` path for one normalised href, or `null`. One node per distinct href seen across the site. Pages depend on these, **not** on `validPaths`, so adding a document rewrites only pages whose links now resolve differently (§8.4). |
| `menuData` | `documentSet`; `docMeta(d)` for every document (menu-label, menu-sort-as, metadata-only); `folderConfig(dir)` for every folder; `lookup:` for `icon.*` in each folder and `<name>-icon.*` beside each file; `linkResolution` for each menu href | the full auto-menu tree; owns `public/menu-data.json` |
| `menuHtml` | `menuData` | the root-level menu markup inlined in every page. Depends on `menuData` but its fingerprint only moves when the *root level* changes, so a document added three folders deep changes the JSON, not every page. |
| `customMenu(dir)` | `file:<dir>/menu.md` (or the first of the four menu names that exists — recorded as lookups); if `auto-generate-menu`: `dir:` for the subtree to the configured depth, `docMeta` for labels; `linkResolution` for each href | owns `public/custom-menu-<id>.json` |
| `customMenuFor(dir)` | `lookup:` for each of the four menu filenames in `dir` and every ancestor, stopping at the first hit | the owning menu directory or `null`. The lookup chain is the catchment zone for menus: adding `menu.md` anywhere flips exactly the lookups of pages beneath it. |
| `cssChain(dir)` | `lookup:` for `style-ursa.css`, `style.css`, `_style.css` in `dir` and every ancestor to the docroot | ordered list of existing stylesheet paths, shallowest first |
| `cssBundle(dir)` | `cssChain(dir)`; `file:` for each path in it; `staticAsset(a)` for each asset referenced by `url()` | owns `public/<folder>.bundle.css`; value = URL with `?v=<content hash>`. Folders with identical chains produce identical bundles; the bundle is still named per folder so output ownership stays one-to-one. |
| `jsChain(dir)`, `jsBundle(dir)` | as above with `script.js`, `_script.js` | owns `public/<folder>.bundle.js` |
| `staticAsset(a)` | `documentSet`; `file:a` | copies `a`; value = URL and content hash. Fonts, audio, video, PDFs, archives. |
| `imageInfo(img)` | `file:img` | **cheap**: content hash, dimensions, and whether a preview *will* exist (small images and SVG/ICO get none). Value includes the original URL and the preview URL if any. |
| `imagePreview(img)` | `imageInfo(img)` | **expensive**: encodes the WebP preview. Owns `<dir>/<name>.preview.webp`. Scheduled after pages (§5.4). |
| `imageCopy(img)` | `file:img` | owns `<dir>/<name>.<ext>` (the original) |
| `sourceTimestamps` | `git log`/`git status` over the docroot, else file mtimes | last-edited time per document, taken from the last commit that touched it (working-tree mtime for uncommitted files). Not build state: never persisted. (0.96.0; replaced the `.ursa.json` `contentTimestamps` side table, which stamped every regenerated document with the build time and so was reset by every `--clean`.) |
| `ursaMetadata` | `ursa:version`; `file:<docroot>/package.json` | embedded in every JSON output |

#### Per document

| Node | Reads | Value / Owns |
|---|---|---|
| `docMeta(d)` | `file:d` | frontmatter projection: title, template, menu-label, menu-sort-as, hydrate, template-source, generate-auto-index (+depth, position), render-frontmatter, and `isMetadataOnly`. A body edit leaves this unchanged, which is what stops it reaching the menu. |
| `bodyHtml(d)` | `file:d`; for `.mdx`: `file:` for every module esbuild resolved (from its metafile) and `lookup:` for `_components` in each ancestor folder; if `generate-auto-index`: `dir:` for the folder subtree to the configured depth and `docMeta` of the children (metadata-only filtering); `lookup:`/`file:` for `<dir>/transformMetadata.js` when the template or the JSON output uses transformed metadata | rendered body HTML (+ hydration script for hydrated MDX) |
| `pageHtml(d)` | `bodyHtml(d)`, `docMeta(d)`, `templates`, `metaBundle(t)` for the selected template, `cssBundle(dir)`, `jsBundle(dir)`, `menuHtml`, `customMenuFor(dir)`, `footer`, `linkResolution(href)` for each internal link in the body, `imageInfo(img)` for each referenced image (or `lookup:` when it does not exist — this is the dead-image-link case), `staticAsset(a)` for each referenced non-image asset, `outputOwner(path)` for its own output path | owns `<path>.html`, and when it is the folder's index by promotion (§8.3) also `<dir>/index.html` |
| `docJson(d)`, `docXml(d)` | `bodyHtml(d)`, `docMeta(d)`, `file:d`, transformed metadata, `ursaMetadata`, `outputOwner` | owns `.json` / `.xml` beside the HTML |
| `htmlPassthrough(h)` | `file:h`, `linkResolution` for each link, `imageInfo` for each image | owns the copied `.html` |

#### Per directory

| Node | Reads | Value / Owns |
|---|---|---|
| `outputOwner(p)` | `lookup:` for every source that could render to output path `p` (§8.2 precedence list) | the winning source path. One node per contested output path. Every output-writing node for a document first gets `outputOwner` for its target and writes nothing if it is not the owner (logging the shadowing). |
| `dirIndexJson(dir)` | `documentSet` (the subtree), `docMeta` of each document in it | owns `<dir>.json` |
| `dirListingHtml(dir)` | `documentSet`, `outputOwner(<dir>.html)`, `templates`, `menuHtml`, `footer` | owns `<dir>.html` **only when no document owns that path** |
| `autoIndexPage(dir)` | `outputOwner(<dir>/index.html)` (it is the owner only when no document or promotion is); `dir:dir`; `docMeta` of children; `cssBundle(dir)`, `jsBundle(dir)`, `templates`, `menuHtml`, `customMenuFor(dir)`, `footer` | owns `<dir>/index.html` when it is the owner |

#### Aggregates

| Node | Reads | Owns |
|---|---|---|
| `searchIndex` | `docMeta(d)` for all documents (title, path) | `public/search-index.json` |
| `fullTextIndex` | `plainText(d)` for all documents, where `plainText(d)` is a projection of `file:d` | `public/fulltext-index.json`. Recomputed incrementally: the engine tells it which inputs changed. |
| `recentActivity` | `sourceTimestamps`, `docMeta` for titles | `public/recent-activity.json` |

### 4.3 The document set and its filters

`documentSet` is the one place that decides what participates: article
extensions (`.md`, `.mdx`, `.txt`, `.yml`), hand-written `.html`, static
assets (`staticAssets.js` lists), images, and directories; minus hidden paths
(dot-prefixed relative to the docroot, `node_modules`, `_templates`), minus
config-hidden folders, minus exclusions, intersected with the whitelist. It
reads directory leaves only, so it is cheap and changes rarely.

Removing a source from the set removes every node keyed by it; the engine
deletes the files those nodes owned (§5.6).

### 4.4 Cache busting

Every reference from one output to another (`<link href>`, `<script src>`,
`<img src>`, CSS `url()`, `fetch()` of a JSON index) carries
`?v=<content hash of the referenced file>`. Not a build timestamp.

Consequences, all intended:

- an unchanged asset keeps its URL, so pages that reference it are not
  rewritten just because a build happened;
- a changed asset changes its URL, so every page that references it is
  rewritten — this is the catchment zone made explicit, and it is exactly the
  set of pages a browser must reload to see the change;
- `generate` becomes deterministic: identical inputs give identical output.

## 5. A pass

### 5.1 Trigger

A batch (§3.3) or the startup scan (§3.5). The pass begins by refreshing every
stale leaf: stat and, if size/mtime moved, re-hash file leaves; re-probe
lookups; re-list directories; run subtree rescans for directory events.

### 5.2 Dirty set

From the leaves whose fingerprints actually changed, walk reverse edges to
collect every transitively dependent node. This set is an *upper bound*: early
cutoff will trim it during execution. It is computed before any work so that
clients can be told immediately whether their page is in it (§6).

### 5.3 Execution order

1. **Pre-pass source mutation.** If any `_templates/**` file changed, run
   document-template reconciliation for the instances of that template, write
   the merged instances to the docroot, and mark their leaves stale
   synchronously so the same pass renders them. This is the only step that
   writes to the docroot.
2. **Viewed pages first.** For each viewed URL, resolve the output path (§6.2)
   and its owning node. Demand those nodes. The engine verifies their inputs
   topologically, so the bundle, the body, the menu HTML and the image info
   they need are computed on the way — and nothing they do not need. As each
   viewed page's owner finishes, its client is notified (§6.4) without waiting
   for the rest of the pass.
3. **Remaining page and asset nodes** in the dirty set, topological order.
4. **Expensive, non-blocking outputs**: `imagePreview`, `fullTextIndex`,
   `searchIndex`, `recentActivity`, `dirIndexJson`. These never gate a reload.
5. **Orphan deletion** (§5.6), **persist** the graph, **final notifications**.

Within a topological level, nodes may run concurrently up to the existing
batch size; writes to distinct output paths do not conflict because ownership
is one-to-one.

### 5.4 Startup is the same pass

A cold start is a pass in which every leaf is new. The ordering above gives
the "serve starts fast" property without a special deferred mode: as soon as a
browser connects and reports a URL, that page is promoted to the front of the
queue; previews and indices run last. A page can be served while its images'
previews do not exist yet; the browser will 404 those previews until step 4
reaches them, which is acceptable in development. `generate` runs the
identical pass and simply waits for step 4 to finish.

### 5.5 Single writer

Exactly one pass runs at a time. Events arriving during a pass are collected
into the next batch. When a pass ends, if the next batch is non-empty it starts
immediately (no debounce; the quiet window already elapsed). Clients that were
told `update-start` keep their indicator until a pass has processed the batch
that concerned them.

### 5.6 Output ownership and garbage collection

Every file under `output/` is owned by exactly one node, and the set of files
a node owns is recorded with the node. When a node is removed (its key left
the document set), or a recompute's owned set shrinks, the files no longer
owned are deleted. Empty output directories are removed. This is what makes
deletions and renames converge (§8.5) and stops `output/` accumulating ghosts.

Ownership is decided by `outputOwner(p)` when several sources could claim the
same path (§8.2). A node that is not the owner writes nothing and owns
nothing; the shadowing is logged once per pass.

### 5.7 Failure

A node whose compute function throws is marked failed, keeps its previous
edges and output, and is retried on the next pass. Failure does not corrupt
the graph or block other nodes. A client whose viewed page's owner failed is
sent `update-failed` with the message (§6.4) rather than left waiting.

### 5.8 Persistence and `--clean`

After each pass, `{edges, fingerprints, leaf stats, ownership}` is written to
`.ursa/graph.json`, stamped with the ursa version and a schema version. On
mismatch the graph is discarded and the start is cold. `--clean` deletes
`.ursa/` and empties `output/` first; it is corruption recovery, never a
routine workaround. `content-hashes.json`, `nav-cache.json`,
`dependency-graph.json` and `image-cache.json` are subsumed by the graph and
go away. `.ursa.json` remains (build id: state, not cache).

## 6. Clients and hot reload

### 6.1 Protocol

Client → server:

| Message | When |
|---|---|
| `{type:'url', url}` | on connect, on `popstate`, on `visibilitychange` to visible, on `pageshow` |

Server → client:

| Message | Sent to | When |
|---|---|---|
| `update-start` | all | first event of a batch (grey indicator) |
| `update-affects-you` | clients whose page's owner, or any node in the page's *hard* runtime closure, is in the dirty set | as soon as the dirty set is known (green indicator) |
| `reload` | those clients | as soon as their page's owner and hard closure have been written |
| `data-updated {what}` | clients whose page's *soft* closure changed | when `menu-data.json`, a custom-menu JSON, the search indices or recent activity are rewritten. The client refetches in place; no reload. |
| `update-no-affect` | everyone else | at end of pass, and to clients whose page turned out unchanged after early cutoff |
| `update-failed {message}` | clients whose page's owner failed | end of pass |

A page's **runtime closure** is the set of outputs the browser loads for it:
the HTML, its CSS and JS bundles, its images (**hard** — a change needs a
reload), and the JSON it fetches after load: menu data, custom menu, search,
recent activity (**soft** — the page can refresh them itself). Reloading every
open tab because a document was added elsewhere is wrong; updating their menus
in place is right.

### 6.2 URL → output → owner

One resolver, shared by the HTTP middleware and the reload logic:

- `/foo/` → `foo/index.html`;
- `/foo.html` → `foo.html`;
- `/foo` (no extension) → `foo.html` if that output exists, else
  `foo/index.html` (file wins; §8.3).

The owner of that output path is the node to prioritise. A URL nothing owns
(404) is simply not affected.

### 6.3 Priority

Viewed URLs are collected at the start of a pass and re-read whenever a client
reports a new URL mid-pass; a page the user navigates to during a long pass is
promoted at the next scheduling point.

### 6.4 Early reload

The reload for a viewed page is sent the moment its owner node and hard
closure are written — typically within tens of milliseconds of the pass
starting — not at the end of the pass. A root `style.css` edit on a 10k-page
site rewrites every page, but the page on screen is fresh before the second
one starts. This is the whole point of prioritisation and the reason the
large catchment zones of §8.1 are tolerable.

## 7. Determinism and the footer

Convergence (§1) is checked by comparing `serve`'s output with a clean
`generate`. The only inputs that are not functions of the source tree are the
footer's build id and timestamp. Rule: the footer's build metadata is computed
once when the process starts (serve) or once per run (generate) and is not
part of any node's fingerprint comparison for the purposes of the acceptance
test in §10. Everything else — cache-bust tokens, bundle names, ordering of
listings and menus — must be pure functions of the inputs. Sort every listing;
never let readdir order leak into output.

## 8. Catchment zones and edge cases

### 8.1 Zones created by bundling and inheritance

Each inherited file has a zone; the table gives the zone and what a change
inside it costs. "Page" means every `pageHtml`, `autoIndexPage`,
`dirListingHtml` and `htmlPassthrough` whose folder is in the zone.

| Input | Zone | Why every page in the zone rewrites |
|---|---|---|
| `X/style.css` (edit, add, or remove) | pages in `X/**` | `cssBundle(dir)` for every `dir` under `X` recomputes; its content hash changes; the `?v=` in every page's `<link>` changes. Adding the file flips `lookup:X/style.css`, which every `cssChain` under `X` recorded. |
| `X/script.js` | pages in `X/**` | same, via `jsBundle` |
| `X/menu.md` (content edit) | **none** — only `custom-menu-<id>.json` rewrites | pages carry the menu's *path* in a `data-` attribute; the content is fetched. Clients in the zone get `data-updated`. |
| `X/menu.md` (add or remove) | pages in `X/**` not under a nearer menu | `customMenuFor` flips for those folders; the `data-custom-menu` attribute changes |
| `X/config.json` | menu (all pages' root-level menu HTML if the root level changed; otherwise `menu-data.json` only); if `hidden` flips, the subtree's outputs are deleted or created | |
| `meta/templates/T/index.html` or any asset it bundles | every page using template `T`, plus generated index pages (they use the default template) | `metaBundle(T)` fingerprint moves |
| `meta/shared/*` | pages using any template whose bundle references it | via `metaAsset` → `metaBundle` |
| `footer.md`, docroot `package.json` | every page | the footer is inlined |
| root-level add/remove/rename of a file or folder | every page | `menuHtml` inlines the root level. Deeper adds touch only `menu-data.json`. |
| any add/remove/rename anywhere | pages whose links resolve differently now | via `linkResolution(href)` nodes, not `validPaths` wholesale |
| an image | pages that reference it | `imageInfo` hash → `?v=` and preview URL change |
| `ursa` itself (version change) | everything | cold start |

The zones are inherent in inlining and content-hashed URLs; the spec does not
try to shrink them. It makes them *exact* (nothing outside the zone is
touched), *prioritised* (the viewed page first), and *cheap per page*. A
future `--stable-asset-urls` mode could trade convergence-with-`generate` for
smaller zones by keeping bundle URLs fixed and relying on no-cache headers in
serve; it is out of scope here.

### 8.2 Several sources for one output path

`index.md` + `index.mdx`; `foo.md` + `foo.txt`; `foo.md` + hand-written
`foo.html`; `index.md` + promoted `foo/foo.md`. All are the same problem: two
sources claim one output path. Today the winner is whichever wrote last —
nondeterministic in `generate` (batch completion order), and in `serve` it
flips to whichever was edited most recently. **No precedence has ever been
specified.** This document specifies one and flags it as a decision (Part
II §C.1).

Precedence for a given output path, highest first:

1. hand-written `.html` in the source tree (it is already the output format;
   ursa must not overwrite a file the author wrote by hand);
2. `.mdx`;
3. `.md`;
4. `.txt`;
5. `.yml`.

For a folder's `index.html` specifically, candidates in order:

1. `index.html` (hand-written);
2. `index.mdx`, `index.md`, `index.txt`, `index.yml`;
3. `_index.*` in the same extension order;
4. `home.*`, then `_home.*`;
5. `<foldername>.*` (folder-named promotion — the file also renders to its
   own path);
6. the generated auto-index.

The same list is used, in the same order, by link resolution (PATH_LOGIC rule
3), by `outputOwner`, by the menu's notion of a folder's index, and by the dev
server's URL resolver. There is exactly one copy of it in the code.

Behaviour: the shadowed source is not rendered, not indexed, not in the menu,
not in directory listings; a warning names both files once per pass. Because
`outputOwner` records lookups for every candidate, adding or deleting any of
them flips ownership reactively: delete `index.md` and `index.mdx` becomes the
page in the same pass with no restart.

Why `.mdx` above `.md`: the migration direction is md → mdx, and during the
overlap the author expects the new file to show. It is the opposite of what
`automenu.js` and `dev.js` currently assume (`.md` first); Part II §C.1 lists
both options.

### 8.3 `foo.md` next to `foo/` (and adding `foo/index.md` later)

Two different outputs, `foo.html` and `foo/index.html`; no collision on
disk. The only contested question is what the extensionless URL `/foo` and
the extensionless link `[x](/foo)` mean.

Rule: **the file wins.** `/foo` → `foo.html` if a document owns it, else
`foo/index.html`. This is what `PATH_LOGIC.md` rule 2 says, what the README's
"Link logic" says, and what the HTTP middleware does. `linkValidator.js`
currently says the opposite (Part II §B.13); it is the one to change.

Adding `foo/index.md` when `foo.md` exists: `dir:foo` changes → `documentSet`
→ `outputOwner(foo/index.html)` moves from the auto-index (or from a promoted
`foo/foo.md`) to the document → `autoIndexPage(foo)` gives up ownership and
its file is overwritten by `pageHtml(foo/index.md)` → `dirIndexJson(foo)`,
`menuData` update (the folder now collapses to a single link if it has no
other children) → `linkResolution('/foo/')` is unchanged (it always pointed
at `foo/index.html`), so no other page rewrites. `foo.md` is untouched.

### 8.4 Dead links that come alive

**Image.** A page references `img/map.png`, which does not exist. `pageHtml`
recorded `lookup:<docroot>/img/map.png = absent` and rendered a plain `<img>`
with no preview and no lightbox anchor. The file appears: the lookup flips,
`imageInfo(map.png)` is computed, `pageHtml` recomputes with the preview URL
and hash, `imageCopy` and `imagePreview` write the files, the client reloads.
The same path handles a *replaced* image: `file:` changes, `imageInfo` hash
changes, `?v=` changes, page rewrites, client reloads with a fresh fetch.

**Document.** A page links to `/rules/grappling`, which does not exist; the
link was marked `inactive`. `linkResolution('/rules/grappling')` recorded
lookups for `rules/grappling.{html,mdx,md,txt,yml}` and
`rules/grappling/index.*` (the §8.2 list). The author creates
`rules/grappling.md`: one lookup flips; only pages containing that href
recompute; the link becomes active. Pages that do not link to it are not
touched — this is the reason `pageHtml` depends on per-href nodes rather than
on the whole `validPaths` map, without which every added document rewrites
every page.

### 8.5 Renames and deletions

A rename is a remove at one path and a create at another; the watcher may
report them in either order or, for a directory, as one event on the
directory. The pass does not care: it stats both paths.

Deleting or renaming away a document `d`:

- `file:d` → `missing`; `dir:` of its folder changes; `documentSet` drops it;
- every node keyed by `d` is removed and the files they owned are deleted:
  `.html`, `.json`, `.xml`, and the promoted `index.*` copies if it was the
  folder's promoted index;
- `outputOwner` for any path it held moves to the next candidate (the
  auto-index takes over a folder whose `index.md` was removed, in the same
  pass);
- `linkResolution` for hrefs that pointed at it becomes `null`; pages linking
  to it rewrite with `inactive` links;
- `menuData`, `dirIndexJson`, `searchIndex`, `fullTextIndex`, `recentActivity`
  update; empty output folders are removed;
- a client viewing the deleted page is sent `reload` and sees whatever now
  owns that URL (the auto-index, or a 404). That is the truth; no special
  case.

Creating (the other half of a rename) is the ordinary new-document case. Recent
Activity dates a document by the last commit that touched its path, so a
renamed document appears as newly changed once the rename is committed (and by
mtime until then); carrying timestamps across renames is not attempted
(Part II §C.9).

Directory rename: the subtree rescan (§3.2) turns it into the individual
removes and creates above.

Case-only rename on a case-insensitive filesystem (`Foo.md` → `foo.md`): the
two paths are distinct leaves but the same output file. Orphan deletion must
run *before* new writes within a pass so `Foo.html` is unlinked before
`foo.html` is written, or the delete would remove the new file.

### 8.6 Inherited files appearing, moving and disappearing

Covered by the lookup chains: `cssChain`, `jsChain`, `customMenuFor`, `hidden`
and `outputOwner` each record a lookup for every path they probe, present or
not. Adding `style.css` to a folder that had none, renaming `style.css` to
`_style.css`, deleting the root `menu.md`, adding `config.json` with
`hidden: true` — all flip recorded lookups and propagate through the zone.
When a rename leaves the *content* of a chain identical (the `_style.css`
case), the bundle's content hash is unchanged and the pages do not rewrite:
early cutoff.

### 8.7 MDX components, `_components/`, `transformMetadata.js`

`bodyHtml` of an MDX document records `file:` for every module esbuild
resolved. Editing a `.tsx` re-renders exactly the documents that import it,
directly or transitively. Creating a `_components/` folder flips lookups
recorded by every MDX file beneath it.

`transformMetadata.js` is loaded with dynamic `import()`, which Node caches
for the life of the process. The loader must append `?v=<content hash>` to
the specifier so an edit takes effect.

### 8.8 Document templates (`_templates/`)

A template edit is a pre-pass source mutation (§5.3 step 1). Reconciliation
finds instances by frontmatter `template-source`; the set of instances per
template is a node (`templateInstances(t)`, reading `docMeta` of every
document) so the pre-pass does not read every file on every template save.
Conflict markers written into an instance are an ordinary document change.

### 8.9 Metadata-only index files

An `index.md` that is only frontmatter is not a page; it supplies the folder's
label and the auto-index is still generated. `docMeta.isMetadataOnly` is an
input to `outputOwner(<dir>/index.html)`, so turning a metadata-only index
into a real one (or back) flips ownership in place.

### 8.10 Whitelist and exclude

The whitelist and exclude files are leaves of `documentSet`. Editing them adds
or removes documents exactly like creating or deleting the files. A document
outside the whitelist is not rendered even if it is edited (today's single-file
path ignores the whitelist: Part II §B.20).

### 8.11 Concurrency with the editor

Atomic saves, truncation, partial writes: the pass reads content at pass time,
not at event time, after the debounce window; a read that catches a half-written
file produces a wrong-but-temporary output and a fresh event that fixes it on
the next pass. A hash that equals the previous one (the editor wrote the same
bytes) is a no-op.

### 8.12 Ursa upgraded while serving

`ursa:version` is a leaf. A running process cannot see its own code change,
but on the next start the graph stamp mismatches and the start is cold. (For
ursa developers, `nodemon` restarts the process; the same rule applies.)

## 9. Observability

Every pass logs: the trigger (which leaves changed, by kind), the dirty set
size by node kind, the viewed URLs and which were promoted, per-phase timing,
the number of files written and deleted, and failures with the node id. A
`--explain` flag prints, for each recomputed node, the input whose fingerprint
moved. "Why did 800 pages rewrite?" must be answerable from the log.

## 10. Acceptance

Each scenario is run against a warm start (second `serve` against an existing
`.ursa/`) as well as a cold one; each must pass without `--clean` and end with
`output/` byte-identical to `generate --clean` modulo §7.

1. Edit an article body → only its `.html/.json/.xml`, the full-text index
   entry and recent activity change. Menu, other pages: untouched.
2. Edit `menu-label` in a non-index article's frontmatter → `menu-data.json`
   (and the root-level menu HTML in every page only if the article is at the
   root) update.
3. Edit, create, and delete `style.css` at the root, in a subfolder, and in a
   folder that previously had none → exactly the subtree's pages and bundles
   change; the viewed page reloads before the others are processed.
4. Touch `style.css` without changing bytes → nothing written; clients get
   `update-no-affect`.
5. Replace a font in `meta/shared` → the meta bundle and every page using a
   template that bundles it.
6. Edit a template's `index.html` → pages using it, plus generated index pages.
7. Add `index.mdx` beside `index.md` → warning; page unchanged (or changed,
   per the §8.2 decision); delete `index.md` → the other becomes the page in
   the same pass.
8. Add `foo/index.md` beside `foo.md` → `foo/index.html` is the document,
   `foo.html` untouched, `/foo` still resolves to `foo.html`.
9. Rename `a.md` → `b.md`; rename folder `x/` → `y/` → old outputs gone, new
   present, links updated, menu updated, no ghosts.
10. Delete the only `index.md` of a folder → the auto-index takes over the
    URL; a client viewing it reloads to the auto-index.
11. Reference a missing image, then add it → the page gains its preview and
    lightbox without being edited; replace the image → page rewrites with a
    new `?v=`.
12. Link to a missing document, then create it → only pages containing that
    link rewrite; the link goes active.
13. Edit a `.tsx` imported by three MDX files → exactly those three re-render.
14. Save a document 20 times in 3 s → at most two passes; final output correct.
15. Save file B while a large pass from file A is running → B is processed
    next; nothing lost.
16. A failing MDX file → its previous output remains, the client is told
    `update-failed`, other nodes unaffected, retried next pass.
17. Change ursa's version → cold start, everything rebuilt.
18. Stop `serve`, delete/rename/add files, start `serve` → the startup pass
    converges without `--clean`.

---

# Part II — Ursa as written (v0.92.0)

Read against the spec above. Line numbers are as of commit `1ed807a`.

## A. How it works today, in one paragraph

`serve` (`src/serve.js`) runs the full `generate()` once, then watches the
docroot and meta with extension allow-lists. Events are debounced 500 ms and
sorted into buckets by filename pattern (`processChangeBatch`, lines
453–470). CSS/JS changes are copied and looked up in a `DependencyTracker`
that knows each document's template, inherited CSS and JS (nothing else);
meta changes re-bundle templates and look up affected documents by template
name or, for meta CSS/JS, "all documents"; menu/config/unknown/`.yaml`/MDX
component changes force a **full cold rebuild** (the hash and nav caches are
deleted first, line 606). Selective regeneration goes through
`regenerateSingleFile` (`src/jobs/generate.js:1473`), a second copy of the
render pipeline that differs from the first in a dozen ways. Client priority
and early reload exist and work for the selective path. A fingerprinted graph
engine (`src/helper/build/graph.js`) is implemented and tested but nothing
uses it.

## B. Gaps and incorrect behaviour

Ordered roughly by how often a user hits them. "Spec §" points at the rule
being violated.

### Watching (spec §3)

1. **Extension allow-lists on both watchers** (`serve.js:733`, `744`). Files
   ursa itself copies are unwatched: `.otf`, `.m4a`, `.wav`, `.flac`, `.m4v`,
   `.ogv`, `.zip` are in `MEDIA_EXTENSIONS` but not in either regex. A
   changed font or archive is served stale until restart. Spec §3.1.
2. **Directories produce no events.** The regexes require an extension, so a
   folder create/remove/rename is invisible; and macOS reports a renamed
   folder as one event on the folder anyway. Renaming `x/` to `y/` leaves
   `output/x/` in place and never renders `output/y/`. Spec §3.2.
3. **No debounce upper bound** (`serve.js:429–434`). Every event resets the
   timer; a process writing continuously postpones regeneration forever.
   Spec §3.3.
4. **The initial build is not behind the single-writer lock.** `generate()`
   at `serve.js:379` runs while the watchers are already live; `isRegenerating`
   is only set inside `processChangeBatch`. A meta change during startup
   starts a second full `generate()` concurrently, racing on `output/` and on
   `.ursa/`. Spec §3.5, §5.5.
5. **Heuristic bucketing** (`serve.js:461–470`): `c.name.includes('menu.')`
   matches `docs/menus/submenu.md` and `docs/menu.png` (full rebuild);
   `'_config'` never matches `config.json` (it lands in
   `otherSourceChanges`, which also full-rebuilds — right answer by accident);
   `.yaml` is watched but not an article (`serve.js:465`, `generate.js:238`),
   so a `.yaml` save triggers a full cold rebuild of a file that is never
   rendered. Spec §1 ("no filename heuristics").

### Invalidation (spec §4)

6. **Static assets referenced by documents are not tracked.** `serve.js`
   never consults the tracker for a static-file event at all — step 1
   (`483–494`) only copies or unlinks the file — and it could not: the
   tracker is told only template/css/js per document (`generate.js:866`,
   `1653`), so `getInvalidationPlan` branch 4 (`dependencyTracker.js:198–206`)
   has no edges to find. The outcome is a blind reload of every client
   (`serve.js:706`). The page keeps its old `?v=` on the image (so a cached
   image can survive the reload), and the dead-image-link case (§8.4) never
   resolves: the page is not re-rendered, so it never gains the preview or
   the lightbox anchor until the document is edited. `TODO.md` marks this
   rule `[x]`; it is not implemented.
7. **Adding, deleting or renaming a document does not update anything but
   that document.** Article events go straight to `regenerateSingleFile`; the
   menu (`watchModeCache.menu`), `validPaths`, `menu-data.json`, the parent's
   `<dir>.json`, the parent's auto-index page, the search and full-text
   indices are all stale until a full rebuild happens for some other reason.
   The CHANGELOG's "Create a power, that power page now exists. But
   `powers.json` doesn't have it" is this. Spec §4.2 (`documentSet`), §8.5.
8. **Deleting a document leaves a ghost.** A `remove` event on `.md` is
   bucketed as an article change; `regenerateSingleFile` fails on
   `readFile` (`generate.js:1502`); the `.html/.json/.xml` stay in `output/`
   and keep being served. Nothing ever deletes outputs — not `generate`, not
   `serve` — except `--clean`. Spec §5.6.
9. **The menu ignores `menu-label` edits in non-index files — in `generate`
   too.** `automenu.js` reads every file's frontmatter for `menu-label` and
   `menu-sort-as`, but `hashFileStats` (`navCache.js:29–44`) only stats index
   files, `config.json`, menu files and icons. The nav cache stays "valid"
   and the menu HTML is served from cache. Spec §4.2 (`menuData` reads
   `docMeta` of every document).
10. **Meta and template changes miss generated pages.** Auto-index pages,
    `<dir>.html` listings and hand-written HTML copies are never registered in
    the tracker, so a template or meta CSS edit regenerates every *document*
    but leaves those pages with the old template markup and old bundle
    `?v=`. Spec §4.2 (`autoIndexPage`, `dirListingHtml`).
11. **Full rebuilds are cold rebuilds.** Because the hash skip only sees the
    article's own bytes (root cause #2 in `serve-logic.md`, still open),
    every full-rebuild path deletes `content-hashes.json` and
    `nav-cache.json` (`serve.js:606–607`). Correct, but a `config.json` edit
    or a `.tsx` save now costs a complete re-render of the site. Spec §1
    (minimality), §4.
12. **MDX component edits are full cold rebuilds.** `.tsx/.jsx/.ts` are watched
    (`serve.js:744`) but fall into `otherSourceChanges` → full rebuild
    (previous item). `dev.js` does better (clears MDX caches). Spec §8.7.
13. **Link resolution contradicts the server.** `buildValidPaths` processes
    directories after files (`linkValidator.js:64–89` overwrites line 36), so
    with `foo.md` and `foo/` both present, `/foo` in a link resolves to
    `/foo/index.html`, while the HTTP middleware (`serve.js:801–805`), express
    static, `PATH_LOGIC.md` rule 2 and the README all resolve `/foo` to
    `foo.html`. Links and address-bar navigation disagree. Spec §8.3.
14. **Every page depends on the whole `validPaths` map.** With a graph, that
    would make every add/remove rewrite every page; today it is masked because
    adds do not invalidate anything (item 7). Spec §4.2 (`linkResolution`).
15. **`transformMetadata.js` edits never take effect.** Loaded by
    `import()` with no cache-buster (`build/metadata.js:15`); not a tracked
    dependency; not even bucketed usefully by the watcher. Spec §8.7.
16. **Subtree fallback lacks a separator** (`dependencyTracker.js:181`):
    `doc.startsWith('/docs/foo')` also matches `/docs/foobar/…`.
    Over-regeneration only.
17. **`getInvalidationPlan` never sees creations of inherited files except by
    the fallback.** It works today only because `documentToFiles` happens to
    hold every document; the graph's lookup leaves are the real fix. Spec
    §8.6.

### Regeneration (spec §5)

18. **Two render pipelines, and they differ.** `regenerateSingleFile`
    (`generate.js:1473–1785`) versus the article loop (`575–989`):
    - separate `<link>`/`<script>` tags per level (`1611`, `1640`) versus one
      bundle per folder (`812`, `843`) — root cause #6, still open; the same
      page's markup flips depending on which path last wrote it;
    - template placeholders are substituted with `String.replace(string,
      string)` (`generate.js:1680–1682`; also the listing page at
      `generate.js:1160–1162` and `autoIndex.js:421–423`), which interprets
      `$&`, `` $` ``, `$'` and `$$` in the *document body*; the full build's
      article loop uses a function replacer (`903`) and is safe. A body
      containing `$&` renders differently in serve than in generate;
    - no `existingHtmlFiles` guard: editing `foo.md` in serve overwrites a
      hand-written `foo.html` that generate deliberately preserves
      (`648–652`); the next full build flips it back;
    - no metadata-only check: editing a frontmatter-only `index.md` in serve
      writes a near-empty page over the auto-index that generate produces
      (`656–660`);
    - the folder-named promotion (`1739–1750`) checks only `index.*`, while
      `generateAutoIndices` prefers `_index.html`, `home.html`, `_home.html`
      before `<folder>.html` (`autoIndex.js:212`, `292`): with `home.md` and
      `foo/foo.md` both present, `index.html` is whichever ran last;
    - the whitelist is not applied (§8.10);
    - `useWorker: false`, eager `getTransformedMetadata`, `_deferImages`
      differences.
    Spec §1 (convergence): one render function, used by both.
19. **The `--whitelist` filter is not applied in serve's selective path**
    (no reference to `_whitelist` in `regenerateSingleFile`). Spec §8.10.
20. **No output garbage collection** — see item 8; also stale per-folder
    bundles after a chain changes, stale copied `style.css` after deletion,
    and static-file removal (`serve.js:486–490`) unlinks the original but not
    its `.preview.webp`. Spec §5.6.
21. **Regeneration is serial** (`generate.js:1414`, `1440`): one document at a
    time, no batching, so a root `style.css` on a large site is slow in the
    background. Not a correctness issue; the spec's topological batching
    fixes it for free.
22. **Cache-busting is a build timestamp** (`cacheBust.js:7`,
    `generate.js:1397`), so every selective pass rewrites every affected
    page's asset URLs even when the assets did not change, and `serve` output
    can never be byte-identical to `generate`. Spec §4.4, §7.
23. **The graph engine is not wired in.** `graph.js` is complete for file and
    lookup leaves but has no directory-listing leaf, no output ownership, and
    no orphan deletion (spec §4.1, §5.6). Two persisted artifacts with
    overlapping purpose (`dependency-graph.json` in use, `graph.json` unused).

### Clients (spec §6)

24. **Failed priority pages leave the client hanging.** If a viewed page's
    regeneration fails, `onPriorityComplete` logs and does not reload
    (`serve.js:667–669`); the "safety net" block at `681–695` is empty; and the
    final `update-no-affect` sweep (`698–702`) skips clients whose URL is in
    `affectedUrlSet`. The green indicator stays on forever. Spec §5.7, §6.1.
25. **Menu-data changes are not communicated at all** (they never happen
    selectively, item 7), and when a full rebuild fixes them every client is
    reloaded. Spec §6.1 (`data-updated`).
26. **URL matching and the reload script disagree with the server about
    dots.** `docPathToUrls` (`serve.js:82–96`) knows the folder-named
    promotion but not `_index`, `home`, `_home`, so a client viewing a folder
    whose `index.html` was promoted from `home.md` is never matched (and, per
    item 18, that `index.html` is not even rewritten). Separately, the
    middleware's HTML test (`785–788`) treats any URL containing a `.` as a
    non-page, so a document with a dot in its name (`v1.0.md`) visited
    extensionless as `/v1.0` is served by `express.static` **without the hot
    reload script**. Spec §6.2 (one shared resolver).
27. **`dev` is a third implementation** (`src/dev.js`) with its own watcher,
    caches and reload protocol, and its own index precedence (`.md` first,
    no `home`). Not covered by the spec; see §C.7.

## C. Contradictions and gaps in the requirements themselves

These are decisions nobody has made, or places where two authoritative
documents disagree. The spec above picks an answer for each and says so; the
answers are proposals.

1. **Same-basename, different-extension sources (`index.md` + `index.mdx`,
   `foo.md` + `foo.txt`, `foo.md` + `foo.html`).** Never specified. Code today:
   last writer wins, which in `generate` is usually the `.mdx` (it renders
   slower and completes later) and in `serve` is whichever was saved last;
   the menu reads `index.md` first; `dev` resolves `.md` first. Options:
   (a) `.mdx > .md > .txt > .yml` (spec's choice: migration direction);
   (b) `.md > .mdx …` (matches `automenu.js` and `dev.js` today);
   (c) treat it as an error and render neither. Whichever is chosen must be
   one list used by link resolution, output ownership, menu, and dev.
2. **Folder index precedence.** Five different lists exist: `PATH_LOGIC.md`
   (index, home, `<folder>`, `_index`, `_home`); `autoIndex.js:212+292`
   (`_index`, home, `_home`, `<folder>`); `regenerateSingleFile` (index
   only); `automenu.js` (index only, plus folder-named); `customMenu.js`
   (index, home); `dev.js` (index, folder-named). The README's "Link logic"
   section gives a sixth (index, `_index`, home, `_home`, folder-named, with
   `.md/.txt/.yml` but no `.mdx`). Pick one (spec §8.2 proposes: hand-written
   `index.html`, `index.*`, `_index.*`, `home.*`, `_home.*`, `<folder>.*`,
   auto-index).
3. **`/foo` when both `foo.md` and `foo/` exist.** `PATH_LOGIC.md` and the
   README say the file; `linkValidator.js` says the folder. Spec §8.3 sides
   with the documents.
4. **Hand-written `.html` versus a rendered document of the same name.**
   `generate` preserves the hand-written file with a warning; `serve`
   overwrites it. Spec §8.2 says hand-written wins everywhere.
5. **`.yaml`.** Watched by serve, accepted by the dependency tracker and
   `docPathToUrl`, but not an article in `generate`. Either support it or stop
   watching it. Spec assumes `.yml` only.
6. **What "affects your page" means.** The 0.76 requirements say reload when
   "document, static asset, template, anything" affecting the current URL
   changes; the custom-menu design fetches menu content at runtime, so a
   `menu.md` content edit changes no HTML. Spec §6.1 splits hard (reload) from
   soft (`data-updated`) closures; this needs client-side support in
   `menu.js`/`widgets.js` to refetch in place.
7. **`dev` mode.** `TODO.md` specifies it in detail and it shipped, but it is a
   separate implementation of everything this spec covers. Either it becomes
   `serve` with demand-driven rendering (the graph's `demand()` gives this for
   free: render a page when first requested, everything else lazily) or it is
   deprecated. Unresolved.
8. **Byte-identical serve and generate (serve-logic.md acceptance #8) versus
   the footer's build id and timestamp.** As written, #8 is unachievable:
   every `generate` increments the build id and stamps the time into every
   page. Spec §7 carves the footer's build metadata out of the comparison and
   computes it once per session; an alternative is to move build metadata out
   of the HTML into a small JSON the footer script fetches.
9. **Recent Activity across renames.** Content timestamps are keyed by path;
   a rename reads as a brand-new document. Unspecified. Spec §8.5 accepts it.
10. **Deleting outputs.** No document says whether `output/` should lose the
    files of deleted, hidden or excluded sources (today it never does without
    `--clean`). Spec §5.6 says yes, always. This changes `generate`'s
    behaviour for users who rely on `output/` accumulating.
11. **Hidden-folder semantics.** `config.json { hidden: true }` now means
    ignored: no HTML, no static assets copied, absent from the menu, from
    auto-indices and from the search index, and 404 from `serve`. What remains
    is that a folder hidden *after* its files were generated keeps the files
    already sitting in `output/` — nothing links to them any more, but they are
    not deleted without `--clean`. Follows from item 10.
12. **Debounce.** `serve-logic.md` says "keep 500 ms"; nothing specifies an
    upper bound. Spec §3.3 adds 2000 ms.
13. **Whitelist/exclude in serve.** Nothing says whether editing the whitelist
    file is live, or whether a non-whitelisted document saved during serve
    should render. Spec §8.10: live, and no.
14. **Previews at startup.** The 0.62 requirement "serve will wait to generate
    images until HTML files are generated" conflicts with "a page depends on
    its images' preview URLs" once pages are graph nodes. Spec §4.2 splits
    `imageInfo` (cheap, a page input) from `imagePreview` (expensive, not a
    page input).
15. **Stale roadmap.** `TODO.md` marks the static-asset invalidation rule done
    (item B.6) and lists "Incremental nav updates: patch nav tree instead of
    full rebuild" as done; neither is. Verify against behaviour, not the
    checkbox.
