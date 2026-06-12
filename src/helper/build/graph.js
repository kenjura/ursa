/**
 * Incremental build graph for Ursa (Make/Shake/Salsa semantics).
 *
 * Every output is a derived node; a node recomputes if and only if one of its
 * recorded input fingerprints changed. See docs/changes/serve-logic.md.
 *
 * Concepts:
 * - Leaf nodes are created implicitly when a compute function calls
 *   `ctx.read(path)` (file leaf, content-hash fingerprint) or
 *   `ctx.exists(path)` (lookup leaf, "exists"/"absent" fingerprint).
 *   Lookup leaves make file *creation* an observable change: probing for a
 *   style.css that isn't there records an edge that dirties the subtree when
 *   the file appears.
 * - Derived nodes are registered with `graph.node(id, async (ctx) => value)`.
 *   Edges are recorded fresh on every recompute (replace, not append), so
 *   dynamic dependencies — e.g. which template a doc's frontmatter selects —
 *   are always correct and can shrink.
 * - Early cutoff: after a recompute, the node's own fingerprint is derived
 *   from its value. If it is unchanged, dependents' recorded fingerprints
 *   still match and propagation stops.
 * - Verification is demand-driven and topological: verifying a node verifies
 *   its recorded dependencies first. `build(roots)` verifies roots in the
 *   given order, so callers can schedule client-viewed pages first.
 * - Values live in memory only. Persistence stores {edges, fingerprints,
 *   leafStats}; after a restart a clean node is *verified* without recompute,
 *   and is only recomputed if a dependent actually demands its value.
 *
 * Compute functions should be deterministic. Non-determinism (timestamps,
 * randomness) degrades to extra recomputes, never to staleness across passes.
 * To force global invalidation on Ursa upgrades, wire a version string in as
 * a leaf (e.g. ctx.read of package.json) rather than versioning nodes.
 */

import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { getUrsaDir } from "../contentHash.js";

export const GRAPH_SCHEMA_VERSION = 1;
const GRAPH_FILE = "graph.json";

const FILE_PREFIX = "file:";
const LOOKUP_PREFIX = "lookup:";
const MISSING = "missing";

export function fileNodeId(path) {
  return FILE_PREFIX + path;
}

export function lookupNodeId(path) {
  return LOOKUP_PREFIX + path;
}

function isLeafId(id) {
  return id.startsWith(FILE_PREFIX) || id.startsWith(LOOKUP_PREFIX);
}

function leafPath(id) {
  return id.startsWith(FILE_PREFIX)
    ? id.slice(FILE_PREFIX.length)
    : id.slice(LOOKUP_PREFIX.length);
}

function hashBytes(data) {
  return createHash("md5").update(data).digest("hex").substring(0, 16);
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
  constructor() {
    /** @type {Map<string, {fn: Function, fingerprint?: Function}>} derived node definitions */
    this.fns = new Map();
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
    /** @type {Map<string, string>} node id → error message for nodes whose last compute threw */
    this.failed = new Map();

    /** @type {Set<string>} leaf ids (file: and lookup:) the watcher reported changed since last verification */
    this._staleLeaves = new Set();
    // Per-pass state
    this._verified = null;
    this._inProgress = null;
    this._computedThisPass = new Set();
  }

  /**
   * Define (or replace) a derived node.
   * @param {string} id - Node id, by convention "kind:key" (e.g. "pageHtml:/abs/doc.md")
   * @param {(ctx: {read: Function, exists: Function, get: Function}) => Promise<any>} fn
   * @param {{fingerprint?: (value: any) => string}} [opts] - Custom value fingerprint
   */
  node(id, fn, opts = {}) {
    if (isLeafId(id)) throw new Error(`Cannot define a derived node with a leaf id: ${id}`);
    this.fns.set(id, { fn, fingerprint: opts.fingerprint });
  }

  hasNode(id) {
    return this.fns.has(id);
  }

  /**
   * Remove a derived node (e.g. its source document was deleted).
   * Dependents holding a recorded edge to it will recompute on next verify.
   */
  removeNode(id) {
    this.fns.delete(id);
    this.values.delete(id);
    this.fingerprints.delete(id);
    this.failed.delete(id);
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
  }

  /**
   * Drop persisted state for derived nodes not in keepIds (e.g. deleted
   * documents), then drop leaves no longer referenced by any edge.
   * @param {Set<string>} keepIds - Derived node ids that should survive
   */
  gc(keepIds) {
    for (const id of [...this.edges.keys()]) {
      if (!isLeafId(id) && !keepIds.has(id)) this.removeNode(id);
    }
    for (const id of [...this.fingerprints.keys()]) {
      if (!isLeafId(id) && !keepIds.has(id)) this.removeNode(id);
    }
    // Orphaned leaves: no remaining dependents
    for (const id of [...this.fingerprints.keys()]) {
      if (isLeafId(id) && !this.rdeps.has(id)) {
        this.fingerprints.delete(id);
        this.leafStats.delete(id);
      }
    }
  }

  /**
   * Watcher hook: mark a path's leaves (file + lookup) as needing a re-stat
   * before they are next trusted.
   * @param {string} path - Absolute path reported by the file watcher
   */
  invalidatePath(path) {
    this._staleLeaves.add(fileNodeId(path));
    this._staleLeaves.add(lookupNodeId(path));
  }

  /**
   * Re-stat every known leaf (warm start). Uses the size+mtime fast path and
   * only re-hashes content when the stat changed. Returns leaf ids whose
   * fingerprint actually changed.
   * @returns {Promise<string[]>}
   */
  async scanLeaves() {
    const changed = [];
    for (const id of [...this.fingerprints.keys()]) {
      if (!isLeafId(id)) continue;
      const before = this.fingerprints.get(id);
      await this._refreshLeaf(id, { force: true });
      if (this.fingerprints.get(id) !== before) changed.push(id);
    }
    this._staleLeaves.clear();
    return changed;
  }

  /**
   * Bring the given nodes (and everything they depend on) up to date, in
   * order — schedule client-viewed pages first for priority regeneration.
   * A node whose compute function throws is marked failed (and retried next
   * pass) without corrupting the rest of the graph.
   * @param {string[]} rootIds
   * @returns {Promise<{ok: boolean, results: Map<string, any>, errors: Map<string, Error>, computed: Set<string>}>}
   */
  async build(rootIds) {
    this._verified = new Set();
    this._inProgress = new Set();
    this._computedThisPass = new Set();
    const results = new Map();
    const errors = new Map();
    for (const id of rootIds) {
      try {
        await this._verify(id);
        results.set(id, this.values.get(id));
      } catch (e) {
        errors.set(id, e);
      }
    }
    return { ok: errors.size === 0, results, errors, computed: this._computedThisPass };
  }

  /**
   * Verify a node and return its value, recomputing if the value is not in
   * memory (e.g. after a restart). Usable standalone or during a build pass.
   * @param {string} id
   */
  async demand(id) {
    if (!this._verified) {
      this._verified = new Set();
      this._inProgress = new Set();
      this._computedThisPass = new Set();
    }
    await this._verify(id);
    if (!this.values.has(id) && this.fns.has(id)) {
      await this._compute(id);
    }
    return this.values.get(id);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Ensure a node is up to date: verify its recorded deps (topologically),
   * recompute when any recorded input fingerprint differs from current.
   */
  async _verify(id) {
    if (this._verified.has(id)) return;
    if (this._inProgress.has(id)) {
      throw new Error(`Dependency cycle detected at "${id}"`);
    }

    if (isLeafId(id)) {
      await this._refreshLeaf(id);
      this._verified.add(id);
      return;
    }

    const def = this.fns.get(id);
    if (!def) throw new Error(`Unknown node: "${id}"`);

    this._inProgress.add(id);
    try {
      let needsCompute = false;
      const deps = this.edges.get(id);
      if (!this.fingerprints.has(id) || this.failed.has(id) || !deps) {
        // Never computed, failed last time (retry), or no recorded inputs
        needsCompute = true;
      } else {
        for (const [depId, recordedFp] of deps) {
          if (!isLeafId(depId) && !this.fns.has(depId)) {
            // Recorded dep no longer defined — recompute to rediscover deps
            needsCompute = true;
            break;
          }
          await this._verify(depId);
          if (this.fingerprints.get(depId) !== recordedFp) {
            needsCompute = true;
            break;
          }
        }
      }
      if (needsCompute) {
        await this._compute(id);
      }
      this._verified.add(id);
    } finally {
      this._inProgress.delete(id);
    }
  }

  /** Run a node's compute function, recording fresh edges as inputs are consumed. */
  async _compute(id) {
    const def = this.fns.get(id);
    if (!def) throw new Error(`Unknown node: "${id}"`);
    const depMap = new Map();
    const ctx = this._makeCtx(depMap);

    let value;
    try {
      value = await def.fn(ctx);
    } catch (e) {
      // Mark failed; keep previous edges/fingerprint intact so the graph
      // is not corrupted. The node is retried on the next pass.
      this.failed.set(id, String(e?.message ?? e));
      throw e instanceof GraphComputeError ? e : new GraphComputeError(id, e);
    }

    this.failed.delete(id);
    this._setEdges(id, depMap);
    this.values.set(id, value);
    const oldFp = this.fingerprints.get(id);
    const newFp = (def.fingerprint ?? defaultValueFingerprint)(value);
    this.fingerprints.set(id, newFp);
    this._computedThisPass.add(id);
    if (oldFp !== undefined && oldFp !== newFp) {
      // Fingerprint moved mid-pass (normally only when an input changed):
      // anything already verified that depends on this must be re-checked.
      this._unverifyDependents(id);
    }
    return value;
  }

  /** Compute context handed to node functions; records edges as they are consumed. */
  _makeCtx(depMap) {
    const graph = this;
    return {
      /** Read a file, recording a file-leaf dependency. Throws if missing (the miss is still recorded). */
      async read(path) {
        const id = fileNodeId(path);
        let content;
        try {
          const [st, buf] = await Promise.all([stat(path), readFile(path)]);
          graph.leafStats.set(id, { size: st.size, mtimeMs: st.mtimeMs });
          graph.fingerprints.set(id, hashBytes(buf));
          content = buf.toString("utf8");
        } catch (e) {
          graph.leafStats.delete(id);
          graph.fingerprints.set(id, MISSING);
          graph._markLeafFresh(id);
          depMap.set(id, MISSING);
          throw e;
        }
        graph._markLeafFresh(id);
        depMap.set(id, graph.fingerprints.get(id));
        return content;
      },
      /** Probe for a file's existence, recording a lookup-leaf dependency. */
      exists(path) {
        const id = lookupNodeId(path);
        const fp = existsSync(path) ? "exists" : "absent";
        graph.fingerprints.set(id, fp);
        graph._markLeafFresh(id);
        depMap.set(id, fp);
        return fp === "exists";
      },
      /** Get another node's value, recording a derived dependency. */
      async get(otherId) {
        await graph._verify(otherId);
        if (!graph.values.has(otherId) && graph.fns.has(otherId)) {
          // Clean but value not in memory (restart) — recompute on demand
          await graph._compute(otherId);
        }
        depMap.set(otherId, graph.fingerprints.get(otherId));
        return graph.values.get(otherId);
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
   * existence. Unless forced (scanLeaves) or flagged stale (invalidatePath),
   * an already-known leaf is trusted.
   */
  async _refreshLeaf(id, { force = false } = {}) {
    const path = leafPath(id);
    const known = this.fingerprints.has(id);
    if (known && !force && !this._staleLeaves.has(id)) return;
    this._staleLeaves.delete(id);

    if (id.startsWith(LOOKUP_PREFIX)) {
      this.fingerprints.set(id, existsSync(path) ? "exists" : "absent");
      return;
    }

    let st;
    try {
      st = await stat(path);
    } catch {
      st = null;
    }
    if (!st) {
      this.leafStats.delete(id);
      this.fingerprints.set(id, MISSING);
      return;
    }
    const prev = this.leafStats.get(id);
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs && known) {
      return; // fast path: stat unchanged, trust existing content hash
    }
    const buf = await readFile(path);
    this.leafStats.set(id, { size: st.size, mtimeMs: st.mtimeMs });
    this.fingerprints.set(id, hashBytes(buf));
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /** Serialize {edges, fingerprints, leafStats} for .ursa/graph.json. */
  serialize() {
    return {
      version: GRAPH_SCHEMA_VERSION,
      fingerprints: Object.fromEntries(this.fingerprints),
      edges: Object.fromEntries(
        [...this.edges].map(([id, deps]) => [id, Object.fromEntries(deps)])
      ),
      leafStats: Object.fromEntries(this.leafStats),
    };
  }

  /**
   * Load persisted state. Returns false (leaving the graph empty for a clean
   * pass) when the schema version is stale or the data is malformed.
   * All leaves are marked stale so the first pass re-stats them — call
   * scanLeaves() to do this eagerly on warm start.
   * @param {object} data - Previously serialized graph
   * @returns {boolean} Whether the data was loaded
   */
  load(data) {
    if (!data || data.version !== GRAPH_SCHEMA_VERSION) return false;
    try {
      this.fingerprints = new Map(Object.entries(data.fingerprints ?? {}));
      this.leafStats = new Map(Object.entries(data.leafStats ?? {}));
      this.edges = new Map();
      this.rdeps = new Map();
      for (const [id, deps] of Object.entries(data.edges ?? {})) {
        this._setEdges(id, new Map(Object.entries(deps)));
      }
      for (const id of this.fingerprints.keys()) {
        if (isLeafId(id)) this._staleLeaves.add(id);
      }
      return true;
    } catch {
      this.fingerprints = new Map();
      this.leafStats = new Map();
      this.edges = new Map();
      this.rdeps = new Map();
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
    };
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
