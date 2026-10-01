/**
 * The development server behind `ursa serve`: static files from the output
 * directory, a hot reload script injected into every page, and a WebSocket
 * through which each browser reports the page it is viewing and is told when
 * that page has changed (docs/SERVE.md §6).
 *
 * Separate from the watcher so other programs (ursa-server) can drive builds
 * their own way and still serve the result with live reload:
 *
 *   const dev = createDevServer({ outputDir, port });
 *   await dev.listen();
 *   await dev.runPass(build);   // a build from createBuild(), clients notified
 */

import express from "express";
import compression from "compression";
import { join } from "path";
import { existsSync } from "fs";
import { promises as fsp } from "fs";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { resolveUrlToOutput } from "./helper/build/precedence.js";
import { hashBytes } from "./helper/build/tracedFs.js";
import { parseNodeId } from "./helper/build/site.js";
import { getUrsaVersion } from "./helper/ursaVersion.js";

const { readFile } = fsp;

/** Path of the hot reload WebSocket on the HTTP server. */
export const HOT_RELOAD_PATH = "/__ursa/ws";

/**
 * Generate the hot reload client script. The WebSocket shares the page's
 * host and port (and scheme), so the server works behind a reverse proxy.
 * @param {string} wsPath - WebSocket path on the HTTP server
 */
function getHotReloadScript(wsPath) {
  return `
<!-- Ursa Hot Reload -->
<script>
(function() {
  const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '${wsPath}';
  let ws;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  const reconnectDelay = 1000;

  // Loading indicator management
  let indicatorEl = null;
  function getIndicator() {
    if (indicatorEl) return indicatorEl;
    indicatorEl = document.querySelector('.ursa-status');
    return indicatorEl;
  }
  // output.ursa-status: data-state="updating" while a rebuild runs,
  // "updated" once it is known to affect this page
  function showIndicator(state) {
    const el = getIndicator();
    if (!el) return;
    el.dataset.state = state;
    el.title = state === 'updated' ? 'Updated, reloading…' : 'Updating…';
    el.hidden = false;
  }
  function hideIndicator() {
    const el = getIndicator();
    if (!el) return;
    el.hidden = true;
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
            showIndicator('updating');
            break;
          case 'update-affects-you':
            showIndicator('updated');
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

/**
 * Create a development server over an output directory.
 *
 * @param {object} opts
 * @param {string} opts.outputDir - Directory to serve (absolute)
 * @param {number} [opts.port] - HTTP port (default 8080)
 * @param {string} [opts.host] - Interface to bind (default: all)
 * @param {(app: import("express").Express) => void} [opts.mount] - Add routes
 *   ahead of the site's own (an editor, an API); called before listening
 * @param {string} [opts.headHtml] - Markup added to the end of every served
 *   page's <head> (e.g. the `script#ursa-server` block account.js reads)
 * @param {(req: import("http").IncomingMessage) => boolean | Promise<boolean>} [opts.authorizeUpgrade]
 *   - Decide whether a hot reload WebSocket may connect (default: all may)
 * @param {(msg: string) => void} [opts.log]
 */
export function createDevServer({ outputDir, port = 8080, host, mount = null, headHtml = "", authorizeUpgrade = null, log = (m) => console.log(m) }) {
  /** WebSocket client → the URL path it reports viewing. */
  const clientUrls = new Map();

  function send(client, messageObj) {
    if (client.readyState === 1) client.send(JSON.stringify(messageObj));
  }

  function broadcast(messageObj) {
    for (const client of wss.clients) send(client, messageObj);
  }

  /** URL → the output file it names (shared with the HTTP middleware, §6.2). */
  function outputForUrl(url) {
    return resolveUrlToOutput(url, (rel) => existsSync(join(outputDir, rel)));
  }

  /** The distinct output paths (relative) connected clients are viewing. */
  function viewedOutputs() {
    const out = new Set();
    for (const [client, url] of clientUrls) {
      if (client.readyState !== 1 || !url) continue;
      out.add(outputForUrl(url));
    }
    return [...out];
  }

  function sendToViewers(rel, message) {
    for (const [client, url] of clientUrls) {
      if (client.readyState !== 1 || !url) continue;
      if (outputForUrl(url) === rel) send(client, message);
    }
  }

  // ---- HTTP -----------------------------------------------------------------

  const app = express();
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

  if (mount) mount(app);

  // Pages: one resolver shared with the reload logic (§6.2), hot reload script injected
  app.use(async (req, res, next) => {
    const rel = outputForUrl(req.path);
    if (!rel.endsWith(".html")) return next();
    const filePath = join(outputDir, rel);
    if (!filePath.startsWith(outputDir + "/") || !existsSync(filePath)) return next();
    try {
      let html = await readFile(filePath, "utf8");
      if (headHtml) html = html.includes("</head>") ? html.replace("</head>", headHtml + "</head>") : headHtml + html;
      const hotReloadScript = getHotReloadScript(HOT_RELOAD_PATH);
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
    const rel = outputForUrl(req.path);
    if (!rel.endsWith(".html") || req.method !== "GET") return next();
    res.status(404);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found</title></head><body><h1>404 Not Found</h1><p><code>${escapeHtml(req.path)}</code> is not part of the site (yet). This page reloads when it appears.</p>${getHotReloadScript(HOT_RELOAD_PATH)}</body></html>`);
  });

  const httpServer = createServer(app);

  // ---- WebSocket --------------------------------------------------------------

  const wss = new WebSocketServer({
    server: httpServer,
    path: HOT_RELOAD_PATH,
    verifyClient: authorizeUpgrade
      ? (info, done) => {
          Promise.resolve()
            .then(() => authorizeUpgrade(info.req))
            .then((ok) => done(Boolean(ok), ok ? undefined : 401), () => done(false, 401));
        }
      : undefined,
  });
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

  // ---- A pass, with client notifications ----------------------------------

  /**
   * Run one pass of `build` (from createBuild), viewed pages first, telling
   * each browser whether and when its page changed. Returns the pass summary.
   *
   * @param {object} build
   * @param {object} [passOpts] - Passed through to build.runPass (e.g. `rescan`)
   */
  async function runPass(build, passOpts = {}) {
    // Snapshot what each viewed page looks like now, so "changed" means the
    // bytes the browser would fetch changed — whichever node ends up owning it
    const viewed = viewedOutputs();
    const before = new Map();
    for (const rel of viewed) before.set(rel, await fileHash(join(outputDir, rel)));
    const notified = new Set(); // output rels already told to reload/fail
    const nodeToOutputs = new Map(); // node id → viewed output rels it owns

    const summary = await build.runPass({
      ...passOpts,
      viewedOutputs: viewed,
      onDirty: (dirty, changed) => {
        // Green indicator for clients whose page (by current owner) is in the dirty set
        for (const [client, url] of clientUrls) {
          if (client.readyState !== 1 || !url) continue;
          const owner = build.graph.ownerOfPath(outputForUrl(url));
          if (owner && dirty.has(owner)) send(client, { type: "update-affects-you", timestamp: Date.now() });
        }
        for (const rel of viewed) {
          const owner = build.graph.ownerOfPath(rel);
          if (owner) nodeToOutputs.set(owner, [...(nodeToOutputs.get(owner) ?? []), rel]);
        }
        passOpts.onDirty?.(dirty, changed);
      },
      onNodeDone: async (id, err) => {
        passOpts.onNodeDone?.(id, err);
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
      moreViewed: () => viewedOutputs().filter((rel) => !viewed.includes(rel)),
    });

    // End of pass: anything not yet told. A page whose owner moved (auto-index
    // took over a deleted index.md) or that was deleted reloads to the truth.
    for (const [client, url] of clientUrls) {
      if (client.readyState !== 1 || !url) continue;
      const rel = outputForUrl(url);
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

  return {
    app,
    httpServer,
    /** The bound port (resolved after listen() when 0 was asked for). */
    get port() {
      return port;
    },
    /** Start listening. Resolves once bound. */
    listen() {
      return new Promise((resolveListen, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.off("error", reject);
          port = httpServer.address().port;
          log(`🌐 Server listening on port ${port} (hot reload at ${HOT_RELOAD_PATH})`);
          resolveListen(port);
        });
      });
    },
    /** Tell every browser a rebuild has started (the "updating" indicator). */
    notifyUpdateStart() {
      broadcast({ type: "update-start", timestamp: Date.now() });
    },
    /** Tell every browser the rebuild it was waiting on did not happen. */
    notifyNoAffect() {
      broadcast({ type: "update-no-affect", timestamp: Date.now() });
    },
    broadcast,
    viewedOutputs,
    outputForUrl,
    runPass,
    clientCount: () => wss.clients.size,
    close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
      return new Promise((r) => httpServer.close(() => r()));
    },
  };
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
