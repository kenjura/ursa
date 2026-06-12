import { join } from "path";
import { mkdtemp, writeFile, rm, unlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import {
  BuildGraph,
  GraphComputeError,
  fileNodeId,
  lookupNodeId,
  loadGraph,
  saveGraph,
  getGraphPath,
} from "../graph.js";

let tempDir;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ursa-graph-"));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const p = (name) => join(tempDir, name);

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------
describe("basic compute and caching", () => {
  it("computes a node from a file leaf and caches it", async () => {
    await writeFile(p("a.txt"), "hello");
    const graph = new BuildGraph();
    let computeCount = 0;
    graph.node("upper:a", async (ctx) => {
      computeCount++;
      return (await ctx.read(p("a.txt"))).toUpperCase();
    });

    const r1 = await graph.build(["upper:a"]);
    expect(r1.ok).toBe(true);
    expect(r1.results.get("upper:a")).toBe("HELLO");
    expect(computeCount).toBe(1);

    // No change, no invalidation → verified without recompute
    const r2 = await graph.build(["upper:a"]);
    expect(r2.computed.size).toBe(0);
    expect(computeCount).toBe(1);
  });

  it("recomputes when a watched file changes (invalidatePath)", async () => {
    await writeFile(p("a.txt"), "one");
    const graph = new BuildGraph();
    graph.node("val:a", (ctx) => ctx.read(p("a.txt")));

    await graph.build(["val:a"]);
    await writeFile(p("a.txt"), "two!");
    graph.invalidatePath(p("a.txt"));

    const r = await graph.build(["val:a"]);
    expect(r.computed.has("val:a")).toBe(true);
    expect(r.results.get("val:a")).toBe("two!");
  });

  it("does not recompute when mtime changes but content is identical", async () => {
    await writeFile(p("a.txt"), "same");
    const graph = new BuildGraph();
    graph.node("val:a", (ctx) => ctx.read(p("a.txt")));
    await graph.build(["val:a"]);

    // Touch: rewrite identical content (new mtime, same hash)
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(p("a.txt"), "same");
    graph.invalidatePath(p("a.txt"));

    const r = await graph.build(["val:a"]);
    expect(r.computed.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Diamond dependencies recompute once
// ---------------------------------------------------------------------------
describe("diamond dependencies", () => {
  it("recomputes each node in a diamond exactly once", async () => {
    await writeFile(p("a.txt"), "base");
    const graph = new BuildGraph();
    const counts = { b: 0, c: 0, d: 0 };
    graph.node("b", async (ctx) => {
      counts.b++;
      return "b:" + (await ctx.read(p("a.txt")));
    });
    graph.node("c", async (ctx) => {
      counts.c++;
      return "c:" + (await ctx.read(p("a.txt")));
    });
    graph.node("d", async (ctx) => {
      counts.d++;
      return (await ctx.get("b")) + "|" + (await ctx.get("c"));
    });

    await graph.build(["d"]);
    expect(counts).toEqual({ b: 1, c: 1, d: 1 });

    await writeFile(p("a.txt"), "changed");
    graph.invalidatePath(p("a.txt"));
    const r = await graph.build(["d"]);
    expect(counts).toEqual({ b: 2, c: 2, d: 2 });
    expect(r.results.get("d")).toBe("b:changed|c:changed");
  });
});

// ---------------------------------------------------------------------------
// Early cutoff
// ---------------------------------------------------------------------------
describe("early cutoff", () => {
  it("stops propagation when a recomputed fingerprint is unchanged", async () => {
    await writeFile(p("doc.md"), "title-line\nbody one");
    const graph = new BuildGraph();
    let projCount = 0;
    let downstreamCount = 0;

    // Projection node: only the first line (like docMeta extracting the title)
    graph.node("firstLine:doc", async (ctx) => {
      projCount++;
      return (await ctx.read(p("doc.md"))).split("\n")[0];
    });
    graph.node("menuEntry:doc", async (ctx) => {
      downstreamCount++;
      return "MENU[" + (await ctx.get("firstLine:doc")) + "]";
    });

    await graph.build(["menuEntry:doc"]);
    expect(projCount).toBe(1);
    expect(downstreamCount).toBe(1);

    // Edit only the body — projection recomputes, but its fingerprint is
    // unchanged, so the menu entry must NOT recompute.
    await writeFile(p("doc.md"), "title-line\nbody two (edited)");
    graph.invalidatePath(p("doc.md"));
    const r = await graph.build(["menuEntry:doc"]);
    expect(projCount).toBe(2);
    expect(downstreamCount).toBe(1);
    expect(r.computed.has("menuEntry:doc")).toBe(false);

    // Edit the title line — now propagation continues.
    await writeFile(p("doc.md"), "new-title\nbody two (edited)");
    graph.invalidatePath(p("doc.md"));
    await graph.build(["menuEntry:doc"]);
    expect(downstreamCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Dynamic dependency change
// ---------------------------------------------------------------------------
describe("dynamic dependencies", () => {
  it("drops old edges and records new ones when a dep choice changes", async () => {
    await writeFile(p("config.txt"), "x");
    await writeFile(p("x.txt"), "X content");
    await writeFile(p("y.txt"), "Y content");
    const graph = new BuildGraph();
    let count = 0;
    graph.node("page", async (ctx) => {
      count++;
      const which = (await ctx.read(p("config.txt"))).trim();
      return await ctx.read(p(which + ".txt"));
    });

    const r1 = await graph.build(["page"]);
    expect(r1.results.get("page")).toBe("X content");
    expect(count).toBe(1);

    // Change the file we currently depend on → recompute
    await writeFile(p("x.txt"), "X content v2");
    graph.invalidatePath(p("x.txt"));
    await graph.build(["page"]);
    expect(count).toBe(2);

    // Switch the config to y → recompute; edge to x dropped, edge to y live
    await writeFile(p("config.txt"), "y");
    graph.invalidatePath(p("config.txt"));
    const r2 = await graph.build(["page"]);
    expect(r2.results.get("page")).toBe("Y content");
    expect(count).toBe(3);

    // x.txt is no longer a dependency → changing it must not recompute
    await writeFile(p("x.txt"), "X content v3");
    graph.invalidatePath(p("x.txt"));
    await graph.build(["page"]);
    expect(count).toBe(3);

    // y.txt is now the live dependency
    await writeFile(p("y.txt"), "Y content v2");
    graph.invalidatePath(p("y.txt"));
    const r3 = await graph.build(["page"]);
    expect(r3.results.get("page")).toBe("Y content v2");
    expect(count).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Lookup nodes (existence probes)
// ---------------------------------------------------------------------------
describe("lookup nodes", () => {
  it("creating a previously-absent file dirties the subtree", async () => {
    const stylePath = p("style.css");
    const graph = new BuildGraph();
    let count = 0;
    graph.node("css:dir", async (ctx) => {
      count++;
      if (ctx.exists(stylePath)) {
        return await ctx.read(stylePath);
      }
      return "/* default */";
    });

    const r1 = await graph.build(["css:dir"]);
    expect(r1.results.get("css:dir")).toBe("/* default */");
    expect(count).toBe(1);

    // Probe is recorded even though the file did not exist — creation fires it
    await writeFile(stylePath, "body { color: red }");
    graph.invalidatePath(stylePath);
    const r2 = await graph.build(["css:dir"]);
    expect(r2.results.get("css:dir")).toBe("body { color: red }");
    expect(count).toBe(2);

    // Deletion fires it too
    await unlink(stylePath);
    graph.invalidatePath(stylePath);
    const r3 = await graph.build(["css:dir"]);
    expect(r3.results.get("css:dir")).toBe("/* default */");
    expect(count).toBe(3);
  });

  it("records a missing-file read so a later creation triggers recompute", async () => {
    const path = p("maybe.txt");
    const graph = new BuildGraph();
    graph.node("reader", async (ctx) => {
      try {
        return await ctx.read(path);
      } catch {
        return "fallback";
      }
    });

    const r1 = await graph.build(["reader"]);
    expect(r1.results.get("reader")).toBe("fallback");

    await writeFile(path, "now it exists");
    graph.invalidatePath(path);
    const r2 = await graph.build(["reader"]);
    expect(r2.results.get("reader")).toBe("now it exists");
  });
});

// ---------------------------------------------------------------------------
// Persistence round-trip
// ---------------------------------------------------------------------------
describe("persistence", () => {
  function defineNodes(graph, counters) {
    graph.node("b", async (ctx) => {
      counters.b++;
      return "b:" + (await ctx.read(p("a.txt")));
    });
    graph.node("c", async (ctx) => {
      counters.c++;
      return (await ctx.get("b")).toUpperCase();
    });
  }

  it("round-trips through serialize/load with zero recomputes when nothing changed", async () => {
    await writeFile(p("a.txt"), "persisted");
    const g1 = new BuildGraph();
    const counters1 = { b: 0, c: 0 };
    defineNodes(g1, counters1);
    await g1.build(["c"]);
    expect(counters1).toEqual({ b: 1, c: 1 });

    // Serialize → JSON → new process (fresh graph, fresh fn definitions)
    const json = JSON.stringify(g1.serialize());
    const g2 = new BuildGraph();
    const counters2 = { b: 0, c: 0 };
    defineNodes(g2, counters2);
    expect(g2.load(JSON.parse(json))).toBe(true);

    // Warm start: stat-scan leaves; nothing changed → no-op pass
    const changed = await g2.scanLeaves();
    expect(changed).toEqual([]);
    const r = await g2.build(["c"]);
    expect(r.ok).toBe(true);
    expect(r.computed.size).toBe(0);
    expect(counters2).toEqual({ b: 0, c: 0 });
  });

  it("after a warm start, a changed leaf recomputes only the affected chain", async () => {
    await writeFile(p("a.txt"), "v1");
    await writeFile(p("other.txt"), "other");
    const g1 = new BuildGraph();
    const counters1 = { b: 0, c: 0 };
    defineNodes(g1, counters1);
    g1.node("standalone", (ctx) => ctx.read(p("other.txt")));
    await g1.build(["c", "standalone"]);

    const json = JSON.stringify(g1.serialize());

    // File changes while the process is down
    await writeFile(p("a.txt"), "v2 longer");

    const g2 = new BuildGraph();
    const counters2 = { b: 0, c: 0 };
    defineNodes(g2, counters2);
    g2.node("standalone", (ctx) => ctx.read(p("other.txt")));
    g2.load(JSON.parse(json));
    const changed = await g2.scanLeaves();
    expect(changed).toEqual([fileNodeId(p("a.txt"))]);

    const r = await g2.build(["c", "standalone"]);
    expect(r.computed.has("b")).toBe(true);
    expect(r.computed.has("c")).toBe(true);
    expect(r.computed.has("standalone")).toBe(false);
    expect(r.results.get("c")).toBe("B:V2 LONGER");
  });

  it("is correct on warm start even without an explicit scanLeaves call", async () => {
    await writeFile(p("a.txt"), "v1");
    const g1 = new BuildGraph();
    defineNodes(g1, { b: 0, c: 0 });
    await g1.build(["c"]);
    const json = JSON.stringify(g1.serialize());

    await writeFile(p("a.txt"), "v2 changed offline");

    const g2 = new BuildGraph();
    const counters2 = { b: 0, c: 0 };
    defineNodes(g2, counters2);
    g2.load(JSON.parse(json));
    // load() marks leaves stale, so verification re-stats them lazily
    const r = await g2.build(["c"]);
    expect(r.results.get("c")).toBe("B:V2 CHANGED OFFLINE");
  });

  it("rejects a stale schema version (clean pass instead)", () => {
    const graph = new BuildGraph();
    expect(graph.load({ version: 999, fingerprints: {}, edges: {} })).toBe(false);
    expect(graph.load(null)).toBe(false);
    expect(graph.load(undefined)).toBe(false);
    expect(graph.edges.size).toBe(0);
  });

  it("saves to and loads from .ursa/graph.json", async () => {
    await writeFile(p("a.txt"), "disk");
    const g1 = new BuildGraph();
    defineNodes(g1, { b: 0, c: 0 });
    await g1.build(["c"]);
    expect(await saveGraph(tempDir, g1)).toBe(true);
    const onDisk = JSON.parse(await readFile(getGraphPath(tempDir), "utf8"));
    expect(onDisk.version).toBe(1);

    const g2 = new BuildGraph();
    const counters2 = { b: 0, c: 0 };
    defineNodes(g2, counters2);
    expect(await loadGraph(tempDir, g2)).toBe(true);
    await g2.scanLeaves();
    const r = await g2.build(["c"]);
    expect(r.computed.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------
describe("failure handling", () => {
  it("marks a throwing node failed without corrupting the graph, and retries", async () => {
    await writeFile(p("a.txt"), "good");
    const graph = new BuildGraph();
    graph.node("validator", async (ctx) => {
      const content = await ctx.read(p("a.txt"));
      if (content.includes("bad")) throw new Error("validation failed");
      return content;
    });
    graph.node("downstream", async (ctx) => "ok:" + (await ctx.get("validator")));

    const r1 = await graph.build(["downstream"]);
    expect(r1.ok).toBe(true);

    // Break the input → node fails, error reported, old state intact
    await writeFile(p("a.txt"), "bad data");
    graph.invalidatePath(p("a.txt"));
    const r2 = await graph.build(["downstream"]);
    expect(r2.ok).toBe(false);
    const err = r2.errors.get("downstream");
    expect(err).toBeInstanceOf(GraphComputeError);
    expect(err.nodeId).toBe("validator");
    expect(graph.failed.has("validator")).toBe(true);
    // Previous value/fingerprint preserved (graph not corrupted)
    expect(graph.values.get("validator")).toBe("good");
    expect(graph.values.get("downstream")).toBe("ok:good");

    // Fix the input → failed node is retried and succeeds
    await writeFile(p("a.txt"), "good again");
    graph.invalidatePath(p("a.txt"));
    const r3 = await graph.build(["downstream"]);
    expect(r3.ok).toBe(true);
    expect(r3.results.get("downstream")).toBe("ok:good again");
    expect(graph.failed.size).toBe(0);
  });

  it("a failure in one root does not affect other roots", async () => {
    await writeFile(p("a.txt"), "fine");
    const graph = new BuildGraph();
    graph.node("broken", () => {
      throw new Error("always fails");
    });
    graph.node("healthy", (ctx) => ctx.read(p("a.txt")));

    const r = await graph.build(["broken", "healthy"]);
    expect(r.ok).toBe(false);
    expect(r.errors.has("broken")).toBe(true);
    expect(r.results.get("healthy")).toBe("fine");
  });

  it("retries a failed node on the next pass even with no input change", async () => {
    let attempts = 0;
    const graph = new BuildGraph();
    graph.node("flaky", () => {
      attempts++;
      if (attempts < 2) throw new Error("transient");
      return "recovered";
    });

    const r1 = await graph.build(["flaky"]);
    expect(r1.ok).toBe(false);
    const r2 = await graph.build(["flaky"]);
    expect(r2.ok).toBe(true);
    expect(r2.results.get("flaky")).toBe("recovered");
  });
});

// ---------------------------------------------------------------------------
// Misc engine behavior
// ---------------------------------------------------------------------------
describe("engine behavior", () => {
  it("detects dependency cycles", async () => {
    const graph = new BuildGraph();
    graph.node("a", (ctx) => ctx.get("b"));
    graph.node("b", (ctx) => ctx.get("a"));
    const r = await graph.build(["a"]);
    expect(r.ok).toBe(false);
    expect(String(r.errors.get("a"))).toMatch(/cycle/i);
  });

  it("recomputes a node whose recorded dep was removed", async () => {
    await writeFile(p("a.txt"), "x");
    const graph = new BuildGraph();
    graph.node("dep", (ctx) => ctx.read(p("a.txt")));
    graph.node("parent", async (ctx) => {
      const hasDep = graph.hasNode("dep");
      return hasDep ? "with:" + (await ctx.get("dep")) : "alone";
    });
    await graph.build(["parent"]);

    graph.removeNode("dep");
    const r = await graph.build(["parent"]);
    expect(r.results.get("parent")).toBe("alone");
  });

  it("gc drops state for deleted documents and orphaned leaves", async () => {
    await writeFile(p("a.txt"), "a");
    await writeFile(p("b.txt"), "b");
    const graph = new BuildGraph();
    graph.node("pageA", (ctx) => ctx.read(p("a.txt")));
    graph.node("pageB", (ctx) => ctx.read(p("b.txt")));
    await graph.build(["pageA", "pageB"]);

    graph.gc(new Set(["pageA"]));
    expect(graph.edges.has("pageB")).toBe(false);
    expect(graph.fingerprints.has("pageB")).toBe(false);
    expect(graph.fingerprints.has(fileNodeId(p("b.txt")))).toBe(false);
    expect(graph.fingerprints.has(fileNodeId(p("a.txt")))).toBe(true);
  });

  it("demand() recomputes a clean node whose value is not in memory", async () => {
    await writeFile(p("a.txt"), "val");
    const g1 = new BuildGraph();
    g1.node("n", (ctx) => ctx.read(p("a.txt")));
    await g1.build(["n"]);
    const json = JSON.stringify(g1.serialize());

    const g2 = new BuildGraph();
    let count = 0;
    g2.node("n", async (ctx) => {
      count++;
      return await ctx.read(p("a.txt"));
    });
    g2.load(JSON.parse(json));
    await g2.scanLeaves();

    // Verified clean, but the value lives only in memory → demand recomputes
    expect(await g2.demand("n")).toBe("val");
    expect(count).toBe(1);
  });

  it("processes roots in the given order (priority scheduling)", async () => {
    await writeFile(p("a.txt"), "x");
    const order = [];
    const graph = new BuildGraph();
    graph.node("first", async (ctx) => {
      order.push("first");
      return await ctx.read(p("a.txt"));
    });
    graph.node("second", async (ctx) => {
      order.push("second");
      return await ctx.read(p("a.txt"));
    });
    await graph.build(["second", "first"]);
    expect(order).toEqual(["second", "first"]);
  });

  it("exposes useful stats", async () => {
    await writeFile(p("a.txt"), "x");
    const graph = new BuildGraph();
    graph.node("n", (ctx) => ctx.read(p("a.txt")));
    await graph.build(["n"]);
    const stats = graph.getStats();
    expect(stats.derivedNodes).toBe(1);
    expect(stats.leaves).toBe(1);
    expect(stats.edges).toBe(1);
    expect(stats.failed).toBe(0);
  });
});
