/**
 * One incremental build pass (docs/SERVE.md §5), shared by `generate` and
 * `serve`.
 *
 *   1. Refresh the leaves the watcher flagged (or every leaf on a warm start).
 *   2. Pre-pass source mutation: document-template reconciliation.
 *   3. Establish the document set; drop nodes whose source is gone and delete
 *      the files they owned.
 *   4. Compute the dirty set (an upper bound) so clients can be told at once.
 *   5. Build: viewed pages first, then every page and asset, then the
 *      expensive non-blocking outputs (previews, indices).
 *   6. Delete orphaned outputs, persist the graph, report.
 *
 * Exactly one pass runs at a time; the caller (serve) serialises them.
 */

import { basename, dirname, join, relative } from "path";
import { rm, unlink, readdir, rmdir } from "fs/promises";
import { existsSync } from "fs";
import { emptyDir } from "fs-extra";

import { BuildGraph, loadGraph, saveGraph, isLeafId } from "./graph.js";
import { hashBytes } from "./tracedFs.js";
import {
  createSite, nodeId, parseNodeId,
  DOC_KINDS, DIR_KINDS, INTERNAL_KINDS, SITE_KINDS,
} from "./site.js";
import { ARTICLE_EXT_RE, AUTO_INDEX, candidatesForOutput, isHandwrittenHtml } from "./precedence.js";
import { getUrsaDir, enforceCacheVersion } from "../contentHash.js";
import { getUrsaVersion } from "../ursaVersion.js";
import { getAndIncrementBuildId } from "../ursaConfig.js";
import { readGitHash } from "./footer.js";
import { reconcileAll, reconcileByTemplate, isInsideTemplatesFolder, TEMPLATES_FOLDER } from "../documentTemplates.js";
import { recurse } from "../recursive-readdir.js";
import { isHiddenOrSystemPath } from "../hiddenPaths.js";
import { terminateParserPool } from "../fileRenderer.js";

const DEFAULT_CONCURRENCY = parseInt(process.env.URSA_BATCH_SIZE || "50", 10);
/** The fingerprint of a node whose value is null (see graph.js defaultValueFingerprint). */
const NULL_FINGERPRINT = hashBytes("null");

/**
 * Create a build: a graph plus the site's node definitions, ready to run passes.
 *
 * @param {object} opts
 * @param {string} opts.source - Docroot
 * @param {string} opts.meta - Meta directory
 * @param {string} opts.output - Output directory
 * @param {string|null} [opts.whitelist]
 * @param {string|null} [opts.exclude]
 * @param {boolean} [opts.clean] - Delete .ursa/ and empty the output first
 * @param {boolean} [opts.jsonOnly]
 * @param {boolean} [opts.explain] - Log, for each recomputed node, the input that moved
 * @param {number} [opts.concurrency]
 * @param {(msg: string) => void} [opts.log]
 */
export async function createBuild({
  source,
  meta,
  output,
  whitelist = null,
  exclude = null,
  clean = false,
  jsonOnly = false,
  explain = false,
  concurrency = DEFAULT_CONCURRENCY,
  log = (m) => console.log(m),
}) {
  source = source.replace(/\/+$/, "");
  meta = meta.replace(/\/+$/, "");
  output = output.replace(/\/+$/, "");

  if (clean) {
    const ursaDir = getUrsaDir(source);
    log(`Clean build: deleting cache folder ${ursaDir}`);
    await rm(ursaDir, { recursive: true, force: true });
    log(`Clean build: clearing output directory ${output}`);
    await emptyDir(output);
  }

  // A cache written by another ursa is discarded: the code that turned source
  // into output changed, and the graph cannot see that through its leaves.
  const stamp = await enforceCacheVersion(source);
  if (stamp.reset) {
    log(`Cache discarded: written by ursa ${stamp.previous ?? "(unstamped)"}, now running ${stamp.version}`);
  }

  // Orphan deletion: immediate while nodes are being removed before the
  // pass's writes, deferred (and re-checked) during the pass itself.
  let deferOrphans = false;
  let orphanQueue = [];
  let deletedCount = 0;
  const deleteOutputs = async (rels) => {
    for (const rel of rels) {
      const path = join(output, rel);
      try {
        await unlink(path);
        deletedCount++;
        log(`  🗑  ${rel}`);
      } catch {
        // already gone
      }
      await pruneEmptyDirs(dirname(path), output);
    }
  };
  const graph = new BuildGraph({
    onOrphans: async (paths) => {
      if (deferOrphans) orphanQueue.push(...paths);
      else await deleteOutputs(paths);
    },
  });
  graph.setRoots({ S: source, M: meta });

  let warm = false;
  if (!clean) {
    warm = await loadGraph(source, graph);
    if (warm) {
      const s = graph.getStats();
      log(`Build graph loaded: ${s.derivedNodes} nodes, ${s.leaves} leaves, ${s.edges} edges, ${s.owned} outputs`);
    }
  }
  graph.setConst("ursa-version", getUrsaVersion());
  graph.setConst("json-only", String(jsonOnly));

  const session = {
    buildId: getAndIncrementBuildId(source),
    now: new Date(),
    gitHash: readGitHash(source),
  };

  let writtenCount = 0;
  const warned = new Set();
  const env = {
    source, meta, output, whitelist, exclude, jsonOnly, session,
    log,
    warn: (key, msg) => {
      if (warned.has(key)) return;
      warned.add(key);
      console.warn(msg);
    },
    onWrite: () => { writtenCount++; },
  };
  const site = createSite(env);
  graph.resolver(site.resolve);

  let firstPass = true;

  /**
   * Run one pass.
   * @param {object} [opts]
   * @param {string[]} [opts.viewedOutputs] - Output paths (relative) clients are looking at, first
   * @param {(dirty: Set<string>, changedLeaves: string[]) => void} [opts.onDirty] - Called once the dirty set is known
   * @param {(id: string, err: Error|null) => void} [opts.onNodeDone] - Called as each root finishes
   * @param {() => string[]} [opts.moreViewed] - Re-read viewed outputs between phases (§6.3)
   * @param {boolean} [opts.rescan] - Re-check every known leaf instead of only those the
   *   watcher flagged (what a warm start does; for callers without a watcher)
   */
  async function runPass({ viewedOutputs = [], onDirty = null, onNodeDone = null, moreViewed = null, rescan = false } = {}) {
    const t0 = Date.now();
    const timings = {};
    const time = (name, start) => { timings[name] = Date.now() - start; };
    warned.clear();
    writtenCount = 0;
    deletedCount = 0;
    orphanQueue = [];
    deferOrphans = false;
    graph.beginPass();

    // 1. Leaves
    let t = Date.now();
    let changed = (firstPass && warm) || rescan ? await graph.scanLeaves() : await graph.refreshStale();
    time("leaves", t);

    // 2. Pre-pass: document templates (the only step that writes to the docroot)
    t = Date.now();
    const templateWrites = await reconcileTemplates(changed);
    if (templateWrites.length > 0) {
      for (const p of templateWrites) graph.invalidatePath(p);
      changed = [...new Set([...changed, ...(await graph.refreshStale())])];
    }
    time("templates", t);

    // 3. Document set and garbage collection (before any write: §8.5 case renames)
    t = Date.now();
    const set = await graph.demand(nodeId("documentSet"));
    const customMenus = jsonOnly ? [] : await graph.demand(nodeId("customMenus"));
    const metaAssets = jsonOnly ? { rels: [] } : await graph.demand(nodeId("metaAssets"));
    const templates = jsonOnly ? {} : await graph.demand(nodeId("templates"));
    await collectGarbage(set, customMenus, metaAssets, templates);
    time("gc", t);

    // 4. Dirty set: an upper bound, computed before any work
    const dirty = graph.dependents(changed);
    if (onDirty) onDirty(dirty, changed);
    deferOrphans = true;

    const failures = new Map();
    const done = (id, err) => {
      if (err) failures.set(id, err);
      if (onNodeDone) onNodeDone(id, err);
    };

    // 5a. Viewed pages first
    t = Date.now();
    const viewedNodes = await nodesForOutputs(viewedOutputs, set);
    if (viewedNodes.length > 0) {
      await graph.build(viewedNodes, { concurrency, onDone: done });
    }
    time("viewed", t);

    // 5b. Every page, then the assets they reference (a page may reference an
    // image outside the document set — the whitelist case — which is only
    // known once the page has been built)
    t = Date.now();
    const roots = pageRoots(set, customMenus, metaAssets, templates);
    const laterViewed = moreViewed ? await nodesForOutputs(moreViewed(), set) : [];
    await graph.build([...laterViewed, ...roots], { concurrency, onDone: done });
    await graph.build(assetRoots(set), { concurrency, onDone: done });
    time("pages", t);

    // 5c. Expensive, non-blocking outputs
    t = Date.now();
    await graph.build(expensiveRoots(set), { concurrency, onDone: done });
    time("indices", t);

    // 6. Orphans, persistence
    t = Date.now();
    deferOrphans = false;
    await flushOrphans();
    await saveGraph(source, graph);
    time("finish", t);

    const computed = new Set(graph._computedThisPass);
    const changedNodes = new Set(graph._changedThisPass);
    graph.endPass();
    firstPass = false;

    const summary = {
      changedLeaves: changed,
      dirty,
      computed,
      changedNodes,
      failures,
      written: writtenCount,
      deleted: deletedCount,
      timings,
      elapsed: Date.now() - t0,
      viewedNodes,
    };
    report(summary);
    return summary;
  }

  // -------------------------------------------------------------------------

  /** Reconcile `_templates` instances. Returns docroot files written. */
  async function reconcileTemplates(changedLeaves) {
    const templatesDir = join(source, TEMPLATES_FOLDER);
    if (!existsSync(templatesDir)) return [];
    const changedTemplates = changedLeaves
      .filter(isLeafId)
      .map((id) => graph.leafPath(id))
      .filter((p) => isInsideTemplatesFolder(relative(source, p)) || p.startsWith(templatesDir + "/"));
    if (!firstPass && changedTemplates.length === 0) return [];

    const allFiles = await recurse(source);
    const articles = allFiles.filter((f) => ARTICLE_EXT_RE.test(f) && !isHiddenOrSystemPath(f, source));
    let summary;
    if (firstPass) {
      summary = await reconcileAll(articles, allFiles, source);
    } else {
      summary = { initialized: 0, updated: 0, conflicts: 0, unchanged: 0, errors: 0, affectedPaths: new Set(), messages: [] };
      for (const tpl of new Set(changedTemplates)) {
        if (!existsSync(tpl) || !ARTICLE_EXT_RE.test(tpl)) continue;
        const s = await reconcileByTemplate(tpl, articles, source);
        for (const k of ["initialized", "updated", "conflicts", "unchanged", "errors"]) summary[k] += s[k];
        for (const p of s.affectedPaths) summary.affectedPaths.add(p);
        summary.messages.push(...s.messages);
      }
    }
    if (summary.updated > 0 || summary.conflicts > 0 || summary.initialized > 0) {
      log(
        `📄 Document templates: ${summary.initialized} initialized, ${summary.updated} auto-merged, ` +
        `${summary.conflicts} conflicts, ${summary.unchanged} unchanged, ${summary.errors} errors`
      );
      if (summary.conflicts > 0) {
        console.warn(`\n⚠️  Template conflicts require manual resolution:`);
        for (const msg of summary.messages) if (msg.includes("Conflict")) console.warn(`   ${msg}`);
        console.warn("");
      }
    }
    if (summary.errors > 0) {
      for (const msg of summary.messages) {
        if (msg.includes("Error") || msg.includes("not found")) console.warn(`   ⚠️  ${msg}`);
      }
    }
    return [...summary.affectedPaths];
  }

  /**
   * Remove nodes whose key left the document set (their outputs are deleted),
   * then internal nodes nothing depends on any more.
   */
  async function collectGarbage(set, customMenus, metaAssets, templates = {}) {
    const dirs = new Set(["", ...set.dirs]);
    const templateNames = new Set(Object.keys(templates));
    const menus = new Set(customMenus);
    const metaRels = new Set(metaAssets.rels ?? []);
    const referencedImages = () => {
      const out = new Set();
      for (const id of graph.rdeps.keys()) {
        if (id.startsWith("imageInfo:") && graph.rdeps.get(id)?.size > 0) out.add(parseNodeId(id).key);
      }
      return out;
    };
    let referenced = referencedImages();
    const keepKeyed = (id) => {
      if (isLeafId(id)) return true;
      const { kind, key } = parseNodeId(id);
      if (SITE_KINDS.includes(kind) || INTERNAL_KINDS.includes(kind)) return true;
      if (DOC_KINDS.includes(kind)) return set.articleSet.has(key);
      if (DIR_KINDS.includes(kind)) return dirs.has(key);
      if (kind === "htmlPassthrough") return set.htmlSet.has(key);
      if (kind === "staticAsset") return set.mediaSet.has(key);
      if (kind === "imageCopy" || kind === "imagePreview") return set.imageSet.has(key) || referenced.has(key);
      if (kind === "customMenu") return menus.has(key);
      return true;
    };
    await graph.gc(keepKeyed);
    // Internal families: kept only while something depends on them
    referenced = referencedImages();
    await graph.gc((id) => {
      if (isLeafId(id)) return true;
      const { kind } = parseNodeId(id);
      if (!INTERNAL_KINDS.includes(kind)) return true;
      if (kind === "metaAsset") return metaRels.has(parseNodeId(id).key) || graph.rdeps.get(id)?.size > 0;
      if (kind === "metaBundle") return templateNames.has(parseNodeId(id).key) || graph.rdeps.get(id)?.size > 0;
      if (kind === "docMeta") return set.articleSet.has(parseNodeId(id).key) || graph.rdeps.get(id)?.size > 0;
      return graph.rdeps.get(id)?.size > 0;
    });
    // imageCopy/imagePreview for images that were only referenced may now be unreferenced
    await graph.gc((id) => {
      if (isLeafId(id)) return true;
      const { kind, key } = parseNodeId(id);
      if (kind === "imageCopy" || kind === "imagePreview") return set.imageSet.has(key) || referenced.has(key);
      return true;
    });
  }

  /** Roots for phase 5b, in a stable order. */
  function pageRoots(set, customMenus, metaAssets, templates) {
    const ids = [];
    if (jsonOnly) {
      for (const d of set.articles) ids.push(nodeId("docData", d));
      return ids;
    }
    for (const rel of metaAssets.rels) ids.push(nodeId("metaAsset", rel));
    // Every template's bundles exist whether or not a page uses it yet
    for (const t of Object.keys(templates).sort()) ids.push(nodeId("metaBundle", t));
    ids.push(nodeId("reactRuntime"));
    for (const d of set.articles) ids.push(nodeId("pageHtml", d));
    for (const h of set.html) ids.push(nodeId("htmlPassthrough", h));
    for (const dir of ["", ...set.dirs]) ids.push(nodeId("autoIndexPage", dir));
    for (const dir of set.dirs) ids.push(nodeId("dirListingHtml", dir));
    ids.push(nodeId("menuData"));
    for (const d of customMenus) ids.push(nodeId("customMenu", d));
    for (const d of set.articles) ids.push(nodeId("docData", d));
    return ids;
  }

  /** Copied assets: images (in the set or referenced by a page) and media. */
  function assetRoots(set) {
    if (jsonOnly) return [];
    const ids = [];
    for (const img of imageRoots(set)) ids.push(nodeId("imageCopy", img));
    for (const m of set.media) ids.push(nodeId("staticAsset", m));
    return ids;
  }

  /** Roots for phase 5c. */
  function expensiveRoots(set) {
    const ids = [];
    for (const dir of set.dirs) ids.push(nodeId("dirIndexJson", dir));
    if (jsonOnly) return ids;
    for (const img of imageRoots(set)) ids.push(nodeId("imagePreview", img));
    ids.push(nodeId("searchIndex"), nodeId("fullTextIndex"), nodeId("recentActivity"));
    return ids;
  }

  /** Images in the set, plus images pages reference that the set excludes (whitelist). */
  function imageRoots(set) {
    const out = new Set(set.images);
    for (const id of graph.rdeps.keys()) {
      if (!id.startsWith("imageInfo:") || !(graph.rdeps.get(id)?.size > 0)) continue;
      // A referenced image that is known not to exist has nothing to copy
      if (graph.fingerprints.get(id) === NULL_FINGERPRINT) continue;
      out.add(parseNodeId(id).key);
    }
    return [...out].sort();
  }

  /**
   * The node that owns an output path (relative to the output directory):
   * from the persisted ownership table when known, else from precedence.
   */
  async function nodeForOutput(outRel, set) {
    const known = graph.ownerOfPath(outRel);
    if (known) return known;
    if (!outRel.endsWith(".html")) return null;
    const owner = await graph.demand(nodeId("outputOwner", outRel));
    const dir = dirname(outRel) === "." ? "" : dirname(outRel);
    if (owner === AUTO_INDEX) return nodeId("autoIndexPage", dir);
    if (owner === null) {
      // <dir>.html listing, if the path names a directory
      const base = basename(outRel, ".html");
      const dirRel = dir ? `${dir}/${base}` : base;
      return set.dirSet.has(dirRel) ? nodeId("dirListingHtml", dirRel) : null;
    }
    if (isHandwrittenHtml(owner)) return nodeId("htmlPassthrough", owner);
    return nodeId("pageHtml", owner);
  }

  async function nodesForOutputs(outRels, set) {
    const ids = [];
    for (const rel of outRels) {
      const id = await nodeForOutput(rel, set);
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  /** Delete orphans queued during the pass, unless the path is owned again (case-insensitively). */
  async function flushOrphans() {
    if (orphanQueue.length === 0) return;
    const ownedLower = new Set([...graph.ownerOf.keys()].map((p) => p.toLowerCase()));
    const toDelete = [...new Set(orphanQueue)].filter((p) => !graph.ownerOf.has(p) && !ownedLower.has(p.toLowerCase()));
    orphanQueue = [];
    await deleteOutputs(toDelete);
  }

  function report(summary) {
    const byKind = (ids) => {
      const counts = new Map();
      for (const id of ids) {
        const k = isLeafId(id) ? id.slice(0, id.indexOf(":")) : parseNodeId(id).kind;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return [...counts].sort().map(([k, n]) => `${k}×${n}`).join(", ");
    };
    const parts = [];
    if (summary.changedLeaves.length > 0) parts.push(`leaves: ${byKind(summary.changedLeaves)}`);
    if (summary.dirty.size > 0) parts.push(`dirty: ${byKind(summary.dirty)}`);
    parts.push(`changed: ${summary.changedNodes.size ? byKind(summary.changedNodes) : "nothing"}`);
    const restored = summary.computed.size - summary.changedNodes.size;
    if (restored > 0) parts.push(`restored ${restored}`);
    parts.push(`wrote ${summary.written}, deleted ${summary.deleted}`);
    const phases = Object.entries(summary.timings).map(([k, v]) => `${k} ${v}ms`).join(", ");
    log(`⏱  Pass ${summary.elapsed}ms (${phases}) — ${parts.join("; ")}`);
    if (summary.viewedNodes.length > 0) log(`   viewed first: ${summary.viewedNodes.join(", ")}`);
    for (const [id, err] of summary.failures) {
      console.error(`   ✗ ${id}: ${err.cause?.message ?? err.message}`);
    }
    if (explain) {
      for (const id of summary.changedNodes) {
        const why = graph.reasons.get(id);
        if (why) log(`   ↻ ${id} ← ${why}`);
      }
    }
  }

  return {
    graph,
    env,
    site,
    runPass,
    nodeForOutput: (outRel) => nodeForOutput(outRel, graph.values.get(nodeId("documentSet")) ?? { dirSet: new Set() }),
    /** Node ids owning a page or a soft-closure JSON that a page consumes. */
    candidatesForOutput,
    async close() {
      await terminateParserPool();
    },
  };
}

/** Remove now-empty directories from `dir` up to (not including) `stop`. */
async function pruneEmptyDirs(dir, stop) {
  while (dir.startsWith(stop + "/")) {
    try {
      const entries = await readdir(dir);
      if (entries.length > 0) return;
      await rmdir(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}
