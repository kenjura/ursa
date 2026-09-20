/**
 * Incremental build graph for Ursa (Make/Shake/Salsa semantics).
 *
 * Every output is a derived node; a node recomputes if and only if one of its
 * recorded input fingerprints changed. See docs/SERVE.md §4–5.
 *
 * Concepts:
 * - Leaf nodes are observed facts about the filesystem: a file's content
 *   (`file:`), a path's existence (`lookup:`), a directory's listing (`dir:`).
 *   They are created implicitly when a compute function touches the disk —
 *   through `ctx.read` / `ctx.exists` / `ctx.listDir`, or through any helper
 *   that imports its fs calls from tracedFs.js while the node is computing.
 *   Lookup leaves make file *creation* an observable change: probing for a
 *   style.css that isn't there records an edge that dirties the subtree when
 *   the file appears. Directory leaves make add/remove/rename observable
 *   without depending on any file's content.
 * - Derived nodes are registered with `graph.node(id, fn)`, or resolved on
 *   demand from a family resolver (`graph.resolver(id => fn)`) so that
 *   `pageHtml:<doc>` exists for whatever documents the source tree holds.
 *   Edges are recorded fresh on every recompute (replace, not append), so
 *   dynamic dependencies — which template a doc's frontmatter selects — are
 *   always correct and can shrink.
 * - Early cutoff: after a recompute, the node's own fingerprint is derived
 *   from its value. If it is unchanged, dependents' recorded fingerprints
 *   still match and propagation stops.
 * - Verification is demand-driven and topological: verifying a node verifies
 *   its recorded dependencies first. `build(roots)` verifies roots in the
 *   given order, so callers can schedule client-viewed pages first. Roots may
 *   be verified concurrently; a node demanded by two roots at once is
 *   computed once.
 * - Output ownership: a compute function declares the files it wrote with
 *   `ctx.own(path)`. When a node's owned set shrinks, or the node is removed,
 *   the files no longer owned are handed to `onOrphans` for deletion. Every
 *   file in the output directory is owned by exactly one node.
 * - Values live in memory only. Persistence stores {edges, fingerprints,
 *   leafStats, owned}; after a restart a clean node is *verified* without
 *   recompute, and is only recomputed if a dependent actually demands its
 *   value.
 *
 * Compute functions should be deterministic. Non-determinism (timestamps,
 * randomness) degrades to extra recomputes, never to staleness across passes.
 * To force global invalidation on Ursa upgrades, wire the version in as a
 * leaf (see `versionLeaf`) rather than versioning nodes.
 */

import { existsSync } from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import fsp from "fs/promises";
import { dirname, join } from "path";
import { getUrsaDir } from "../contentHash.js";
import {
  ABSENT,
  EXISTS,
  MISSING,
  dirFingerprintFromEntries,
  hashBytes,
  isIgnoredDirEntry,
  withRecorder,
} from "./tracedFs.js";

export const GRAPH_SCHEMA_VERSION = 3;
const GRAPH_FILE = "graph.json";

const FILE_PREFIX = "file:";
const LOOKUP_PREFIX = "lookup:";
const DIR_PREFIX = "dir:";
const CONST_PREFIX = "const:";

export function fileNodeId(path) {
  return FILE_PREFIX + path;
}

export function lookupNodeId(path) {
  return LOOKUP_PREFIX + path;
}

export function dirNodeId(path) {
  return DIR_PREFIX + path;
}

/** A constant leaf (e.g. `const:ursa-version`) whose fingerprint is set by the caller. */
export function constNodeId(name) {
  return CONST_PREFIX + name;
}

export function isLeafId(id) {
  return (
    id.startsWith(FILE_PREFIX) ||
    id.startsWith(LOOKUP_PREFIX) ||
    id.startsWith(DIR_PREFIX) ||
    id.startsWith(CONST_PREFIX)
  );
}

function leafKind(id) {
  if (id.startsWith(FILE_PREFIX)) return "file";
  if (id.startsWith(LOOKUP_PREFIX)) return "lookup";
  if (id.startsWith(DIR_PREFIX)) return "dir";
  if (id.startsWith(CONST_PREFIX)) return "const";
  return null;
}

function leafRawPath(id) {
  return id.slice(id.indexOf(":") + 1);
}

function defaultValueFingerprint(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return hashBytes(value);
  return hashBytes(JSON.stringify(value) ?? "null");
}

/** Error thrown when a compute function fails; wraps the original error. */
export class GraphComputeError extends Error {
  constructor(nodeId, cause) {
    super(`Node "${nodeId}" failed: ${cause?.message ?? cause}`);
    this.name = "GraphComputeError";
    this.nodeId = nodeId;
    this.cause = cause;
  }
}

export class BuildGraph {
  /**
   * @param {{onOrphans?: (paths: string[], nodeId: string) => Promise<void>|void}} [opts]
   *   onOrphans receives output paths a node stopped owning (or owned when removed).
   */
  constructor({ onOrphans = null } = {}) {
    /** @type {Map<string, {fn: Function, fingerprint?: Function}>} derived node definitions */
    this.fns = new Map();
    /** @type {((id: string) => ({fn: Function, fingerprint?: Function}|null))|null} */
    this._resolver = null;
    /** @type {Map<string, any>} last computed values (in-memory only, not persisted) */
    this.values = new Map();
    /** @type {Map<string, string>} node id → current fingerprint (persisted) */
    this.fingerprints = new Map();
    /** @type {Map<string, Map<string, string>>} node id → (dep id → fingerprint recorded when read) (persisted) */
    this.edges = new Map();
    /** @type {Map<string, Set<string>>} dep id → dependent node ids (derived from edges) */
    this.rdeps = new Map();
    /** @type {Map<string, {size: number, mtimeMs: number}>} file leaf id → stat fast-path info (persisted) */
    this.leafStats = new Map();
    /** @type {Map<string, string[]>} node id → output paths it owns (persisted) */
    this.owned = new Map();
    /** @type {Map<string, string>} output path → owning node id (derived from owned) */
    this.ownerOf = new Map();
    /** @type {Map<string, string>} node id → error message for nodes whose last compute threw */
    this.failed = new Map();
    /** @type {Map<string, string>} node id → the input whose fingerprint moved (for --explain) */
    this.reasons = new Map();

    this.onOrphans = onOrphans;

    /**
     * Path roots for relocatable leaf ids: a leaf under roots.S is stored as
     * `$S/rel`, so a graph persisted in `.ursa/` survives the docroot moving.
     * @type {Record<string, string>}
     */
    this.roots = {};

    /** @type {Set<string>} leaf ids the watcher reported changed since last verification */
    this._staleLeaves = new Set();
    // Per-pass state
    this._verified = null;
    this._pending = null;
    this._computedThisPass = new Set();
    /** @type {Set<string>} nodes computed this pass whose fingerprint moved (or that were new) */
    this._changedThisPass = new Set();
    this._passOpen = false;
  }

  // -------------------------------------------------------------------------
  // Definition
  // -------------------------------------------------------------------------

  /**
   * Define (or replace) a derived node.
   * @param {string} id - Node id, by convention "kind:key" (e.g. "pageHtml:docs/a.md")
   * @param {(ctx: {read: Function, exists: Function, listDir: Function, get: Function, own: Function}) => Promise<any>} fn
   * @param {{fingerprint?: (value: any) => string}} [opts] - Custom value fingerprint
   */
  node(id, fn, opts = {}) {
    if (isLeafId(id)) throw new Error(`Cannot define a derived node with a leaf id: ${id}`);
    this.fns.set(id, { fn, fingerprint: opts.fingerprint });
  }

  /**
   * Install a resolver for node families. Called with an unknown node id, it
   * returns `{fn, fingerprint?}` or null. Resolved definitions are memoized.
   */
  resolver(fn) {
    this._resolver = fn;
  }

  _def(id) {
    let def = this.fns.get(id);
    if (!def && this._resolver && !isLeafId(id)) {
      def = this._resolver(id);
      if (def) this.fns.set(id, def);
    }
    return def ?? null;
  }

  hasNode(id) {
    return this._def(id) !== null;
  }

  /**
   * Path roots for relocatable ids: `setRoots({S: source, M: meta})`.
   * Must be set before any compute and before `load()`.
   */
  setRoots(roots) {
    this.roots = { ...roots };
  }

  /** Absolute path → stored leaf path (`$S/rel` under a root). */
  encodePath(abs) {
    for (const [key, root] of Object.entries(this.roots)) {
      const r = root.endsWith("/") ? root.slice(0, -1) : root;
      if (abs === r) return `$${key}`;
      if (abs.startsWith(r + "/")) return `$${key}${abs.slice(r.length)}`;
    }
    return abs;
  }

  /** Stored leaf path → absolute path. */
  decodePath(stored) {
    if (stored.startsWith("$")) {
      const slash = stored.indexOf("/");
      const key = slash === -1 ? stored.slice(1) : stored.slice(1, slash);
      const root = this.roots[key];
      if (root) {
        const r = root.endsWith("/") ? root.slice(0, -1) : root;
        return slash === -1 ? r : r + stored.slice(slash);
      }
    }
    return stored;
  }

  /** Absolute path of a leaf id. */
  leafPath(id) {
    return this.decodePath(leafRawPath(id));
  }

  /** Set a constant leaf's fingerprint (e.g. the running ursa version). */
  setConst(name, value) {
    const id = constNodeId(name);
    this.fingerprints.set(id, String(value));
    this._staleLeaves.delete(id);
  }

  // -------------------------------------------------------------------------
  // Removal and ownership
  // -------------------------------------------------------------------------

  /**
   * Remove a derived node (e.g. its source document was deleted). Files it
   * owned are handed to `onOrphans`. Dependents holding a recorded edge to it
   * will recompute on next verify.
   */
  async removeNode(id) {
    this.fns.delete(id);
    this.values.delete(id);
    this.fingerprints.delete(id);
    this.failed.delete(id);
    this.reasons.delete(id);
    const deps = this.edges.get(id);
    if (deps) {
      for (const depId of deps.keys()) {
        const set = this.rdeps.get(depId);
        if (set) {
          set.delete(id);
          if (set.size === 0) this.rdeps.delete(depId);
        }
      }
      this.edges.delete(id);
    }
    await this._setOwned(id, []);
  }

  /**
   * Drop persisted state for derived nodes not in keepIds (e.g. deleted
   * documents), then drop leaves no longer referenced by any edge.
   * @param {Set<string>|((id: string) => boolean)} keep - Node ids (or predicate) that survive
   */
  async gc(keep) {
    const keeps = typeof keep === "function" ? keep : (id) => keep.has(id);
    const candidates = new Set([...this.edges.keys(), ...this.fingerprints.keys(), ...this.owned.keys()]);
    for (const id of candidates) {
      if (!isLeafId(id) && !keeps(id)) await this.removeNode(id);
    }
    // Orphaned leaves: no remaining dependents
    for (const id of [...this.fingerprints.keys()]) {
      if (isLeafId(id) && !this.rdeps.has(id) && leafKind(id) !== "const") {
        this.fingerprints.delete(id);
        this.leafStats.delete(id);
        this._staleLeaves.delete(id);
      }
    }
  }

  /** Output paths a node owns. */
  ownedBy(id) {
    return this.owned.get(id) ?? [];
  }

  /** The node owning an output path, if any. */
  ownerOfPath(path) {
    return this.ownerOf.get(path) ?? null;
  }

  async _setOwned(id, paths) {
    const before = this.owned.get(id) ?? [];
    const after = [...new Set(paths)].sort();
    const afterSet = new Set(after);
    const orphans = before.filter((p) => !afterSet.has(p));
    for (const p of before) if (this.ownerOf.get(p) === id) this.ownerOf.delete(p);
    if (after.length > 0) {
      this.owned.set(id, after);
      for (const p of after) this.ownerOf.set(p, id);
    } else {
      this.owned.delete(id);
    }
    if (orphans.length > 0 && this.onOrphans) {
      // A path that another node now owns is not an orphan (ownership moved)
      const truly = orphans.filter((p) => !this.ownerOf.has(p));
      if (truly.length > 0) await this.onOrphans(truly, id);
    }
  }

  // -------------------------------------------------------------------------
  // Invalidation
  // -------------------------------------------------------------------------

  /**
   * Watcher hook: a path event. Marks the file, lookup and parent-directory
   * leaves as needing a re-check before they are next trusted.
   * @param {string} path - Absolute path reported by the file watcher
   */
  invalidatePath(path) {
    const stored = this.encodePath(path);
    this._staleLeaves.add(fileNodeId(stored));
    this._staleLeaves.add(lookupNodeId(stored));
    this._staleLeaves.add(dirNodeId(stored));
    this._staleLeaves.add(dirNodeId(this.encodePath(dirname(path))));
  }

  /**
   * Watcher hook for a directory event: every known leaf beneath the path is
   * re-checked (a renamed folder reports one event, for the folder).
   * @param {string} path - Absolute directory path
   */
  invalidateSubtree(path) {
    this.invalidateSubtrees([path]);
  }

  /** As invalidateSubtree, for several paths in one sweep of the known leaves. */
  invalidateSubtrees(paths) {
    if (paths.length === 0) return;
    const prefixes = [];
    for (const path of paths) {
      this.invalidatePath(path);
      prefixes.push(this.encodePath(path) + "/");
    }
    for (const id of this.fingerprints.keys()) {
      if (!isLeafId(id) || leafKind(id) === "const") continue;
      const raw = leafRawPath(id);
      for (const prefix of prefixes) {
        if (raw.startsWith(prefix)) {
          this._staleLeaves.add(id);
          break;
        }
      }
    }
  }

  /**
   * Refresh every stale leaf (the ones the watcher flagged) and return the
   * ids whose fingerprint actually changed. Unknown stale leaves (never
   * recorded by any node) are dropped: nothing depends on them.
   * @returns {Promise<string[]>}
   */
  async refreshStale() {
    const changed = [];
    const stale = [...this._staleLeaves];
    this._staleLeaves.clear();
    for (const id of stale) {
      if (!this.fingerprints.has(id)) continue;
      const before = this.fingerprints.get(id);
      await this._refreshLeaf(id, { force: true });
      if (this.fingerprints.get(id) !== before) changed.push(id);
    }
    return changed;
  }

  /**
   * Re-check every known leaf (warm start). Uses the size+mtime fast path and
   * only re-hashes content when the stat changed. Returns leaf ids whose
   * fingerprint actually changed.
   * @returns {Promise<string[]>}
   */
  async scanLeaves() {
    const changed = [];
    for (const id of [...this.fingerprints.keys()]) {
      if (!isLeafId(id) || leafKind(id) === "const") continue;
      const before = this.fingerprints.get(id);
      await this._refreshLeaf(id, { force: true });
      if (this.fingerprints.get(id) !== before) changed.push(id);
    }
    this._staleLeaves.clear();
    return changed;
  }

  /**
   * Every derived node that transitively depends on any of the given ids.
   * An upper bound on what a pass will recompute (early cutoff trims it).
   * @param {Iterable<string>} ids
   * @returns {Set<string>}
   */
  dependents(ids) {
    const out = new Set();
    const stack = [...ids];
    while (stack.length > 0) {
      const cur = stack.pop();
      const deps = this.rdeps.get(cur);
      if (!deps) continue;
      for (const d of deps) {
        if (out.has(d)) continue;
        out.add(d);
        stack.push(d);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Building
  // -------------------------------------------------------------------------

  /** Begin a pass: nothing verified yet. Idempotent while a pass is open. */
  beginPass() {
    if (this._passOpen) return;
    this._verified = new Set();
    this._pending = new Map();
    this._computedThisPass = new Set();
    this._changedThisPass = new Set();
    this.reasons = new Map();
    this._passOpen = true;
  }

  /** End a pass. */
  endPass() {
    this._passOpen = false;
    this._verified = null;
    this._pending = null;
  }

  /**
   * Bring the given nodes (and everything they depend on) up to date, in
   * order — schedule client-viewed pages first for priority regeneration.
   * A node whose compute function throws is marked failed (and retried next
   * pass) without corrupting the rest of the graph.
   *
   * When called inside an open pass (beginPass), verification state is shared
   * with earlier build() calls of the same pass; otherwise this call is a
   * pass of its own.
   *
   * @param {string[]} rootIds
   * @param {{concurrency?: number, onDone?: (id: string, err: Error|null) => void}} [opts]
   * @returns {Promise<{ok: boolean, results: Map<string, any>, errors: Map<string, Error>, computed: Set<string>}>}
   */
  async build(rootIds, { concurrency = 1, onDone = null } = {}) {
    const ownPass = !this._passOpen;
    if (ownPass) this.beginPass();
    const results = new Map();
    const errors = new Map();
    const queue = [...rootIds];
    const worker = async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        try {
          await this._verify(id, new Set());
          results.set(id, this.values.get(id));
          if (onDone) await onDone(id, null);
        } catch (e) {
          errors.set(id, e);
          if (onDone) await onDone(id, e);
        }
      }
    };
    const n = Math.max(1, Math.min(concurrency, queue.length || 1));
    await Promise.all(Array.from({ length: n }, worker));
    const computed = new Set(this._computedThisPass);
    if (ownPass) this.endPass();
    return { ok: errors.size === 0, results, errors, computed };
  }

  /**
   * Verify a node and return its value, recomputing if the value is not in
   * memory (e.g. after a restart). Usable standalone or during a build pass.
   * @param {string} id
   */
  async demand(id) {
    const ownPass = !this._passOpen;
    if (ownPass) this.beginPass();
    try {
      await this._verify(id, new Set());
      if (!this.values.has(id) && this._def(id)) {
        await this._compute(id, new Set([id]));
      }
      return this.values.get(id);
    } finally {
      if (ownPass) this.endPass();
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Ensure a node is up to date: verify its recorded deps (topologically),
   * recompute when any recorded input fingerprint differs from current.
   * `chain` is the set of ids on the current verification path (cycle check);
   * concurrent verifications of the same node share one promise.
   */
  async _verify(id, chain) {
    if (this._verified.has(id)) return;
    if (chain.has(id)) throw new Error(`Dependency cycle detected at "${id}"`);
    const pending = this._pending.get(id);
    if (pending) return pending;

    const p = this._verifyUncached(id, chain).finally(() => {
      if (this._pending?.get(id) === p) this._pending.delete(id);
    });
    this._pending.set(id, p);
    return p;
  }

  async _verifyUncached(id, chain) {
    if (isLeafId(id)) {
      await this._refreshLeaf(id);
      this._verified.add(id);
      return;
    }

    const def = this._def(id);
    if (!def) throw new Error(`Unknown node: "${id}"`);

    const nextChain = new Set(chain);
    nextChain.add(id);
    let needsCompute = false;
    let reason = null;
    const deps = this.edges.get(id);
    if (!this.fingerprints.has(id)) {
      needsCompute = true;
      reason = "never computed";
    } else if (this.failed.has(id)) {
      needsCompute = true;
      reason = "failed last pass";
    } else if (!deps) {
      needsCompute = true;
      reason = "no recorded inputs";
    } else {
      for (const [depId, recordedFp] of deps) {
        if (!isLeafId(depId) && !this._def(depId)) {
          needsCompute = true;
          reason = `input ${depId} no longer defined`;
          break;
        }
        await this._verify(depId, nextChain);
        if (this.fingerprints.get(depId) !== recordedFp) {
          needsCompute = true;
          reason = depId;
          break;
        }
      }
    }
    if (needsCompute) {
      this.reasons.set(id, reason);
      await this._compute(id, nextChain);
    }
    this._verified.add(id);
  }

  /** Run a node's compute function, recording fresh edges as inputs are consumed. */
  async _compute(id, chain) {
    const def = this._def(id);
    if (!def) throw new Error(`Unknown node: "${id}"`);
    const depMap = new Map();
    const owns = [];
    const ctx = this._makeCtx(depMap, owns, chain);

    let value;
    try {
      value = await withRecorder(ctx._recorder, () => def.fn(ctx));
    } catch (e) {
      // Mark failed; keep previous edges/fingerprint/ownership intact so the
      // graph is not corrupted. The node is retried on the next pass.
      this.failed.set(id, String(e?.message ?? e));
      throw e instanceof GraphComputeError ? e : new GraphComputeError(id, e);
    }

    this.failed.delete(id);
    this._setEdges(id, depMap);
    await this._setOwned(id, owns);
    this.values.set(id, value);
    const oldFp = this.fingerprints.get(id);
    const newFp = (def.fingerprint ?? defaultValueFingerprint)(value);
    this.fingerprints.set(id, newFp);
    this._computedThisPass.add(id);
    if (oldFp !== newFp) this._changedThisPass.add(id);
    if (oldFp !== undefined && oldFp !== newFp) {
      // Fingerprint moved mid-pass (normally only when an input changed):
      // anything already verified that depends on this must be re-checked.
      this._unverifyDependents(id);
    }
    return value;
  }

  /** Compute context handed to node functions; records edges as they are consumed. */
  _makeCtx(depMap, owns, chain) {
    const graph = this;
    const recorder = {
      /** tracedFs hook: reuse a known content hash when size+mtime match (skips re-hashing). */
      knownFileFingerprint(absPath, stats) {
        const id = fileNodeId(graph.encodePath(absPath));
        const prev = graph.leafStats.get(id);
        const fp = graph.fingerprints.get(id);
        if (prev && fp && fp !== MISSING && prev.size === stats.size && prev.mtimeMs === stats.mtimeMs) {
          return fp;
        }
        return undefined;
      },
      file(absPath, fp, stats) {
        const id = fileNodeId(graph.encodePath(absPath));
        if (stats) graph.leafStats.set(id, stats);
        else graph.leafStats.delete(id);
        graph.fingerprints.set(id, fp);
        graph._markLeafFresh(id);
        depMap.set(id, fp);
      },
      lookup(absPath, fp) {
        const id = lookupNodeId(graph.encodePath(absPath));
        graph.fingerprints.set(id, fp);
        graph._markLeafFresh(id);
        depMap.set(id, fp);
      },
      dir(absPath, fp) {
        const id = dirNodeId(graph.encodePath(absPath));
        graph.fingerprints.set(id, fp);
        graph._markLeafFresh(id);
        depMap.set(id, fp);
      },
    };
    return {
      _recorder: recorder,
      /** Read a file (utf8), recording a file-leaf dependency. Throws if missing (the miss is still recorded). */
      async read(path, encoding = "utf8") {
        let st;
        try {
          st = await stat(path);
        } catch (e) {
          recorder.file(path, MISSING, null);
          throw e;
        }
        const stats = { size: st.size, mtimeMs: st.mtimeMs };
        const known = recorder.knownFileFingerprint(path, stats);
        const buf = await readFile(path);
        recorder.file(path, known ?? hashBytes(buf), stats);
        return encoding === null ? buf : buf.toString(encoding);
      },
      /** Probe for a path's existence, recording a lookup-leaf dependency. */
      exists(path) {
        const found = existsSync(path);
        recorder.lookup(path, found ? EXISTS : ABSENT);
        return found;
      },
      /**
       * List a directory's build-input entries (sorted, with kind), recording
       * a dir-leaf dependency. A missing directory lists as [].
       * @returns {Promise<{name: string, kind: 'file'|'dir'|'other'}[]>}
       */
      async listDir(path) {
        let entries;
        try {
          entries = await fsp.readdir(path, { withFileTypes: true });
        } catch {
          recorder.dir(path, MISSING);
          return [];
        }
        recorder.dir(path, dirFingerprintFromEntries(entries));
        return entries
          .filter((e) => !isIgnoredDirEntry(e.name))
          .map((e) => ({
            name: e.name,
            kind: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
          }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      },
      /** Depend on a constant leaf (e.g. the ursa version). */
      constant(name) {
        const id = constNodeId(name);
        const fp = graph.fingerprints.get(id) ?? "";
        graph._markLeafFresh(id);
        depMap.set(id, fp);
        return fp;
      },
      /** Get another node's value, recording a derived dependency. */
      async get(otherId) {
        await graph._verify(otherId, chain);
        if (!graph.values.has(otherId) && graph._def(otherId)) {
          // Clean but value not in memory (restart) — recompute on demand
          await graph._compute(otherId, new Set([...chain, otherId]));
        }
        depMap.set(otherId, graph.fingerprints.get(otherId));
        return graph.values.get(otherId);
      },
      /** Declare an output file this node wrote and therefore owns. */
      own(path) {
        owns.push(path);
      },
    };
  }

  _markLeafFresh(id) {
    if (this._verified) this._verified.add(id);
    this._staleLeaves.delete(id);
  }

  /** Replace a node's recorded edges (deps can shrink), keeping rdeps in sync. */
  _setEdges(id, depMap) {
    const old = this.edges.get(id);
    if (old) {
      for (const depId of old.keys()) {
        if (!depMap.has(depId)) {
          const set = this.rdeps.get(depId);
          if (set) {
            set.delete(id);
            if (set.size === 0) this.rdeps.delete(depId);
          }
        }
      }
    }
    for (const depId of depMap.keys()) {
      if (!this.rdeps.has(depId)) this.rdeps.set(depId, new Set());
      this.rdeps.get(depId).add(id);
    }
    this.edges.set(id, depMap);
  }

  /** Remove a node's transitive dependents from this pass's verified set. */
  _unverifyDependents(id) {
    const stack = [id];
    const seen = new Set();
    while (stack.length > 0) {
      const cur = stack.pop();
      const dependents = this.rdeps.get(cur);
      if (!dependents) continue;
      for (const dep of dependents) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        this._verified.delete(dep);
        stack.push(dep);
      }
    }
  }

  /**
   * Refresh a leaf's fingerprint. File leaves use the size+mtime fast path
   * and re-hash content only on stat mismatch; lookup leaves re-probe
   * existence; directory leaves re-list. Unless forced (scanLeaves) or
   * flagged stale (invalidatePath), an already-known leaf is trusted.
   */
  async _refreshLeaf(id, { force = false } = {}) {
    const kind = leafKind(id);
    if (kind === "const") return;
    const path = this.leafPath(id);
    const known = this.fingerprints.has(id);
    if (known && !force && !this._staleLeaves.has(id)) return;
    this._staleLeaves.delete(id);

    if (kind === "lookup") {
      this.fingerprints.set(id, existsSync(path) ? EXISTS : ABSENT);
      return;
    }

    if (kind === "dir") {
      let entries = null;
      try {
        entries = await fsp.readdir(path, { withFileTypes: true });
      } catch {
        entries = null;
      }
      this.fingerprints.set(id, dirFingerprintFromEntries(entries));
      return;
    }

    let st;
    try {
      st = await stat(path);
    } catch {
      st = null;
    }
    if (!st || !st.isFile()) {
      this.leafStats.delete(id);
      this.fingerprints.set(id, MISSING);
      return;
    }
    const prev = this.leafStats.get(id);
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs && known && this.fingerprints.get(id) !== MISSING) {
      return; // fast path: stat unchanged, trust existing content hash
    }
    const buf = await readFile(path);
    this.leafStats.set(id, { size: st.size, mtimeMs: st.mtimeMs });
    this.fingerprints.set(id, hashBytes(buf));
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Serialize {edges, fingerprints, leafStats, owned} for .ursa/graph.json.
   * Ids are interned into a string table: a 10k-page site has several hundred
   * thousand edges, and each id would otherwise be repeated once per edge.
   */
  serialize() {
    const table = [];
    const index = new Map();
    const intern = (s) => {
      let i = index.get(s);
      if (i === undefined) {
        i = table.length;
        table.push(s);
        index.set(s, i);
      }
      return i;
    };
    const fingerprints = [];
    for (const [id, fp] of this.fingerprints) fingerprints.push(intern(id), fp);
    const edges = [];
    for (const [id, deps] of this.edges) {
      const row = [intern(id)];
      for (const [depId, fp] of deps) row.push(intern(depId), fp);
      edges.push(row);
    }
    const leafStats = [];
    for (const [id, st] of this.leafStats) leafStats.push(intern(id), st.size, st.mtimeMs);
    const owned = [];
    for (const [id, paths] of this.owned) owned.push([intern(id), ...paths]);
    return { version: GRAPH_SCHEMA_VERSION, table, fingerprints, edges, leafStats, owned };
  }

  /**
   * Load persisted state. Returns false (leaving the graph empty for a clean
   * pass) when the schema version is stale or the data is malformed.
   * All leaves are marked stale so the first pass re-checks them — call
   * scanLeaves() to do this eagerly on warm start.
   * @param {object} data - Previously serialized graph
   * @returns {boolean} Whether the data was loaded
   */
  load(data) {
    if (!data || data.version !== GRAPH_SCHEMA_VERSION) return false;
    try {
      const table = data.table ?? [];
      const id = (i) => {
        const s = table[i];
        if (typeof s !== "string") throw new Error("bad id index");
        return s;
      };
      this.fingerprints = new Map();
      for (let i = 0; i < (data.fingerprints ?? []).length; i += 2) {
        this.fingerprints.set(id(data.fingerprints[i]), data.fingerprints[i + 1]);
      }
      this.leafStats = new Map();
      for (let i = 0; i < (data.leafStats ?? []).length; i += 3) {
        this.leafStats.set(id(data.leafStats[i]), { size: data.leafStats[i + 1], mtimeMs: data.leafStats[i + 2] });
      }
      this.edges = new Map();
      this.rdeps = new Map();
      for (const row of data.edges ?? []) {
        const deps = new Map();
        for (let i = 1; i < row.length; i += 2) deps.set(id(row[i]), row[i + 1]);
        this._setEdges(id(row[0]), deps);
      }
      this.owned = new Map();
      this.ownerOf = new Map();
      for (const row of data.owned ?? []) {
        const nodeId = id(row[0]);
        const paths = row.slice(1);
        this.owned.set(nodeId, paths);
        for (const p of paths) this.ownerOf.set(p, nodeId);
      }
      for (const key of this.fingerprints.keys()) {
        if (isLeafId(key) && leafKind(key) !== "const") this._staleLeaves.add(key);
      }
      return true;
    } catch {
      this.fingerprints = new Map();
      this.leafStats = new Map();
      this.edges = new Map();
      this.rdeps = new Map();
      this.owned = new Map();
      this.ownerOf = new Map();
      return false;
    }
  }

  /** Stats for logging. */
  getStats() {
    let leaves = 0;
    for (const id of this.fingerprints.keys()) {
      if (isLeafId(id)) leaves++;
    }
    return {
      derivedNodes: this.edges.size,
      leaves,
      edges: [...this.edges.values()].reduce((sum, m) => sum + m.size, 0),
      failed: this.failed.size,
      owned: this.ownerOf.size,
    };
  }

  /** Derived node ids currently known (defined or persisted). */
  knownNodeIds() {
    const ids = new Set();
    for (const id of this.edges.keys()) if (!isLeafId(id)) ids.add(id);
    for (const id of this.fingerprints.keys()) if (!isLeafId(id)) ids.add(id);
    for (const id of this.owned.keys()) ids.add(id);
    return ids;
  }
}

/** Path to the persisted graph for a source directory. */
export function getGraphPath(sourceDir) {
  return join(getUrsaDir(sourceDir), GRAPH_FILE);
}

/**
 * Load a persisted graph from .ursa/graph.json into the given BuildGraph.
 * @returns {Promise<boolean>} Whether a valid graph was loaded
 */
export async function loadGraph(sourceDir, graph) {
  try {
    if (!existsSync(getGraphPath(sourceDir))) return false;
    const data = JSON.parse(await readFile(getGraphPath(sourceDir), "utf8"));
    return graph.load(data);
  } catch (e) {
    console.warn(`Could not load build graph: ${e.message}`);
    return false;
  }
}

/** Persist a graph to .ursa/graph.json. */
export async function saveGraph(sourceDir, graph) {
  try {
    await mkdir(getUrsaDir(sourceDir), { recursive: true });
    await writeFile(getGraphPath(sourceDir), JSON.stringify(graph.serialize()));
    return true;
  } catch (e) {
    console.warn(`Could not save build graph: ${e.message}`);
    return false;
  }
}
