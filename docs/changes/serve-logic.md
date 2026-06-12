# Serve Logic Revamp: Dependency-Graph Invalidation

**Status:** Phases 0–1 shipped in 0.87.0; Phases 2–4 pending
**Written:** 2026-06-10 (file/line references are as of v0.86.0)

## Problem

`ursa serve` is unreliable for anything beyond single-article edits. Basic doc updates
regenerate fine, but cascading changes — editing a stylesheet, changing a static file in
`meta/`, switching a template — are often missed, leaving stale output until the user
restarts with `--clean`.

The current invalidation system is a pile of manually-choreographed mechanisms that must
each be triggered at the right call site:

- six independent cache-clear paths: `clearStyleCache()`, `clearScriptCache()`,
  `clearMetaBundleCache()`, `clearWatchCache()`, deleting `.ursa/content-hashes.json`,
  deleting `.ursa/nav-cache.json`
- filename heuristics duplicated in two places: the batch categorizer in
  `src/serve.js` (`processChangeBatch`) and the two plan functions in
  `src/helper/dependencyTracker.js` (`getInvalidationPlan`, `getMetaInvalidationPlan`)

Every missed update is some call site forgetting one of these. The fix is to replace all
of them with a single rule: **every output is a derived node in a dependency graph, and a
node recomputes if and only if one of its recorded input fingerprints changed.**

## Root causes (verified, with locations)

1. **The dependency tracker is empty exactly when it's needed.**
   Dependencies are registered only as a side effect of rendering
   (`dependencyTracker.registerDocument`, `src/jobs/generate.js` ~line 815), but
   hash-skipped documents return early before reaching that call (~line 634). After a
   warm start (second `serve` run with an intact hash cache), almost no documents are
   registered, so invalidation plans return nothing — or silently fall back to a
   "full rebuild" that doesn't rebuild (see #2).

2. **The content-hash skip ignores every input except the article's own markdown.**
   `needsRegeneration` (`src/helper/contentHash.js`) hashes only `rawBody`. Template,
   menu, footer, CSS bundles, and cache-bust timestamps are all inputs to the output
   HTML but none participate in the skip decision. Consequence: the full-rebuild
   fallback after a meta/template change skips every article whose markdown didn't
   change, leaving stale HTML. The menu/config handler works around exactly this by
   deleting `content-hashes.json` (`src/serve.js` ~line 552), but the meta-change
   full-rebuild path does not. This is the direct cause of "stylesheet change requires
   `--clean`."

3. **Static files in `meta/` never fire a watch event.**
   The meta watcher filter (`src/serve.js` ~line 711) is
   `/\.(js|json|css|html|md|txt|yml|yaml)$/` — images, fonts, favicons, PDFs in meta
   are invisible to the watcher.

4. **Changes arriving during a rebuild are dropped.**
   `processChangeBatch` (`src/serve.js` ~line 437) discards the entire batch if a
   regeneration is in flight (logs "changes lost"). Meta changes that regenerate many
   documents open a wide window for silent loss.

5. **File *creation* can't invalidate anything.**
   `findAllStyleCss` / `findAllScriptJs` probe `existsSync` up the directory tree.
   Adding a `style.css` to a folder that had none creates no event the tracker can map
   to documents — no edge exists for a file that didn't exist. The graph must record
   *lookups* (existence probes), not just hits.

6. **Two render paths produce different HTML for the same document.**
   The full build emits a single bundled CSS link per folder
   (`src/jobs/generate.js` ~line 759); `regenerateSingleFile` emits separate per-level
   `<link>` tags (~line 1518). A page's markup flips depending on which path last wrote
   it.

## Target architecture

A small in-process incremental build engine (Make/Shake/Salsa semantics, ~200–300 lines,
no new dependencies). Nothing off-the-shelf in JS fits: turborepo/nx/wireit are
process/task-level, bundler graphs are bundler-specific.

```
leaves:      article.md   style.css   script.js   meta/*   images   _menu/_config
                 │             │           │         │
projections: docMeta(a)    [lookup nodes: "does style.css exist in <dir>?"]
                 │             │           │         │
shared:      menuData → menuHtml   cssBundle(dir)  jsBundle(dir)  templatesMap
             validPaths   footer   metaBundle(tpl)  imageMap   customMenus
                 │
per-doc:     bodyHtml(a) = f(article, imageMap slice)
             pageHtml(a) = g(bodyHtml, template, menuHtml, footer, bundles, validPaths)
             docJson(a), docXml(a) — share bodyHtml
                 │
aggregates:  searchIndex   fullTextIndex   recentActivity   dirIndex(dir)   autoIndices
```

Key design decisions:

- **Dynamic dependency discovery.** Node recompute functions receive a context and call
  `ctx.read(path)` / `ctx.exists(path)` / `ctx.get(otherNode)`; the engine records edges
  as they are consumed. Content-dependent deps (e.g. which template a doc's frontmatter
  selects) are always correct, and the filename-heuristic pile gets deleted rather than
  maintained. Existence probes create **lookup nodes**, fixing root cause #5.
- **Fingerprints replace all caches.** Leaf fingerprint = size+mtime fast path, content
  hash to confirm. A node recomputes iff a recorded input fingerprint differs from when
  it was last read. `content-hashes.json` and `nav-cache.json` become node state.
- **Early cutoff via projection nodes.** `docMeta(article)` projects out title/path/
  frontmatter. `menuData` depends on `docMeta` nodes, not article content. Fixing a typo
  re-renders that article's body, but `docMeta`'s recomputed fingerprint is unchanged,
  so propagation stops — the menu and the other N−1 pages are untouched. This is what
  makes the graph viable at 10k documents.
- **Topological execution order** gives correct regeneration order for free (bundles
  before pages, pages before aggregate indices). The existing client-viewed-priority
  trick still applies *within* a topological level.
- **Persistence.** Serialize `{edges, fingerprints}` to `.ursa/graph.json` after each
  pass. Warm start = stat-scan leaves, dirty the changed ones, run one incremental pass.
  Kills the empty-tracker bug class (#1); `--clean` becomes corruption recovery only.
- **Single-writer loop.** Watcher → debounce → if a pass is running, accumulate into the
  *next* dirty set (never drop). Passes run sequentially.
- **One render path.** `regenerateSingleFile` and the `generate()` article loop become
  the same `pageHtml` node function; serve and build differ only in scheduling.

### Memory at scale (10,000 md files)

Not a concern. ~10k page nodes + ~10–15k leaves + a few hundred shared nodes; ~8–12
edges per page node ⇒ ~100–150k edges. As Maps of Sets holding shared string references:
roughly 10–30 MB, plus negligible per-node fingerprints. For comparison, the existing
`watchModeCache` holds the full menu HTML, `validPaths` for every doc, and the image
map; builds hold every article's raw markdown in `fullTextDocs` simultaneously. If we
ever need 100k+ files: intern paths to integer ids, store adjacency as arrays (single-
digit MB).

## TODOs

### Phase 0 — Quick fixes (ship independently, before/while the graph lands)

- [x] **Widen the meta watcher filter** (`src/serve.js` ~line 711) to include static
      asset extensions (jpg/jpeg/png/gif/webp/svg/ico/woff/woff2/ttf/eot/pdf/mp3/mp4/
      webm/ogg), and handle those events by re-running `copyMetaAssets` +
      re-bundling. Fixes root cause #3.
- [x] **Never drop batches** (`src/serve.js`, `processChangeBatch` ~line 437): when a
      regeneration is in flight, accumulate incoming changes into a pending batch and
      process it when the current pass finishes, instead of discarding with
      "changes lost". Fixes root cause #4.
- [x] **Delete `content-hashes.json` and `nav-cache.json` on *every*
      `needsFullRebuild` path** (`src/serve.js` ~line 594), not only the menu/config
      branch (~line 552). Until the graph exists, this is the only way a full rebuild
      after a template/meta change actually regenerates unchanged articles. Mitigates
      root cause #2.
- [x] **Persist the dependency tracker** to `.ursa/dependency-graph.json` after each
      build and reload it on warm start (merge with registrations from the current
      run), so hash-skipped documents keep their edges. Mitigates root cause #1.
      Also landed alongside: `regenerateSingleFile` now registers its document's
      dependencies (it previously never did), stale entries are pruned against the
      current article set each build, and `getMetaInvalidationPlan` understands the
      `templates/{name}/index.html` folder structure — so a template edit on a warm
      start is a selective rebuild of the documents using that template instead of
      a full rebuild.

### Phase 1 — Build the graph engine (standalone, with tests)

- [x] Create `src/helper/build/graph.js`: node registry keyed by `kind:key`, edge
      storage (forward + reverse), per-node fingerprint storage, dirty-bit propagation,
      topological scheduler with early cutoff. (Scheduling is demand-driven: verifying
      a node verifies its recorded deps first, which yields topological order and
      handles dynamic dependencies; `build(roots)` processes roots in caller order for
      client-viewed priority.)
- [x] Implement the compute context: `ctx.read(path)` (read + record leaf dep),
      `ctx.exists(path)` (record lookup node), `ctx.get(node)` (record derived dep).
      Edges recorded fresh on each recompute (replace, not append, so deps can shrink).
      A failed `ctx.read` of a missing file still records the edge, so creating the
      file later triggers a recompute.
- [x] Leaf fingerprinting: size+mtime fast path, content hash on mismatch suspicion;
      lookup-node fingerprint = boolean existence. (A touch that doesn't change content
      re-hashes but does not propagate.)
- [x] Persistence: serialize/deserialize `{edges, fingerprints}` to
      `.ursa/graph.json`; version the schema so stale formats trigger a clean pass.
      (Leaf stat info is persisted alongside so warm starts keep the fast path;
      `loadGraph`/`saveGraph`/`scanLeaves` cover the warm-start flow.)
- [x] Unit tests: diamond dependencies recompute once; early cutoff stops propagation
      when a recomputed fingerprint is unchanged; dynamic dep change (doc switches
      template in frontmatter → old edge dropped, new edge live); lookup nodes (creating
      a previously-absent `style.css` dirties the subtree); persistence round-trip; a
      throwing node fn marks the node failed without corrupting the graph.
      (`src/helper/build/__test__/graph.test.js`, 22 tests, plus cycle detection,
      failure retry, gc, and priority-order coverage.)

### Phase 2 — Port the build pipeline onto the graph

- [ ] Shared nodes: `templatesMap`, `metaBundle(template)`, `cssBundle(dir)`,
      `jsBundle(dir)`, `menuData`, `menuHtml`, `validPaths`, `footer`, `customMenus`,
      `imageMap` (per-image nodes feeding an aggregate map).
- [ ] Projection nodes: `docMeta(article)` (title, path, frontmatter incl. template
      selection) so article-body edits don't cascade into menu/nav rebuilds.
- [ ] Per-document nodes: `bodyHtml(article)`, `pageHtml(article)`,
      `docJson(article)`, `docXml(article)`. One render function used by both full
      builds and serve (eliminates the bundled-link vs separate-tags divergence, root
      cause #6 — pick the bundled form for both).
- [ ] Aggregate nodes: `searchIndex`, `fullTextIndex`, `recentActivity`,
      `dirIndex(dir)`, auto-indices. These land last in topo order automatically.
- [ ] Replace `needsRegeneration`/`hashContent` skip logic with node fingerprints
      (template/menu/footer/bundle URLs become recorded inputs). Fixes root cause #2
      properly.
- [ ] `generate()` becomes "dirty all leaves whose fingerprints changed, run the
      graph"; `--clean` becomes "delete `.ursa/graph.json` + output, then run".

### Phase 3 — Serve integration

- [ ] Rewrite the watch loop as: watcher event → debounce (keep 500ms) → map event to
      leaf/lookup nodes → add to dirty set → if no pass running, start one;
      single-writer, sequential passes, never drop.
- [ ] Keep client-viewed priority: within a topological level, schedule `pageHtml`
      nodes for currently-viewed URLs first; keep the existing
      `onPriorityComplete` → early-reload flow.
- [ ] Drive hot-reload notifications from the set of `pageHtml` nodes that actually
      recomputed (not from filename categories): reload clients whose page changed,
      `update-no-affect` for the rest.
- [ ] On startup: load persisted graph, stat-scan leaves, run one incremental pass
      (no-op in ms when nothing changed), then start watching.

### Phase 4 — Deletions and cleanup

- [ ] Delete `clearStyleCache`, `clearScriptCache`, `clearMetaBundleCache`,
      `clearWatchCache` and all their call sites (cache invalidation is now fingerprint
      comparison).
- [ ] Delete `getInvalidationPlan` / `getMetaInvalidationPlan` and the
      `DependencyTracker` class (subsumed by the graph), plus the file-type
      categorization block in `processChangeBatch`.
- [ ] Delete `content-hashes.json` / `nav-cache.json` read/write paths
      (`src/helper/contentHash.js` cache portions, `src/helper/build/navCache.js`) once
      their state lives in graph nodes. Keep `.ursa.json` content timestamps (they serve
      Recent Activity, not invalidation).
- [ ] Delete `regenerateSingleFile` / `regenerateAffectedDocuments` once serve runs on
      the graph.
- [ ] Update `USAGE.md` / `README.md`: `--clean` is corruption recovery, no longer a
      routine workaround.

## Acceptance criteria

All of the following currently fail (or fail intermittently) and must pass without
`--clean`, including on a **warm start** (second `serve` run against an existing
`.ursa/` cache):

1. Edit a `style.css` anywhere in the docroot → every page in that folder subtree
   reflects it on reload.
2. **Create** a brand-new `style.css` in a folder that had none → subtree regenerates.
3. Replace a static file in `meta/` (e.g. a PNG or font) → copied to output, affected
   pages reload.
4. Edit a meta template `.html` → all pages using that template regenerate.
5. Edit a meta CSS/JS asset → bundles rebuilt, all pages using the template pick up the
   new cache-busted reference.
6. Save file B while a large regeneration (triggered by file A) is still running → B's
   change is processed afterward, never lost.
7. Edit one article body → only that article's outputs regenerate; menu, nav, and other
   pages untouched (verify via pass logs).
8. A page regenerated in serve mode is byte-identical to the same page from a full
   `generate` run.
