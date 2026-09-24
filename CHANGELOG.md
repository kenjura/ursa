# 0.100.0
2026-09-23

Injected menus accumulate down the tree instead of the deepest one winning.

In 0.99.0 a subfolder's `inject-menu` replaced its ancestors' unless it opted in with `{"inherit": true}`, so a site-wide top menu vanished from any section that injected its own. Stacking is the more common want, so it is now the default.

- **Least specific first.** At each position (`top`, `bottom`) the menus from every folder on the way down are injected in order, the docroot's first and the document's own folder's last. The same id at the same position still appears once, in its first place.
- **`"replace-ancestor-menus": true`** on an entry drops every menu the ancestor folders inject at that entry's position and puts this one in their place. The other position is untouched, and deeper folders add to the replacement as usual. A value other than `true`/`false` is warned about and treated as `false`.
- **`{"inherit": true}` is now a no-op**, accepted silently so 0.99.0 configs keep their meaning. A 0.99.0 config that relied on replace-by-default needs `replace-ancestor-menus` on its entries.

**Named menus mark the section you are in.** With a site-level menu stacked above a section's own, the page you are on is marked in the section menu but the site-level menu showed nothing. An item whose folder contains the current page — `Ancestry` → `/character/ancestry/index.html` while on `/character/ancestry/dragon.html` — now gets `ursa-menu-path`. The default stylesheet gives it a faint tint and a half-strength underline (a half-strength left rule in vertical menus), at normal weight, so it reads as "you are in here" rather than "you are here". The docroot's item is never marked, since every page is under it, and an item that is current or active is not also marked as on the path.

# 0.99.0
2026-09-21

`inject-menu` in config.json puts a named menu on every document in a folder.

0.98.0's named menus had to be anchored by hand in every page that wanted one — ten class pages, each carrying its own `{menu:classes}`. Now the folder can do it once.

- **`"inject-menu": {"id": "classes", "position": "top"}`** in a folder's `config.json` renders that menu into every document in the folder and its subfolders, at the top (above the page title, like a first-line anchor) or the bottom. The value can be one object or an array of them. The `id` resolves from each document's folder exactly as an anchor does; a menu that cannot be resolved becomes the same comment-plus-warning.
- **Deeper configs replace, or inherit.** A subfolder's own `inject-menu` replaces the injection for its subtree, unless one of its entries is `{"inherit": true}`, in which case the ancestors' menus come first and the subfolder's are added after them. A folder without the key is transparent. The same id at the same position is injected once.
- **Anchors still win.** A document that anchors an id itself is not also given it by injection, so a page can place the folder's menu somewhere particular.
- **Graph-native.** `injectMenusFor:<dir>` reads the chain of `config.json` files as recorded inputs, so adding, editing or removing one re-renders exactly the documents beneath it and nothing else. Injection happens only for documents; generated index and listing pages are not touched.

**Named menus keep their prose.** The menu parser reads list-item links and nothing else, which is all a fixed nav can show — so a label such as "Feat Categories:" written above the list in `menu-feats.md` silently vanished. A named menu's body is now split into its item lists and the text between them; the text is rendered as Markdown inside the `<nav>` in document order (`.ursa-menu-text`), and in a horizontal menu it sits in the same row as the strip, so a label reads as a label. Relative links and images in that text are rebased to the menu file's folder, since the menu is inlined into pages elsewhere. `auto-generate-menu` menus are unchanged: their body is a template around `{menu}`.

# 0.98.0
2026-09-20

Named menus: `menu-<name>.md` files rendered inline where a document anchors them.

A folder's `menu.md` replaces the site navigation for its subtree. That is one menu per folder, always in the chrome. Sites also want small menus that belong to the content — a strip of sibling pages at the top of each class page, say — and those have been written by hand into every page, and kept in sync by hand.

- **Any `menu*.md` is a menu file.** `menu.md` (and `_menu.md`, `.txt` variants) is the folder menu as before; `menu-classes.md`, `menu-2.md` and so on are additional menus in the same folder, and the same file format.
- **An `id` makes a menu named.** A menu file whose frontmatter has `id: classes` renders nowhere on its own. A document in that folder or below it places it with `{menu:classes}` on a line of its own, and the menu appears there as a static `<nav class="ursa-menu">` inside the article — not a fixed element. `menu.md` with an `id` is a named menu too, and stops being the folder's nav. The `id` is required for `menu-<name>.md`; a file without one is warned about and renders nowhere.
- **`appearance: horizontal | vertical`**, default horizontal: a strip of items with hover dropdowns for nested items, or a stacked, indented list. Both mark the current page's item (`ursa-menu-current`) and its ancestors (`ursa-menu-active`). Styles live in the default template's stylesheet, scoped like the breadcrumbs so a site's `a { … }` cannot break them and a site's more specific selector can restyle them.
- **Resolution is by nearest id.** The walk goes up from the document's folder to the docroot; the first menu file with a matching `id` wins, so a deeper folder can shadow one defined above it. `auto-generate-menu` and `menu-depth` work as in `menu.md`.
- **Anchors fail quietly.** `{menu:x}` is inert Markdown — braces mean nothing to the renderer — and it is substituted after rendering, so an anchor never changes how the Markdown around it parses. If no menu answers, or the menu file cannot be parsed, the anchor becomes `<!-- ursa: menu "x" not found -->` and the build warns, naming the document; the page renders normally. Anchors inside code spans and code blocks stay as written. In `.mdx`, where `{…}` is an expression, an anchor alone on a line is rewritten before compilation and never reaches the compiler.
- **A menu above the first heading stays above the title.** The default `<h1>` is injected after any leading menus rather than before them, and the default template's `sectionify.js` keeps leading menus with the breadcrumbs, outside the sections.
- **Menus are build-graph nodes.** Editing `menu-classes.md` rewrites exactly the pages that anchor it (their `.html`, `.json` and `.xml`), nothing else; creating a missing menu file fills the anchors in the next pass without the pages being edited; deleting it puts the comments back. A page that anchors a menu depends on a projection of each candidate menu file's identity, not its body, so adding an unrelated file to the folder does not re-render it.
- **Menu files are not documents.** They are not rendered to pages, listed in the automenu, an auto-index or a `<dir>.html` listing, indexed for search, or dated in recent activity. This applies to `menu.md` too, which used to be rendered to `menu.html`. The upgrade discards the build cache, so that stale page is not known to the new graph and is not deleted; one `--clean` removes it.

The README gains a "Menus" section documenting both kinds.

# 0.97.0
2026-09-20

`ursa serve` catches every change; `generate` and `serve` are one build.

`serve` had a history of missed updates — a font replaced in `meta/shared`, a folder renamed, a document deleted, an image added where a page had a dead link, a `.tsx` edited, `menu-label` changed in a non-index file — each one a case that some filename heuristic in the watcher or some cache-clear call site had not been told about, and each one fixed by restarting with `--clean`. `docs/SERVE.md` (written 2026-09-03) specifies what `serve` promises instead and lists twenty-seven ways the old implementation fell short of it. This release implements that specification.

**One rule replaces all of the heuristics: every output is a node in a build graph, and a node recomputes if and only if one of its recorded inputs changed.** The engine that shipped unused in 0.87 (`src/helper/build/graph.js`) is now the build. Every file a node reads, every path it probes and every directory it lists while computing is recorded as an edge — including reads made deep inside the menu walker, the label resolver and the breadcrumb builder, which now import their `fs` calls from a traced shim rather than being rewritten to thread a context through. Nothing decides what to rebuild by looking at a filename.

- **`generate` runs the same pass.** A cold start is a pass in which every leaf is new; a warm start re-checks the persisted graph (`.ursa/graph.json`, replacing `content-hashes.json`, `nav-cache.json`, `dependency-graph.json`, `image-cache.json` and `fulltext-index.json`) and recomputes what its inputs say has changed. The output of `serve` after any sequence of edits is byte-identical to a clean `generate` of the same tree, modulo the footer's build id and timestamp — the acceptance test in `src/helper/build/__test__/pass.test.js` asserts it for every scenario in the spec's §10.
- **Minimality.** Editing an article body rewrites its `.html`/`.json`/`.xml`, the full-text index and recent activity, and nothing else. Editing `menu-label` rewrites `menu-data.json` and the listings that show the label. Saving a file without changing its bytes writes nothing. Editing a `.tsx` re-renders exactly the MDX documents that import it. `--explain` (new on both commands) prints, for every output rebuilt, the input that changed.
- **Catchment zones are exact.** Adding, editing or removing a `style.css` rewrites exactly the pages in its subtree, plus the bundle; renaming it to `_style.css` with the same content rewrites nothing. A template edit rewrites the pages using it, including generated index and listing pages, which the old tracker never registered. A shared font rewrites the meta bundle and every page whose template bundles it. A root-level add or rename rewrites every page (the root menu is inlined); a deeper one rewrites only the menu data.
- **Nothing is left behind.** Every output file is owned by exactly one node, and ownership is persisted. Deleting or renaming a document deletes its `.html`/`.json`/`.xml`; renaming a folder deletes the old subtree, its listing and its bundles; hiding a folder with `config.json` deletes its outputs. This applies to `generate` too: `output/` no longer accumulates ghosts, and `--clean` is corruption recovery rather than a routine step.
- **Several sources for one output.** `index.mdx` beside `index.md`, `foo.md` beside a hand-written `foo.html`, `home.md` beside `foo/foo.md` — the winner used to be whichever wrote last. One precedence list (`src/helper/build/precedence.js`, documented in the README's "Link logic") now decides it everywhere: hand-written `.html`, then `.mdx`, `.md`, `.txt`, `.yml`; for a folder's index, `index.*`, `_index.*`, `home.*`, `_home.*`, `<foldername>.*`, then the auto-index. The shadowed source is not rendered, indexed or listed, and a warning names both files; removing the winner promotes the next candidate in the same pass, so deleting the only `index.md` of a folder hands its URL to the auto-index without a restart. `/foo` with both `foo.md` and `foo/` present resolves to `foo.html` in links as it always did in the server; the link validator had said the opposite.
- **Dead links come alive.** A page records the images it references whether or not they exist, so adding the missing image gives the page its preview and lightbox without the page being edited, and replacing an image changes the page's `?v=` token. A page depends on one resolution node per link target, not on the whole path map, so creating a document that other pages link to rewrites only those pages.
- **Cache-busting is by content hash**, not build timestamp: `?v=<hash of the file>` on bundles, images, scripts and CSS `url()` targets. An unchanged asset keeps its URL, so pages are not rewritten for it; a changed one changes its URL, which is exactly the set of pages a browser must reload. The meta bundle's `fetch('/public/x.json')` calls carry the page's build id (`data-build` on `<body>`) at request time instead of the JSON's hash — hashing the menu data into the bundle would have rewritten every page whenever the menu changed.
- **Watching, batching, single writer.** Both trees are watched recursively without an extension allow-list (`.otf`, `.wav`, `.zip` and files with no extension were invisible before); only `.ursa/`, the output directory, `node_modules`, `.git` and editor scratch files are excluded. Directory events rescan their subtree, since macOS reports a renamed folder as one event. Events are batched with a 500 ms quiet window and a 2 s upper bound, so a process writing continuously cannot postpone regeneration forever. Exactly one pass runs at a time — the startup build included, which used to race a meta edit — and events that arrive during a pass form the next batch.
- **Viewer first, early reload.** The pages connected browsers are looking at are built before anything else, and each browser is told to reload the moment its page is written — before the rest of the affected set is processed. "Changed" means the bytes the browser would fetch changed, so a tab on a page whose owner moved (the auto-index taking over a deleted `index.md`) or that was deleted reloads to the truth, and a tab parked on a 404 loads the page when it appears. A page whose owner failed is told `update-failed` instead of being left with the indicator on. When only the menu data, the search indices or recent activity changed, open tabs get `data-updated` and refetch in place — the default template's `menu.js`, `search.js` and `widgets.js` listen for it — rather than reloading.
- **The `$&` bug.** The single-file regenerator substituted template placeholders with `String.replace(string, string)`, which interprets `$&`, `` $` `` and `$'` in the document body; the full build did not. There is one render path now, and it uses a function replacer.
- **Determinism.** Every listing, index and menu is sorted; readdir order never reaches the output. The footer's build id, timestamp and git hash are computed once per session and are not an input of anything, so a `generate` run after an unrelated edit does not rewrite every page to stamp them.
- **`transformMetadata.js` edits take effect** (the dynamic import carries the file's content hash), a hand-written `.html` is never overwritten by `serve`, a frontmatter-only `index.md` never displaces the auto-index in `serve`, the whitelist and exclude files are live inputs (editing them adds and removes documents), and `.yaml` is no longer watched as if it were an article.

Smaller changes that fall out of the one render path: the `<dir>.html` listing pages emit root-absolute links (they were relative to the wrong directory below one level) and fill `${customScript}` instead of leaving the placeholder in the page; the auto-index no longer lists a folder's listing page as a document beside the folder itself; search-index and recent-activity entries are ordered deterministically; copies of `style.css` are no longer placed in the output beside the bundles. `dev` reads the shared precedence list but is otherwise unchanged; its future is still an open question in `docs/SERVE.md`. The `directory-tree` dependency is gone.

Upgrading: the first build discards the old caches and rebuilds everything. Files the previous version left in `output/` that this version does not produce (the `style.css` copies) are not known to the graph and are not deleted; one `--clean` removes them.

# 0.96.0
2026-09-16

MDX pages hydrate their components, not the page; Recent Activity is dated from git.

`hydrate: true` on an `.mdx` page broke the page's layout, and the break got worse the more headings the page had: sticky H1s piled on top of one another, breadcrumbs vanished, and the table of contents listed the title twice. The hydration script handed React the whole of `#main-content` and the whole MDX component and expected them to match. They never did. The template puts breadcrumbs and (sometimes) a title heading inside that container, and the default template's `sectionify.js` rewrites it on `DOMContentLoaded`, wrapping each H1 section in `<section class="sectionOuter">` — and the hydration script, being the last script in the body, always ran after it. React reported the mismatch (error #418), discarded the server-rendered DOM and rendered the component from scratch, with none of the template's structure.

- **Each component imported into the `.mdx` is now an island.** An esbuild plugin wraps the default export of every `.jsx`/`.tsx` the entry imports (and `.js`/`.ts` under `_components/`), so the build renders it inside `<ursa-island data-island="N">` and the browser hydrates that element as its own React root, against exactly the markup the build produced for it. The Markdown around the islands is never handed to React; `sectionify`, breadcrumbs and the TOC can do what they like to it.
- **Function props keep working.** The client still runs the whole bundled MDX module — into a detached root, purely to execute the tree — so each island receives its real props, `filter={fn}` included, rather than a serialized replay. Island numbering is a per-render counter taken in `useState`'s lazy initializer, so it increments once per mount in tree order on both sides.
- **Components imported by components are not islands.** They render inside their parent's root, as before; nesting would put one root inside another. Named exports and non-function imports pass through untouched.
- **React 19's hoisted `<link rel="preload">` is stripped** from the MDX render. It carried the un-rewritten relative image path, so it fetched nothing useful, and its position ahead of the first `<h1>` is what defeated the "body starts with a heading" check and produced the duplicate title.
- **`react-runtime.js` now exposes `createRoot`** and carries a version marker; `buildReactRuntime` rebuilds an older runtime found in `output/public/` instead of reusing it.
- **`window.ursa.contentChanged(root)` tells the template the article changed.** The template's scripts read the article once, on `DOMContentLoaded`: `sticky.js` collects the headings it marks `.stuck`, `toc-generator.js` builds the table of contents from them. A component that fetches data and renders a list with its own headings after that point was invisible to both — its H2s never rolled up into the stuck H1 and piled on top of each other, and the TOC did not list them. The helper dispatches `ursa:content-changed` on `document` (coalesced per task, so a multi-step render can call it freely) and both scripts re-read the headings on it: sticky state is recomputed, and the TOC is rebuilt in place with existing heading ids preserved. `content-hooks.js` is a new template script, loaded first.

**Recent Activity is dated from git, not from the build.** The feed took each document's time from a `contentTimestamps` map in `.ursa.json` that was set to the build time whenever the document was regenerated. Under `--clean` every document regenerates, so every entry got the same time and the feed showed ten arbitrary pages. The map also grew to one line per document and changed on every build, which in a repo that commits `.ursa.json` meant a diff on every commit.

- **One `git log --name-only` pass over the source directory** at the start of a build gives every document's last-commit time in a single process (0.4s on 1,400 documents). A document with uncommitted changes, an untracked one, or any document when the source is not a git work tree, is dated by file mtime instead.
- **A shallow clone is detected and warned about**, since with one fetched commit every document looks edited in it. The fix is `fetch-depth: 0` on the checkout.
- **`contentTimestamps` is gone from `.ursa.json`**; the next build removes the stale key. `serve`'s single-file regeneration dates the changed document the same way instead of stamping "now".

`hydrate: true` means what it did: emit the client bundle. Without it, islands are rendered at build time and inert. React context does not cross island boundaries, which no MDX page relied on — there is no provider above the components to begin with. Design notes are in `docs/changes/island-hydration.md`, and the README gains an "MDX and Interactive Components" section.

# 0.95.0
2026-09-06

`generate --json-only` builds the data and skips the site.

ursa emits a `.json` beside every document and a `<dir>.json` record list beside every directory, and those files are useful on their own — an application can ingest a docs repo at build time and never serve the HTML. Getting them, though, meant paying for the whole site: rendering every page, resizing every image, bundling the React runtime, and writing a full-text index nobody would query. On the system8 docs that is 2.85s and 88 MB to obtain 8.8 MB of JSON.

- **`--json-only` (`-j`) emits only the data files.** Skipped: HTML, XML, images and their previews, meta/template assets, the React runtime, per-folder CSS/JS bundles, static file copying (fonts, audio, video, PDFs), the search and full-text indices, `menu-data.json`, `recent-activity.json`, and auto-generated index pages. On the system8 docs: **1.12s and 8.8 MB**, down from 2.85s and 88 MB.
- **The JSON is byte-identical to a full build's**, not merely similar — verified across all 1,475 content files of the system8 docs, and asserted in the test suite. Every step the mode skips operates on the assembled *page*: `bodyHtml` in the JSON is the pre-template render, and `transformImageTags`, `markInactiveLinks` and `resolveRelativeUrls` only ever rewrote the finished HTML. So there is nothing for image processing or template bundling to contribute to it.
- **The directory record lists are kept.** They are the one thing a data consumer most wants — `character/powers.json` is the list of every power with its frontmatter — so only the directory's *listing page* is skipped, never its `.json`.

Mixing modes against one source tree is safe. The `.ursa` hash cache lives in the source and is shared, so the per-document output check now asks only for the outputs the current mode emits: a JSON-only run after a full build skips work (the `.json` is present and identical either way), and a full build after a JSON-only run regenerates, because its `.html` and `.xml` are missing. That check already existed for a related reason — one hash cache serving several output directories — and it extends to modes for free.

Two pieces of build state are deliberately not written by a JSON-only run. The dependency graph is skipped because registration lives inside the page assembly the mode skips, so saving would replace a full build's graph with an empty one. The watch-mode cache is skipped because it would be seeded with unbundled templates and an empty image map, which would make a later single-file regeneration emit an unstyled page.

# 0.94.0
2026-09-04

`config.json { hidden: true }` now actually ignores a folder.

It was documented as "hide from menu and don't generate files", and it did neither reliably. `generate` filtered articles and directories, but every other category was derived from an unfiltered list, so a hidden folder still had its images, fonts, audio and video copied into the output and its hand-written HTML carried across. Auto-index listings never consulted the setting at all, so a hidden folder was listed — with working-looking links — in its parent's index. `serve` rendered its pages on request, which is the worst version of the bug: the page works all through development and 404s in production, exactly the failure the setting exists to prevent.

- **One filter, applied once.** `generate` now drops hidden paths from the whole source file list, ahead of classification, instead of re-checking in each category. Articles, directories, images, media and hand-written HTML all inherit it, so no category can be missed — which is how images and media came to be copied out of hidden folders in the first place.
- **Auto-indices skip hidden folders**, in all three listing paths: from source, from output, and the fallback index generated for a folder without one. The output-scanning path checks the *source* tree, so a folder hidden after it was generated does not reappear from stale files left in `output/`.
- **A folder holding nothing but a hidden subfolder is no longer treated as having content**, and so is not linked as if it had pages.
- **`serve` returns 404 for anything under a hidden folder** — documents, images, `config.json` itself — from a single gate ahead of the static-file fallbacks. `serve` and `generate` now agree.
- **The menu check no longer depends on the folder having children**, so an empty hidden folder is skipped too.

`isFolderHidden()` accepts file paths as well as directories: the walk begins at the path itself, and a file has no `config.json` of its own, so its ancestors decide. That is what lets one predicate filter a mixed list of files and directories. Its shallow companion `isFolderSelfHidden()` tests one folder without a docroot, for the auto-index builders, which know only the folder they are listing.

Files already written to `output/` before a folder was hidden are still not deleted — nothing links to them any more, but removing them needs `--clean`. That is the general "generate never deletes" behaviour, unchanged here.

# 0.93.0
2026-09-03

`menu-label` now renames a folder everywhere it appears, not just in the sidebar.

A folder could already override its menu label — `menu-label` in its `index.md` frontmatter, or `label` in its `config.json` — and the site-wide menu honoured it. Nothing else did. A folder called `bnw` labelled "BNW - Brave New World" in the sidebar was still "Bnw" in the auto-index listing of its parent, "Bnw" in the `<h1>` and `<title>` of its own generated index page, and "Bnw" in every breadcrumb trail passing through it. The label was doing a quarter of its job, and there was no way to fix the other three without renaming the folder on disk.

- **Auto-index listings resolve labels the same way the menu does**: `menu-label` frontmatter, then `config.json` `label`, then the folder name. This covers all three listing paths — the inline listing from `generate-auto-index: true`, the fallback index generated for folders without one, and the output-scanning variant.
- **Individual documents honour `menu-label` too**, so a single article can be renamed in a listing without renaming its file.
- **Auto-generated index pages take the folder's label** for their `<h1>` and `<title>`, instead of the raw folder name.
- **Breadcrumbs use folder labels** for every folder segment in the trail. The current page's own crumb now prefers its `menu-label` over its `title`; with neither, nothing changes.
- **`menu-sort-as` orders auto-index listings**, matching how it already orders the menu. Folders still sort ahead of files.

One naming change reaches folders with no label at all. Auto-index entries and breadcrumbs used to title-case names by lowercasing everything after the first letter, so a folder named `SoL` rendered as "Sol" and `WWII` as "Wwii". They now use the menu's own rule, which leaves interior capitals alone — the two places agree, and the disagreement they had was the bug.

The resolution rules live in `helper/menuLabels.js`, which the menu, the auto-index and the breadcrumbs all import, so the three cannot drift apart again.

Auto-index pages still have no dependency edge to the documents they list, so on a warm incremental rebuild a label edit in one folder does not regenerate a sibling listing that names it. That predates this change — adding or renaming a document went stale the same way — and `--clean` or a full generate is unaffected.

# 0.92.0
2026-08-27

Upgrading ursa now invalidates the build cache, so an upgrade takes effect without `--clean`.

`.ursa/` caches a content hash per source document, and a document whose hash is unchanged is skipped entirely. But the hash only describes the *source*. It says nothing about the templates, renderers and asset bundles that turned that source into HTML — all of which live in ursa itself. So installing a new ursa over a warm cache left every unchanged document frozen at whatever the previous version produced: new template markup didn't appear, renderer fixes didn't apply, and even the ursa version in the page footer stayed at the old number. The workaround was to remember to run `--clean` after every upgrade, which is most of what made `--clean` feel mandatory in the first place.

- **`.ursa/` is stamped with the ursa version that wrote it.** On a mismatch the whole directory is discarded — hashes, dependency graph, nav cache and search index together — and the build starts cold. Upgrades and downgrades both count; so does a cache left by a version too old to have written a stamp, and a stamp that can't be parsed.
- **Matching stamps cost nothing.** A warm rebuild on the same version still skips every unchanged document, exactly as before.
- **`--clean` is unaffected**, and leaves behind a stamp the next run accepts, so it no longer costs an extra cold build.

This was the last unimplemented rule in the 0.76.0 cache-invalidation list; the other four (document, inherited `style.css`/`menu.md`, template, static asset) were already in place.

# 0.91.0
2026-08-27

Ursa's built-in CSS is scoped with `@scope` and layered with `@layer`, so a site's own stylesheet no longer has to fight it.

Styling a site had turned into a specificity war. Ursa's stylesheet is loaded before the site's, but it styles content through selectors like `article#main-content h1` — an ID and two elements — so a site author writing the obvious `h1 { … }` lost, and kept losing until they either copied Ursa's selectors or reached for `!important`. Worse, rules meant for the frame leaked into documents and rules meant for documents leaked into the frame, because everything shared one flat global scope.

- **Content styles are layered.** Everything Ursa applies to a document body — headings, images, figures, the article box, the sticky headings — now lives in `@layer ursa.content`. A site's `style.css` is unlayered, and an unlayered declaration beats a layered one regardless of specificity, so `h1 { position: static }` or `#main-content { width: 1000px }` in a site stylesheet simply wins, at any specificity.
- **Chrome is scoped, not layered.** The top bar, menus, widgets, search and footer sit in `@scope (body) to (#main-content > *, article > *, .ursa-unstyled)`, so none of it can reach into a document's own markup — and, being unlayered, a stray `a { … }` in a site stylesheet still can't wreck the navigation. Chrome's selectors are unchanged, so overriding them works the way it always did — with a more specific selector, since a scoped rule now wins a specificity tie against an unscoped one. Breadcrumbs, the image hover controls and the lightbox get their own scopes on the same terms, since they are Ursa's furniture even though they render inside — or on top of — the document.
- **`class="ursa-unstyled"`** on any element puts it and everything inside it outside every one of Ursa's scopes. Not "override the defaults" — Ursa's CSS does not apply in there at all, down to the strike-through on dead links. The lightbox leaves images in there alone too, rather than injecting controls it has no styles for.
- **Nothing looks different.** The reorganisation is a pure cascade change. Verified by diffing every computed property and every bounding box of every element, before and after, across four pages, both colour schemes, desktop and mobile widths, and eight interaction states (top menu, collapsed and open side menu, stuck headings, open widgets, search results, inactive links, open lightbox): zero differences outside `.ursa-unstyled`.

Requires `@scope`: Chrome 118+, Safari 17.4+, Firefox 128+.

# 0.90.1
2026-08-29

Upgraded `sharp` to the current 0.34 line and updated install-script allowlisting for pnpm.

- `sharp` is now `^0.34.5`.
- Added `sharp` to `pnpm.onlyBuiltDependencies` so its native install step runs consistently in pnpm-managed environments.

# 0.90.0
2026-08-26

Article images get a zoom and a download button on hover, and a full-screen viewer behind the zoom.

Images in a built site are downscaled WebP previews — 800px at quality 80 — wrapped in a link to the original. That is right for page weight and wrong for looking at anything: the only way to see the pixels that were actually shot was to click through to a raw image file in a new tab, losing the page, and the only way to keep a copy was the browser's context menu, which on that page would have saved the preview rather than the original.

- **Hover controls** on every article image large enough to be a picture rather than an icon (80px in both axes). Zoom opens the viewer; download saves the **original** — not the preview — under its own filename. On touch devices, where there is no hover, they are simply always visible.
- **The viewer** opens the original at native resolution when it fits the viewport, and contained within it when it does not, over the standard translucent black backdrop. It loads the preview first as a placeholder, so a multi-megabyte original arrives into a full-size blurred image rather than an empty box.
- **Zoom in/out appear only when there is resolution left to see** — an image already showing every pixel it has gets no zoom controls. Steps of 1.5× between contain-fit and 100%, keeping the centre of the view fixed; drag to pan, double-click to toggle fit and 100%.
- **Closing**: the backdrop, the letterboxing around the image, the X, or Escape. Tab stays inside the dialog while it is open, and focus returns to where it was on close.
- `meta/templates/default-template/lightbox.js` and `lightbox.css`, picked up by the existing asset bundler; `data-no-lightbox` on an image or any ancestor opts out.

Clicking the image itself is unchanged — it still opens the original in a new tab.

# 0.89.0
2026-08-20

Fixed `generate` dropping every static file that was not an image or an HTML page — fonts, video, audio, PDFs. A site that used any of them worked perfectly in `ursa serve` and shipped broken.

`serve` reads static files straight off disk through one list of extensions, while `generate` had two narrower ideas of what to copy: images, and `.html`. Nothing else ever reached the output. Because dev and build disagreed rather than both being wrong, the gap was invisible until deploy — and then invisible again, since a static host that rewrites 404s to `index.html` answers a missing `.mp4` with a page of HTML rather than an error.

- **`generate` now copies fonts, audio, video, documents and archives**: `woff`, `woff2`, `ttf`, `eot`, `otf`, `pdf`, `mp3`, `m4a`, `wav`, `flac`, `mp4`, `m4v`, `webm`, `ogv`, `ogg`, `zip`. Images keep their own path, because they also get previews.
- **One shared list**, in `helper/staticAssets.js`, used by both `generate` and `serve`, so they cannot drift apart again. It is the drift, not either list, that caused this.
- The static-files progress line now counts HTML and media separately.

# 0.88.0
2026-08-19

`ursa serve` gains `--strict-port`, and stops prompting when nobody can answer.

Serving a wiki is increasingly one process among several — a `pnpm dev` that starts an app, an API and a docs site in parallel. The interactive "Port 8080 is already in use. Use port 8082 instead? (Y/n)" fallback is wrong in that setting twice over: sibling processes share stdin, so the question either hangs the whole dev command or eats a keystroke meant for something else; and a different port is not a good outcome anyway, because whatever embeds the wiki — an iframe, a proxy, a link — was configured with the port that was asked for, so moving silently produces a broken embed with no error anywhere.

- **`--strict-port`** fails with a clear message instead of falling back. This is what a dev script wants.
- **Without it, a non-TTY stdin no longer prompts.** It picks the fallback port and says so loudly, including that anything pointed at the original port must be updated. Interactive terminals are unchanged.
- `resolvePort(port, { strict, interactive })` is the programmatic form; `interactive` defaults to `process.stdin.isTTY`.

The error for an occupied WebSocket port now says that is what happened — hot reload listens on `port + 1`, and being told "port 8081 is in use" when you asked for 8080 reads as a bug in ursa.

# 0.87.5
2026-08-19

Fixed a build that silently produced nothing when the docroot lived under a dot-directory — a git worktree inside `.claude/worktrees/`, anything under `~/.config` or `~/.local`. Two independent places tested hidden-folder patterns against the **absolute** path rather than the path relative to the docroot, so the docroot's own ancestry marked the entire site hidden.

The symptom was unhelpful in both halves. `generate` classified **0 articles** out of 31 scanned files and carried on, so a build could report success and write an empty site; and `getAutomenu` then died on `Cannot read properties of null (reading 'children')`, because `directory-tree` had excluded the root and returned `null` — a stack trace pointing at menu construction for a problem that was neither about menus nor about that file.

- **`helper/hiddenPaths.js` (new)** — `toSourceRelative()` and `isHiddenOrSystemPath()`, the single place that decides what "hidden" means. Judged relative to the docroot, always separator-prefixed so a genuinely hidden top-level folder (`<source>/.drafts`) still matches.
- **`jobs/generate.js` and `dev.js`** now route every hidden/system test through it, instead of matching absolute paths in seven places.
- **`helper/automenu.js`** walks the tree first and prunes after, rather than handing `directory-tree` an absolute-path `exclude` that can reject the root itself. A docroot containing `node_modules` is now walked before being discarded, which is the price of being right about every ordinary path. Also raises a legible error if the docroot genuinely cannot be read, rather than passing `null` downstream.

Output for a docroot on an ordinary path is byte-for-byte unchanged.

# 0.87.4
2026-08-13

Fixed three ways an index page could go permanently stale on warm builds, so that adding, renaming, or deleting content stopped appearing in any listing that should have contained it. Symptom: a brand-new folder rendered its own page correctly, but nothing linked to it — the root landing page, the parent folder's listing, and the parent folder's generated `index.html` all kept describing the tree as it looked the first time they were written, sometimes months earlier.

- **Documents with `generate-auto-index: true` are now always regenerated.** Their output is a listing of the source tree, so it depends on which folders and files exist — not just on the document's own text, which is all `needsRegeneration()` hashes. Adding a folder elsewhere in the tree left the hash untouched, so the document was skipped forever and its embedded index never grew. Only a handful of documents opt in, so they are simply rebuilt every pass.
- **Generated directory listings (`<dir>.html`) are no longer write-once.** The old guard skipped the write whenever the file already existed, which froze the listing at its first build. It now rewrites every pass, guarded instead by ownership: a document that renders to the same path — an article named after its own folder (`settings/starwars/people.md` alongside `settings/starwars/`), or a hand-written `.html` in the source tree — keeps the path, and the listing is not written there at all. That collision is what the old existence check was incidentally protecting against.
- **Auto-generated folder `index.html` files are no longer write-once**, for the same reason and with the same reasoning: folders with a source index document and hand-written source HTML were already excluded from that code path, and alternates (`_index.html`, `home.html`, `<foldername>.html`) are re-promoted on every pass, so nothing authoritative is at risk.

Cost of rebuilding these listings on every warm build, measured on a 465-directory site: 3.01s → 3.24s total.

# 0.87.3
2026-08-09

- Fixed silent incomplete builds caused by hash-skipping (the TODO logged in 0.87.2). `needsRegeneration()` compared only the source content hash, but the hash cache lives in the *source* tree (`<source>/.ursa/content-hashes.json`) and is therefore shared by every output directory built from that source. A build to one output dir recorded hashes that made a later build to a different output dir skip those documents entirely — emitting auto-index entries linking to `.html` files that were never written. Deleting or partially losing `output/` had the same effect. Both the article and static-file paths now also require the expected output files to exist before skipping.

# 0.87.2
2026-08-09

- Fixed a crash when `ursa serve` fell back to an alternative port. The fallback search only checked whether the HTTP port was free, so it could offer a port whose WebSocket port (`port + 1`) was still occupied — e.g. offering 8079 when 8080/8081 were both taken, then dying with `EADDRINUSE` on the hot-reload server. Port selection now requires both ports of the pair to be available.
- TODO (fixed in 0.87.3): Hash-skipping in `generate()` assumes the corresponding output files (`.html`/`.json`/`.xml`) still exist on disk. If `output/` is deleted (or partially lost) while `<source>/.ursa/content-hashes.json` survives, a normal (non-clean) build silently produces incomplete output — e.g. the root `index.html` is never written because `docs/index.md` is hash-skipped. Fix: make `needsRegeneration()` also force a rebuild when the expected output file is missing.

# 0.87.1
2026-06-15

- nothing

# 0.87.0
2026-06-11

- Added support for definition lists in Markdown/MDX documents, allowing for structured term-definition pairs to be rendered as HTML definition lists (<dl>, <dt>, <dd>).
- Added response headers for json files with the ursa and doc repo version numbers, so consumers can invalidate caches when a new version is deployed.


## Serve Revamp (Phases 0–1)

`ursa serve` could miss cascading updates — stylesheet edits, static files in `meta/`, template changes, and any change saved while a rebuild was already running — forcing a restart with `--clean`. This release ships the first two phases of the rework; design, root-cause analysis, and remaining TODOs: [docs/changes/serve-logic.md](docs/changes/serve-logic.md).

- **Serve-mode reliability fixes (Phase 0):**
  - Static assets in `meta/` (images, fonts, PDFs, media) are now watched; replacing one re-copies it to output and reloads clients, without a full rebuild. Previously these changes were invisible until restart.
  - Changes saved while a regeneration is in flight are queued and processed when the current pass finishes, instead of being dropped with "changes lost".
  - Every full-rebuild path now deletes `content-hashes.json` and `nav-cache.json` first, so a rebuild after a template/meta change actually regenerates unchanged articles instead of hash-skipping them and leaving stale HTML.
  - The dependency tracker is persisted to `.ursa/dependency-graph.json` and reloaded on warm start, so hash-skipped documents keep their invalidation edges. Single-file regeneration now registers dependencies too, and template edits are recognized under the `templates/{name}/index.html` folder structure — a template edit on a warm start is now a selective rebuild of just the documents using that template.
- **New incremental build engine (Phase 1):** `src/helper/build/graph.js` — a fingerprinted dependency graph (Make/Shake-style) with dynamic dependency discovery (`ctx.read`/`ctx.exists`/`ctx.get`), lookup nodes so file *creation* invalidates, size+mtime fast-path fingerprinting with content-hash confirmation, early cutoff, topological demand-driven scheduling, failure isolation with retry, and versioned persistence to `.ursa/graph.json`. Fully unit-tested; the build/serve pipelines will be ported onto it in the next phases (2–4).

# 0.86.0
2026-05-18

- small CSS fix

# 0.85.0
2026-05-15

- deflists in MDX


# 0.84.0
2026-05-08

- Unified sticky headers are now standard

# 0.83.0
2026-05-07

- **New `--promote-changelog=<file.md>` option** for the `generate` and `serve` commands. When supplied, the named markdown (or .mdx) file is staged into the source root for the duration of the build, so it is rendered by the normal Ursa pipeline and ends up in the output root as a sibling of the main `index.html`. The staged copy is removed after the build completes (or when the serve process exits via SIGINT/SIGTERM). If a file with the same basename already exists in the source root, no staging is performed and a warning is logged.
- **Search UI fix**: clicking a search suggestion (or selecting one with Enter) now hides the search results dropdown immediately. Previously the dropdown could remain visible when navigation did not trigger a fresh page load (e.g. same-page anchor links, or restoration from the browser's back/forward cache). Also added a `pageshow` listener that hides results when the page is restored from bfcache.
- **Search UI fully collapses after navigation**: clicking a search suggestion (in either the inline search dropdown or the search widget panel) now also closes the search widget panel and clears the search input, mirroring the effect of clicking the search icon a second time. The input is also cleared when the page is restored from the browser's back/forward cache.
# 0.82.0
2026-05-06

- **Frontmatter table is now opt-in**: The HTML frontmatter table that was previously injected into every Markdown/MDX document after the first H1 is now only rendered when the document's frontmatter sets `render-frontmatter: true` (boolean `true` or string `"true"`). Documents without the flag (or with it set to `false`) no longer have the table injected. The `render-frontmatter` key itself is excluded from the rendered table.

# 0.81.4
2026-05-04

- bug fix: directory index html files were never being written...impossibly, but there it is

# 0.81.3
2026-04-14

- bug fix: When script.js changes in serve mode, the bundle cache wasn't being cleared, so documents kept using stale bundles.
  - Added clearScriptCache() and clearStyleCache() functions in generate.js
  - Updated serve.js to call these functions when CSS/JS files change


# 0.81.2
2026-03-28

- MDX hydration: MDX documents now support hydration of embedded React components, allowing for interactive content within static pages.

- **Fixed Recent Activity tracking**: The Recent Activity widget now properly tracks when document content actually changed, rather than relying on file system modification times (mtime). 
  - Previously, Recent Activity used filesystem mtime, which doesn't work correctly after git clone (git doesn't preserve timestamps) or when all files are built simultaneously.
  - Now, content change timestamps are stored in `.ursa.json` (in the source directory), which:
    - Survives `--clean` builds (unlike the `.ursa/` cache folder)
    - Can be committed to git to preserve wiki history across clones
    - Falls back to file mtime for files that haven't been tracked yet (backward compatibility)
  - Both full builds and single-file regeneration (serve/dev mode) now update content timestamps when content actually changes (detected by hash comparison).

# 0.80.1
2026-02-16

- Fixed package.json issue

# 0.80.0
2026-02-16

- Added remark extensions to ensure MDX has the same extended markdown features as regular markdown (e.g. footnotes, definition lists, etc.)

# 0.79.0
2026-02-14

- Menu fixes:
  - Zero-item submenus will no longer be hidden if they have subfolders with one+ item
  - Bug fix for missing menu items
  - Level 2+ menus now have overflow:scroll (vertical only)

# 0.78.0
2026-02-13

- added release-it
- --clean now fully deletes the .ursa cache folder and clears the output directory before generation, ensuring a completely fresh build without any stale files. Previously, --clean only ignored the cache but left existing output files in place, which could cause issues with stale auto-generated indexes and other files blocking new generation. This change provides a more robust clean build experience.

# 0.77.0
2026-02-13

QOL:
- When 'serve' encounters an occupied port 8080, prompt the user to find an available port instead of just exiting with an error. Will check open ports and find the closest port to 8080, then ask the user if they want to use it.

Meta cleanup:
- Templates should have their own folder, including default
- All static files for a template should be in the template's folder, and probably in the right subfolder (e.g. public/default.css should be in templates/default/public/default.css or something like that).
- Template filenames should be templates/{templateName}/index.html
- Ursa should throw a warning if it finds orphaned static files in meta that aren't referenced by a template

Static assets revamp:
- Revamped the building of static assets (stylesheets and scripts). The new logic is:
  - All meta scripts and stylesheets should be bundled together into a single CSS file and a single JS file for the entire site. This applies to build mode; in dev mode, they are served individually for easier debugging and regeneration.
  - Bundle-able document files (style.css, script.js, menu.md) will be bundled together on a per-folder basis. Each document will include the bundles from its own folder and all parent folders (where they exist).

Regeneration revamp:
- Existing logic:
  - On first generation, save a cache of document output given some sort of hash of the source file and metadata (e.g. mtime, size, etc.)
    - All static files (meta and document) should include a datetime or hash-based cache-buster in their query strings / filenames, so they can be invalidated as needed
  - On subsequent generations, if the source file's hash is unchanged, skip regeneration and reuse the existing output file. (Note: this doesn't handle cases where the statis files changed and the document didn't; see below)
  - Push a notification to the client when a file is regenerated, so the client can update the page if it's currently being viewed
- New logic is as above, plus: (some of this is partially complete, but these are the complete requirements)
  - When any file being watched is changed, determine the list of affected files. For instance:
    - A normal document will obviously invalidate that exact document.
    - Special Ursa static files (menu.md, style.css, and script.js) are inherited by all documents in the current folder and all subfolders, so they will invalidate all documents in the current folder and all subfolders.
    - Meta static files:
      - A template file in meta will invalidate all documents that use that template.
      - A stylesheet or script file in meta will invalidate all documents that inherit from that meta (which is probably everything).
    - All other static files in the docroot (assuming they're linked at all by any document) should be invalidated thus:
      - Calculate a new hash for the static file
      - Find all documents that reference that static file
      - Regenerate the html (even if the source md/mdx/txt file is unchanged) for those documents to update the cache-busting query string for the static file reference
- This should catch all the various edge cases that previously required restarting the server or doing a full regeneration.
- Regeneration priority order:
  - When regeneration is triggered, check for connected WebSocket clients and get their current URL.
  - If their current URL is affected by the change (document, static asset, template, anything), prioritize the necessary documents and assets to serve that URL before all others, and when they are regenerated, send the push notification to reload.
  - After that, regenerate the rest of the affected documents in the background.
  - In cases of rapid changing of files, do the following:
    - Debounce all file system change events within a short time window (e.g. 500ms); wait for at least 500ms of no changes before starting regeneration. This helps in cases where a script or bot is making many changes to many files.
  - When a change is detected, before any complex processing, send a ping to WebSocket-connected clients that an update is in progress, but it isn't known yet if it will affect their page.
  - When it is determined that a change will affect the current page of a connected client, send another push to let the client know.
  - Handle the above two notifications in the UI thus:
    - When updates start, add a subtle loading indicator to the right of all left widgets, such as <Loader color="gray" />
    - If it turns out the update doesn't need a refresh, remove the indicator.
    - If it does need a refresh, change the indicator to a <Loader color="green" />.
    - When the hot refresh actually happens, the indicator shouldn't be there anymore.
- Cache changes (under consideration):
  - Before the cache was implemented, every file change triggered a complete regeneration of the entire site. This was slow, obviously. First, an in-memory cache was added to speed up the regeneration of unchanged files. But since the watcher back then missed a lot of regeneration cases (such as all meta changes), killing 'serve' and restarting it was quite common. Thus, the cache was persisted to disk, so that even in the case of a full regeneration (such as after a restart), unchanged files would still be skipped. This has worked fairly well, but for the invalidation edge cases described above (already fixed).
  - However, considering that we now have a robust regeneration system that can handle all edge cases and push updates to the client, we may want to consider removing the cache entirely. The cache adds complexity and can sometimes get into a bad state, requiring manual deletion. With the new regeneration system, we could keep the cache in-memory, and rarely will the user need to kill 'serve' and restart just to get an update (ideally, never). In-memory cache is even faster than disk, so this might be a better experience overall.
- Regeneration cases still unhandled:
  - User updates Ursa itself (e.g. npm update) while serve is active. I mean, this shouldn't be very common outside of Ursa devs, but's determine:
    - Does the current system actually catch the meta changes?



Top Menu improvements:
- When a submenu overflows the available viewport height, it should become scrollable instead of overflowing off the screen. This can be achieved with CSS by setting a max-height and overflow-y: auto on the submenu container.
    
New Widgets:
- Suggested Content
  - A new left-side widget that shows a list of suggested content based on the current page. Categories of suggested content:
    - Content you frequently view (uses localStorage to track page views and show most viewed content)
    - Future ideas:
      - LLM-guided suggestions based on frequently viewed content, suggested related documents you haven't viewed yet, etc.

Bugs:
- [x] When using menu.md with auto-generation, the top menu's Home href is "//index.html" instead of "/index.html". On localhost, this ends up working fine, but on https://realdomain.com, this loads https://index.html which obviously doesn't work. The current logic seems to prefer absolute URLs, so in this case, the url for home should be "/index.html" (not double slash).
- [x] Site style.css is not present on auto-generated index pages
- Regeneration issues:
  - Create a power, that power page now exists. But powers.json doesn't have it.

# 0.76.0
2026-02-11

- **New Feature: Recent Activity widget.** A new topbar widget shows the 10 most recently modified documents in the docroot, sorted by modification date (most recent first). The widget appears on the left side of the top nav (to the right of the home icon) and is open by default.
  - Recent activity data is collected during the generate phase by stat-ing each article file, then written to `public/recent-activity.json`.
  - In serve/dev mode, the recent activity list is built during background cache initialization and updated live when article files are changed.
  - The single-file regeneration path (`regenerateSingleFile`) also updates the recent activity JSON incrementally.
- **Widget system improvements:**
  - All widgets now have a close (✕) button in the upper-right corner of their panel header. Clicking it closes the widget and deselects the corresponding icon in the top bar.
  - Widget open/closed state is now persisted in localStorage. Widgets that were open will remain open after a page reload, and widgets that were closed will remain closed. Widgets with no saved state fall back to their default (Recent Activity defaults to open; others default to closed).
  - The widget system now supports both left-side and right-side widget panels, which operate independently (one widget per side can be open at a time).

# 0.75.0
2026-02-10

- Top Menu changes: the top menu is now the default first-level navigation. Top-left nav is either root, or 'hamburger' on smaller screens.
  - Right column is now a standardized widget zone, with TOC, Search, and Profile widgets implemented.
- Default header: documents without an initial H1 will now have their title rendered as an H1 header at the top of the article. Index/home pages will default to the parent folder name if not overridden.
- Breadcrumbs: added breadcrumbs to the top of each article for easier navigation and context

# 0.74.0
2026-02-08

- added a feature to skip preview generation and swapping on a per-image basis. You can use the data-no-preview tag in html, and the ?no-preview query parameter in markdown or wikitext images.
- when building automenus and autoindex pages, folders with no md/mdx/txt/html documents anywhere in their tree will not be shown.

# 0.73.0
2026-02-07

- fixed build pipeline blocker

# 0.72.0
2026-02-07

- MDX support: Ursa can now process .mdx files with embedded JSX components
  - MDX files are parsed and rendered to HTML with React components
  - Custom components can be imported and used within MDX content
  - MDX documents are fully integrated with Ursa's build and serve processes, including hot reloading in dev mode
  - This allows for rich interactive content while still benefiting from Ursa's static site generation features

# 0.71.0
2026-02-05

- 'Dev mode': new mode similar to serve, but only generates documents on-demand to save time.
  - When running `ursa dev`, the server starts immediately without a full build
  - Documents are generated on-the-fly when requested, with caching for subsequent requests
  - Ideal for development with large sites where full builds are slow
  - Still supports hot reloading and file watching for dynamic updates
- Custom menus can now include auto-generated menus in addition to custom content
- Custom menus are displayed on the top bar instead of the side

# 0.70.0
2026-02-04

- **Navigation Cache**: Dramatically improved navigation build time
  - Navigation structure cached in `.ursa/nav-cache.json`
  - Cache validated by file list hash + metadata file stats (index.md, config.json)
  - Parallel stat operations for faster cache validation
  - Result: Navigation build drops from ~9s to ~50ms on cached runs (99% improvement)

# 0.69.0
2026-02-04

- **Image Processing Performance**: Dramatically improved image processing speed
  - Persistent image cache: images are only re-processed when source file changes (mtime/size check)
  - Parallel processing: 8 images processed concurrently instead of sequentially
  - Smart preview skipping: images smaller than 800x800 skip preview generation (already small enough)
  - Result: Image processing drops from ~23s to ~16ms on cached runs (99.9% improvement)

# 0.68.0
2026-02-04

- **Build Performance Profiling**: Added comprehensive profiling to identify performance bottlenecks
  - Each build phase is now timed with millisecond precision
  - Visual bar chart report shows percentage of total build time per phase
  - Phases tracked: Scan source files, Filter & classify, Build navigation, Load cache, Copy meta files, Process images, Process articles, Write search index, Write menu data, Process directories, Process static files, Auto-index generation, Finalization
  - Report displayed at end of each build for performance analysis

# 0.67.0
2026-02-04

- All images referenced in whitelisted documents should be processed and copied, even if the images themselves are not in the whitelist

# 0.66.0
2026-02-04

- Links to a markdown file in source will now render as a link to the corresponding .html file even if the target file does not exist yet
- Relative URLs in raw HTML elements (img src, video src, etc.) embedded in markdown files are now resolved relative to the document's location
- Relative URLs in inline style `url()` values (e.g., `background-image: url('./img/foo.webp')`) are now resolved relative to the document's location

# 0.65.0
2026-02-01

- Fixed issue where images wrapped in an anchor tag were incorrectly given a click handler to open in a new tab

# 0.64.0
2026-01-31

- Handles scenario where a new image is added while serving (previously the image wouldn't show without a full restart)
  - New images are now processed on-the-fly when detected in serve mode
  - Image previews are generated and copied to output automatically
  - HTML is updated to use preview images without needing a full rebuild

# 0.63.0
2026-01-31

- Images inside an anchor tag will no longer have a click handler added to open the image in a new tab
  

# 0.62.2
2026-01-29

- Fixed CI issue with pnpm using npm-specific syntax

# 0.62.1
2026-01-29

- CI now uses pnpm to avoid redundant package managers

# 0.62.0
2026-01-29

- **Enhanced Auto-Index**: Index documents can now configure auto-index generation via frontmatter
  - `generate-auto-index: true` - Include an auto-generated index listing in the page
  - `auto-index-depth: N` - Control recursion depth (1 = current folder, 2 = current + subfolders, etc.)
  - `auto-index-position: top|bottom` - Insert the auto-index before or after the document content

- **Faster Serve Mode**: The `serve` command now uses deferred image processing for significantly faster startup
  - HTML files are generated immediately with original image paths
  - Image preview generation runs in the background after HTML is ready
  - Site is browsable within seconds instead of waiting for full image processing
  - Images will display as originals until preview generation completes (then show optimized WebP previews)
  - Added hot reloading for regeneration

- **Bug Fixes**:
  - Fixed issue where style.css changes were not reflected until server restart in `serve` mode
  - Fixed issue where root-level auto-index had incorrect HREFs
  - Fixed issue where re-generating an index document with `generate-auto-index:true` did not include the auto-index until server restart
  - Fixed issue where auto-indexer was rendering 'img' folders

# 0.61.1
2026-01-14

- Fix: package-lock.json version mismatch

# 0.61.0
2026-01-14

- Image Handling
  - [x] When an image tag is encountered, and the image is found in the static assets:
    - [x] Process the image to a preview size (max width/height == article width (50rem) or px equivalent), and convert to webp with reasonable compression. Copy the original image as well as the preview.
    - [x] Generate the HTML img tag as is currently done, but:
      - [x] Use the preview image as the src
      - [x] Use the original image as the data-fullsrc attribute
      - [x] On click, open the original image in a new tab

# 0.60.0
2026-01-03

- added `menu-label` frontmatter field to override default menu labels
- added `menu-sort-as` frontmatter field for custom sort ordering
- metadata-only index.md files now trigger auto-index generation
- index files sorted to top of menu panes with distinct styling
- fixed menu column vertical scrolling
- excluded Ursa-internal fields from frontmatter table display

# 0.59.0
2026-01-01

- added frontmatter rendering

# 0.58.0
2025-12-26

- new menu UI with 2-pane horizontal layout

# 0.57.0
2025-12-26

- added full-text indexing and search using lunr.js
- all links in generated html will be full links with extensions (e.g. /folder/page.html)

# 0.56.0
2025-12-23

- restored metadata to directory index JSON files

# 0.55.0
2025-12-21

- custom menus (menu.md|txt) override the automenu when present

# 0.54.0
2025-12-21

- added cache-busting timestamps to static files
- cleaned up generate.js by moving helper functions to separate files


# 0.53.0
2025-12-21

### Menu Size Optimization
- **External Menu JSON**: Menu data is now stored in `/public/menu-data.json` instead of being embedded in every HTML file. This dramatically reduces HTML file sizes for sites with large folder structures (e.g., from 2-3MB per file down to ~50KB).
- **Async Menu Loading**: Menu data is fetched asynchronously after page render, showing a "Loading menu..." indicator until ready.
- **Debug Fields Removed**: Menu JSON no longer includes debug/inactive fields, reducing JSON size further.
- **Gzip Compression**: Development server now uses gzip compression for all responses, significantly reducing transfer size for JSON and HTML files.

# 0.52.0
2025-12-21

- Fixed search results not displaying correctly when no matches are found

# 0.51.0
2025-12-21

- Existing .html files are no longer overwritten by generated documents.

# 0.50.0
2025-12-21

### Performance Optimizations
- **CSS Path Caching**: Implemented caching for `findStyleCss()` lookups during generation. Reduces redundant filesystem walks for documents in the same directory tree.
- **Template Replacement Optimization**: Changed from 8 sequential `string.replace()` calls to a single regex pass, reducing intermediate string allocations.
- **Wikitext Regex Pre-compilation**: Pre-compiled ~40 regex patterns at module load time instead of compiling on every `wikiToHtml()` call.

### New Features
- **Static File Watch**: `ursa serve` now watches for new/changed static files (images, fonts, PDFs, etc.) and automatically copies them to output without requiring a full rebuild.

### Bug Fixes
- **Menu Folder Expansion**: Fixed issue where navigating to `/folder` wouldn't auto-expand the menu, but `/folder/index.html` would. Both now behave consistently by normalizing trailing slashes in URL comparison.


# 0.49.0
2025-12-20

- Fixed more instances of false inactive links, this time in wikitext files (.txt)
- **Auto-Index Style Fix**: Auto-generated index pages now correctly inherit `style.css` from parent folders, just like normal documents
- **Clean Build Fix**: The `--clean` flag now properly clears the output directory before generation. Previously it only ignored the hash cache, which could leave stale files (like old auto-generated indexes) that would block new generation.


# 0.48.0
2025-12-20

- **External CSS**: CSS files are now externally linked via `<link>` tags instead of being embedded in each HTML page. This significantly reduces HTML file sizes and improves browser caching.
- **Fast CSS Updates**: CSS file changes in watch mode now just copy the file to output (~1ms) instead of triggering a full rebuild
- **Fast Single-File Regeneration**: Article changes in watch mode use a new fast-path that regenerates only the changed file (~50-100ms) instead of scanning all source files
- **Clickable Folder Links**: All folders in the navigation menu are now clickable links (auto-index ensures every folder has an index.html)
- **Menu Collapse Fix**: Fixed issue where clicking the caret on a folder containing the current page wouldn't collapse it
- **URL Encoding Fix**: Fixed menu not highlighting current page when URLs contain spaces or special characters
- **Link Validation Fix**: Links to folders are no longer incorrectly marked as inactive (folders now included in valid paths since auto-index generates index.html for all)
- **WikiText Link Fix**: Fixed wikitext links (in .txt files) being incorrectly marked as inactive. Link validation is now handled centrally by the link validator after HTML generation.
- **Folder/Index Link Fix**: Links to folders containing a `(foldername).md` file (instead of `index.md`) are now correctly recognized as valid

# 0.47.0
2025-12-20

- Improved handling of trailing slashes in URLs to ensure consistency across all links and resources

# 0.46.0
2025-12-20

- Normalized handling of trailing slashes in URLs

# 0.45.0
2025-12-20

- Added --exclude flag to ignore specified files or directories during generation
- Improved performance of the serve command with optimized file watching
- Automatically generating index.html for directories without an index file

# 0.44.0
2025-12-16

- Added 'sections' metadata property with hierarchical section structure

# 0.43.0
2025-12-14

- Added buildId and .ursa.json
- Added full datetime to footer
- Added commit hash to footer as comment

# 0.42.0
2025-12-14

- Automenu will now remove dashes from file names

# 0.41.0
2025-12-13

- Fixed footer bug

# 0.40.0
2025-12-13

- Added footer

# 0.39.0
2025-12-13

- Updated to node 24.5 to satisfy npm Trusted Publishing
- Refactored Github Actions
- Added CONTRIBUTING.md

# 0.38.0
2025-12-13

- Updated Github Actions workflow to use OIDC for authentication

# 0.37.0
2025-12-13

- Added Github Actions workflow for CI/CD (npm publish)

# 0.36.0
2025-12-13

- Links to a valid .md file in source will now render as a link to the corresponding .html file (and show as an active link)

# 0.35.0
2025-12-11

- Fixed issue where directory indices were empty

# 0.34.0
2025-12-11

- Added config.json with folder-specific settings for label, icon, and visibility
- Root-level config.json can specify open menu items

# 0.33
2025-12-10

- Fixed the broke-ass menu

# 0.32
2025-12-10

- Using .ursa folder in source directory for content hash cache
- Added --clean flag to ignore cache and regenerate all files
- Set up npm config for public package publishing

# 0.31
2025-12-09

- Added URL property to JSON directory indices
- Ensured directory indices are recursive

# 0.30
2025-12-07

- Fixed broken link detection to correctly identify broken internal links

# 0.29.0
2025-12-07

- New nav-main style, two-levels only (but supports any depth), looks way better

# 0.28.0
2025-12-07

- Added broken link detection and styles
- Fixed hole in "serve" logic that didn't regenerate style.css

# 0.27.0
2025-12-07

- Capitalizing nav-main labels

# 0.26.0
2025-12-06
- Fixed global nav styles in desktop
- Updated main nav style to match TOC

# 0.25.0

2025-12-06

- Enhanced mobile navigation with hamburger toggle that changes to X when menu is open
- Improved button accessibility with dynamic aria-label updates

# 0.24.0

2025-12-06

- Added support for index files in folder links
- Folders with index.md/txt/yml now link to /folder/index.html
- Folders without index files render as non-clickable text

# 0.23.0

2025-12-04

- Implemented incremental build support with content hashing
- Source file changes now only regenerate modified files
- Meta file changes still trigger full rebuild
- Added .content-hashes.json cache for tracking file changes

# 0.22.0

2025-12-04

- New Notion-style nav-main sidebar design
- Added folder/document icons with custom icon support
- Collapsible menu items with expand arrows
- Responsive flexbox layout for nav-global

# 0.21.0

2025-12-01

- Enhanced error handling for template retrieval
- Better error messages when templates are not found

# 0.20.0

2025-12-01

- Added fault tolerance to generate command
- Individual file errors no longer stop entire build
- Errors collected and written to _errors.log

# 0.19.0

2025-11-21

- Fixed YAML parsing issues with horizontal rules being mistaken for front matter
- Improved regex to require closing --- on its own line

# 0.18.0

2025-11-21

- Fixed errors with wikitext rendering
- Better handling of undefined args.db

# 0.17.0

2025-10-23

- Added Table of Contents (TOC) generation
- Smooth scrolling to headings with offset adjustment
- Active heading tracking in TOC

# 0.16.0

2025-10-22

- AI-implemented search feature with typeahead
- Search index built from all articles during generation

# 0.15.0

2025-10-22

- Improved mobile responsiveness
- Better media query breakpoint (800px)
- Enhanced h1 styling and article width for mobile

# 0.14.0

2025-10-22

- Fixed sticky header generation
- Enhanced sticky header functionality
- Added responsive navigation styles

# 0.13.0

2025-10-07

- Added whitelist feature for selective file generation
- Added sectionify script for content organization
- Fixed bugs in node-watch for file monitoring
- Working sticky headers implementation

# 0.12.0

2025-10-06

- Added debug CLI mode
- Fixed embedded style issues
- Added site navigation
- Total rewrite of base CSS (article and topnav)
- Added custom CSS support (disabled by default)

# 0.11.0

2025-07-28

- added CLI commands (e.g. "ursa src" and "ursa serve src")

# 0.10.0

2024-03-13

- Will no longer write an autoindex when index document already exists

# 0.9.0

2024-02-10

- Removed spammy debug data from json

# 0.8.0

2023-12-31

- Fixed recursive-readdir to actually return directories, not just files

# 0.7.0

2023-08-01

- removed all non-public modules

# 0.6.0

2023-08-01

- removed some dependencies that required private auth for npm install

# 0.5.0

2023-05-08

- added INCLUDE_FILTER env var

# 0.4.2

2023-03-01

- bug fixes

# 0.4.0

2023-03-31

- Now a library

# 0.3.0

2022-10-17

- Using express instead of http/node-static for serve
- Serve now waits for generation to finish
- Formatted files using prettier

# 0.2.0

2022-03-30

- Added serve command
- Workaround for node-static broken npm package
- Added source static files and menu
- Lots of default styling (not that meta should be in there at all)
- Added TODO

# 0.1.0

2022-03-30

- Initial POC
