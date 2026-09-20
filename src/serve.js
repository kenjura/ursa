/**
 * `ursa serve`: build the site, serve it, and keep the output continuously
 * equal to what a build from the current source would produce, telling
 * connected browsers when the page they are looking at has changed.
 *
 * See docs/SERVE.md. In short:
 *
 * - Both trees (docroot and meta) are watched recursively with a deny-list,
 *   never an extension allow-list (§3.1). Events are normalised to paths; the
 *   truth about a path is established by the pass, not the event kind (§3.2).
 * - Events are debounced: 500 ms quiet, 2000 ms at most (§3.3). A batch runs
 *   one pass. Exactly one pass runs at a time; events during a pass form the
 *   next batch (§5.5). The startup pass holds the same lock.
 * - The pass (helper/build/pass.js) is the same one `generate` runs. Viewed
 *   pages are built first and their clients told to reload the moment the page
 *   is written (§6.4); pages whose JSON (menu, indices) changed are told
 *   `data-updated` and refetch in place (§6.1).
 */

import express from "express";
import compression from "compression";
import watch from "node-watch";
import { join, resolve, relative, basename } from "path";
import { existsSync, statSync } from "fs";
import { promises as fsp } from "fs";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { resolvePort } from "./helper/portUtils.js";
import { createBuild } from "./helper/build/pass.js";
import { resolveUrlToOutput } from "./helper/build/precedence.js";
import { hashBytes, isScratchName } from "./helper/build/tracedFs.js";
import { parseNodeId } from "./helper/build/site.js";
import { getUrsaVersion } from "./helper/ursaVersion.js";

const { readFile, mkdir } = fsp;

const DEBOUNCE_QUIET_MS = 500;
const DEBOUNCE_MAX_MS = 2000;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/** Map of WebSocket client → the URL path it reports viewing. */
const clientUrls = new Map();
let wss = null;

function send(client, messageObj) {
  if (client.readyState === 1) client.send(JSON.stringify(messageObj));
}

function broadcast(messageObj) {
  if (!wss) return;
  for (const client of wss.clients) send(client, messageObj);
}

/** The distinct output paths (relative) connected clients are viewing. */
function viewedOutputs(outputDir) {
  const out = new Set();
  for (const [client, url] of clientUrls) {
    if (client.readyState !== 1 || !url) continue;
    out.add(outputForUrl(url, outputDir));
  }
  return [...out];
}

/** URL → the output file it names (shared with the HTTP middleware, §6.2). */
function outputForUrl(url, outputDir) {
  return resolveUrlToOutput(url, (rel) => existsSync(join(outputDir, rel)));
}

/**
 * Generate the hot reload client script.
 * @param {number} wsPort - WebSocket server port
 */
function getHotReloadScript(wsPort) {
  return `
<!-- Ursa Hot Reload -->
<script>
(function() {
  const wsUrl = 'ws://' + window.location.hostname + ':${wsPort}';
  let ws;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  const reconnectDelay = 1000;

  // Loading indicator management
  let indicatorEl = null;
  function getIndicator() {
    if (indicatorEl) return indicatorEl;
    indicatorEl = document.getElementById('ursa-update-indicator');
    return indicatorEl;
  }
  function showIndicator(color) {
    const el = getIndicator();
    if (!el) return;
    el.style.display = 'flex';
    el.className = 'ursa-update-indicator ursa-update-' + color;
  }
  function hideIndicator() {
    const el = getIndicator();
    if (!el) return;
    el.style.display = 'none';
    el.className = 'ursa-update-indicator';
  }

  function sendUrl() {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'url', url: window.location.pathname }));
    }
  }

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      console.log('[Ursa] Hot reload connected');
      reconnectAttempts = 0;
      sendUrl();
    };

    ws.onmessage = function(event) {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'reload':
            hideIndicator();
            console.log('[Ursa] Reloading page...');
            window.location.reload();
            break;
          case 'update-start':
            showIndicator('gray');
            break;
          case 'update-affects-you':
            showIndicator('green');
            break;
          case 'update-no-affect':
            hideIndicator();
            break;
          case 'update-failed':
            hideIndicator();
            console.error('[Ursa] Rebuilding this page failed: ' + (data.message || 'unknown error'));
            break;
          case 'data-updated':
            // Menu, search indices or recent activity changed: the page's
            // scripts refetch them in place, no reload needed.
            document.dispatchEvent(new CustomEvent('ursa:data-updated', { detail: { what: data.what || [] } }));
            break;
        }
      } catch (e) {
        console.error('[Ursa] Hot reload error:', e);
      }
    };

    ws.onclose = function() {
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log('[Ursa] Hot reload disconnected, reconnecting... (' + reconnectAttempts + '/' + maxReconnectAttempts + ')');
        setTimeout(connect, reconnectDelay);
      } else {
        console.log('[Ursa] Hot reload: max reconnect attempts reached');
      }
    };

    ws.onerror = function() {
      console.error('[Ursa] Hot reload WebSocket error');
    };
  }

  connect();

  // Tell the server which page this is, whenever that might have changed
  window.addEventListener('popstate', sendUrl);
  window.addEventListener('pageshow', sendUrl);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) sendUrl();
  });
})();
</script>
`;
}

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------

/**
 * Configurable serve function for CLI and library use
 */
export async function serve({
  _source,
  _meta,
  _output,
  port = 8080,
  _whitelist = null,
  _clean = false,
  _exclude = null,
  _explain = false,
  strictPort = false,
} = {}) {
  const sourceDir = resolve(_source);
  const metaDir = resolve(_meta);
  const outputDir = resolve(_output);

  console.log({ source: sourceDir, meta: metaDir, output: outputDir, port, whitelist: _whitelist, exclude: _exclude, clean: _clean });

  // Resolve port (prompt user if occupied)
  port = await resolvePort(port, { strict: strictPort });

  // Ensure output directory exists and start server immediately
  await mkdir(outputDir, { recursive: true });
  const { wsPort } = serveFiles(outputDir, port);
  console.log(`🚀 Development server running at http://localhost:${port}`);
  console.log("📁 Serving files from:", outputDir);

  const build = await createBuild({
    source: sourceDir,
    meta: metaDir,
    output: outputDir,
    whitelist: _whitelist,
    exclude: _exclude,
    clean: _clean,
    explain: _explain,
  });

  // ---- Batching and the single writer ------------------------------------

  let pending = new Set(); // paths with events in the current batch
  let quietTimer = null;
  let maxTimer = null;
  let batchStartedAt = 0;
  let running = false;

  const excludedRoots = [
    outputDir,
    join(sourceDir, ".ursa"),
    join(sourceDir, ".ursa.json"),
  ];

  /** Paths never treated as inputs (§3.1). */
  function isIgnoredPath(path) {
    for (const root of excludedRoots) {
      if (path === root || path.startsWith(root + "/")) return true;
    }
    const parts = path.split("/");
    for (const part of parts) {
      if (part === "node_modules" || part === ".git") return true;
    }
    const name = basename(path);
    if (isScratchName(name)) return true;
    // Editor scratch files inside otherwise-visible folders
    if (name.startsWith(".") && name !== ".ursa") return true;
    return false;
  }

  function queueChange(evt, path) {
    if (isIgnoredPath(path)) return;
    if (pending.size === 0 && !running) {
      broadcast({ type: "update-start", timestamp: Date.now() });
      batchStartedAt = Date.now();
    }
    pending.add(path);

    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(startBatch, DEBOUNCE_QUIET_MS);
    if (!maxTimer) {
      maxTimer = setTimeout(startBatch, DEBOUNCE_MAX_MS);
    }
  }

  function startBatch() {
    if (quietTimer) clearTimeout(quietTimer);
    if (maxTimer) clearTimeout(maxTimer);
    quietTimer = null;
    maxTimer = null;
    if (running) return; // the running pass will pick the batch up when it ends
    runQueued();
  }

  async function runQueued() {
    if (running) return;
    if (pending.size === 0) return;
    running = true;
    const paths = [...pending];
    pending = new Set();
    try {
      // A directory event (creation, removal, rename) rescans its subtree: the
      // watcher may report a renamed or removed folder as one event for the
      // folder alone (§3.2). A path that is gone might have been a folder, so
      // every known leaf beneath it is re-checked too.
      const subtrees = [];
      for (const p of paths) {
        let isDir = false;
        try {
          isDir = statSync(p).isDirectory();
        } catch {
          isDir = true; // missing: rescan whatever the graph knew beneath it
        }
        if (isDir) subtrees.push(p);
        else build.graph.invalidatePath(p);
      }
      build.graph.invalidateSubtrees(subtrees);
      console.log(`\n🔄 ${paths.length} change(s) after ${Date.now() - batchStartedAt}ms: ${paths.slice(0, 5).map((p) => relative(sourceDir, p) || p).join(", ")}${paths.length > 5 ? ", …" : ""}`);
      await runPassWithClients();
    } catch (e) {
      console.error("Error during regeneration:", e);
      broadcast({ type: "update-no-affect", timestamp: Date.now() });
    } finally {
      running = false;
      // Changes that arrived while the pass ran: next batch, no debounce (§5.5)
      if (pending.size > 0) {
        console.log(`▶️  Processing ${pending.size} change(s) queued during the last pass`);
        setImmediate(runQueued);
      }
    }
  }

  // ---- A pass, with client notifications ----------------------------------

  async function runPassWithClients() {
    // Snapshot what each viewed page looks like now, so "changed" means the
    // bytes the browser would fetch changed — whichever node ends up owning it
    const viewed = viewedOutputs(outputDir);
    const before = new Map();
    for (const rel of viewed) before.set(rel, await fileHash(join(outputDir, rel)));
    const notified = new Set(); // output rels already told to reload/fail
    const nodeToOutputs = new Map(); // node id → viewed output rels it owns

    const summary = await build.runPass({
      viewedOutputs: viewed,
      onDirty: (dirty) => {
        // Green indicator for clients whose page (by current owner) is in the dirty set
        for (const [client, url] of clientUrls) {
          if (client.readyState !== 1 || !url) continue;
          const rel = outputForUrl(url, outputDir);
          const owner = build.graph.ownerOfPath(rel);
          if (owner && dirty.has(owner)) send(client, { type: "update-affects-you", timestamp: Date.now() });
        }
        for (const rel of viewed) {
          const owner = build.graph.ownerOfPath(rel);
          if (owner) nodeToOutputs.set(owner, [...(nodeToOutputs.get(owner) ?? []), rel]);
        }
      },
      onNodeDone: async (id, err) => {
        // Early reload (§6.4): the moment a viewed page's owner has been written
        const rels = new Set(nodeToOutputs.get(id) ?? []);
        for (const rel of build.graph.ownedBy(id)) if (before.has(rel)) rels.add(rel);
        for (const rel of rels) {
          if (notified.has(rel)) continue;
          if (err) {
            notified.add(rel);
            sendToViewers(rel, { type: "update-failed", message: err.cause?.message ?? err.message, timestamp: Date.now() });
            continue;
          }
          // Claim before the await: the same node is a root of more than one phase
          notified.add(rel);
          const after = await fileHash(join(outputDir, rel));
          if (after !== before.get(rel)) {
            sendToViewers(rel, { type: "reload", timestamp: Date.now() });
          } else {
            notified.delete(rel);
          }
        }
      },
      moreViewed: () => viewedOutputs(outputDir).filter((rel) => !viewed.includes(rel)),
    });

    // End of pass: anything not yet told. A page whose owner moved (auto-index
    // took over a deleted index.md) or that was deleted reloads to the truth.
    for (const [client, url] of clientUrls) {
      if (client.readyState !== 1 || !url) continue;
      const rel = outputForUrl(url, outputDir);
      if (notified.has(rel)) continue;
      const prev = before.has(rel) ? before.get(rel) : await fileHash(join(outputDir, rel));
      const after = await fileHash(join(outputDir, rel));
      if (before.has(rel) && after !== prev) {
        send(client, { type: "reload", timestamp: Date.now() });
      } else {
        send(client, { type: "update-no-affect", timestamp: Date.now() });
      }
    }

    // Soft closure (§6.1): JSON the page fetches after load
    const what = [];
    for (const id of summary.changedNodes) {
      const { kind } = parseNodeId(id);
      if (kind === "menuData" || kind === "customMenu") what.push("menu");
      else if (kind === "searchIndex" || kind === "fullTextIndex") what.push("search");
      else if (kind === "recentActivity") what.push("recent-activity");
    }
    if (what.length > 0) {
      broadcast({ type: "data-updated", what: [...new Set(what)], timestamp: Date.now() });
    }
    return summary;
  }

  function sendToViewers(rel, message) {
    for (const [client, url] of clientUrls) {
      if (client.readyState !== 1 || !url) continue;
      if (outputForUrl(url, outputDir) === rel) send(client, message);
    }
  }

  // ---- Startup: the first pass runs behind the same lock -------------------

  console.log("👀 Watching for changes in:");
  console.log("   Source:", sourceDir);
  console.log("   Meta:", metaDir);
  console.log("\nPress Ctrl+C to stop the server\n");

  const watcherOpts = { recursive: true, filter: (f, skip) => (isIgnoredPath(f) ? skip : true) };
  watch(metaDir, watcherOpts, (evt, name) => queueChange(evt, name));
  watch(sourceDir, watcherOpts, (evt, name) => queueChange(evt, name));

  running = true;
  try {
    console.log("⏳ Initial build…");
    await runPassWithClients();
    console.log("\n✅ Site ready.\n");
  } catch (e) {
    console.error("Error during initial generation:", e);
  } finally {
    running = false;
    if (pending.size > 0) setImmediate(runQueued);
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function fileHash(path) {
  try {
    return hashBytes(await readFile(path));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * Start HTTP server to serve static files with hot reload support
 * @param {string} outputDir - Directory to serve files from
 * @param {number} port - HTTP server port
 * @returns {object} Object containing httpServer and wsPort
 */
function serveFiles(outputDir, port = 8080) {
  const app = express();
  const wsPort = port + 1; // WebSocket on port+1

  app.use(compression({ threshold: 1024, level: 6 }));

  // Nothing served here may be cached: the same URL (bundle URLs carry content
  // hashes, JSON carries the session's build id) can change under a browser
  // that keeps a tab open across edits.
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.path.endsWith(".json")) {
      res.setHeader("X-ursa-version", getUrsaVersion());
    }
    next();
  });

  // Pages: one resolver shared with the reload logic (§6.2), hot reload script injected
  app.use(async (req, res, next) => {
    const urlPath = req.path;
    const rel = resolveUrlToOutput(urlPath, (r) => existsSync(join(outputDir, r)));
    if (!rel.endsWith(".html")) return next();
    const filePath = join(outputDir, rel);
    if (!filePath.startsWith(outputDir + "/") || !existsSync(filePath)) return next();
    try {
      let html = await readFile(filePath, "utf8");
      const hotReloadScript = getHotReloadScript(wsPort);
      html = html.includes("</body>") ? html.replace("</body>", hotReloadScript + "</body>") : html + hotReloadScript;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch {
      next();
    }
  });

  // Everything else
  app.use(express.static(outputDir, { extensions: ["html"], index: "index.html", etag: false, lastModified: false, cacheControl: false }));

  // A page that does not exist (yet). It carries the hot reload script too, so
  // a browser parked on a URL reloads the moment something is written there —
  // a document created after the tab was opened, or a folder renamed back.
  app.use((req, res, next) => {
    const rel = resolveUrlToOutput(req.path, (r) => existsSync(join(outputDir, r)));
    if (!rel.endsWith(".html") || req.method !== "GET") return next();
    res.status(404);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found</title></head><body><h1>404 Not Found</h1><p><code>${escapeHtml(req.path)}</code> is not part of the site (yet). This page reloads when it appears.</p>${getHotReloadScript(wsPort)}</body></html>`);
  });

  const httpServer = createServer(app);

  wss = new WebSocketServer({ port: wsPort });
  wss.on("connection", (ws) => {
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) ws.ping();
    }, 30000);
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "url" && msg.url) clientUrls.set(ws, msg.url);
      } catch {
        // ignore non-JSON messages
      }
    });
    ws.on("close", () => {
      clearInterval(pingInterval);
      clientUrls.delete(ws);
    });
  });

  httpServer.listen(port, () => {
    console.log(`🌐 Server listening on port ${port}`);
    console.log(`🔥 Hot reload WebSocket on port ${wsPort}`);
  });

  return { httpServer, wsPort };
}

