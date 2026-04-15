import express from "express";
import compression from "compression";
import watch from "node-watch";
import { generate, regenerateAffectedDocuments, clearWatchCache, clearScriptCache, clearStyleCache } from "./jobs/generate.js";
import { join, resolve, dirname, basename } from "path";
import fs from "fs";
import { promises } from "fs";
import { copy as copyDir, outputFile } from "fs-extra";
import { processImage } from "./helper/imageProcessor.js";
import { watchModeCache } from "./helper/build/watchCache.js";
import { dependencyTracker } from "./helper/dependencyTracker.js";
import { bundleMetaTemplateAssets, clearMetaBundleCache } from "./helper/assetBundler.js";
import { getTemplates, copyMetaAssets } from "./helper/build/templates.js";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { resolvePort } from "./helper/portUtils.js";
const { readdir, mkdir, readFile, copyFile } = promises;

// WebSocket server for hot reloading
let wss = null;

/**
 * Map of WebSocket client → current page URL path (e.g. '/campaigns/abs/index.html')
 * Updated when clients send { type: 'url', url: '...' } messages.
 */
const clientUrls = new Map();

/**
 * Get URL paths that connected WebSocket clients are currently viewing.
 * @returns {string[]} Array of unique URL paths
 */
function getClientViewedUrls() {
  const urls = new Set();
  for (const [client, url] of clientUrls) {
    if (client.readyState === 1 && url) urls.add(url);
  }
  return [...urls];
}

/**
 * Normalize a URL path for comparison.
 * Converts /path/index.html → /path/, /path.html → /path.html
 * Strips trailing whitespace. Ensures leading /.
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  if (!url) return '/';
  let u = url.trim();
  if (!u.startsWith('/')) u = '/' + u;
  // /foo/index.html → /foo/
  if (u.endsWith('/index.html')) u = u.slice(0, -10);
  // Ensure trailing slash for directory-like paths (no extension)
  if (!u.includes('.') && !u.endsWith('/')) u = u + '/';
  return u;
}

/**
 * Convert a source file path to the URL path it would produce,
 * normalized for comparison with client URLs.
 * e.g. /Users/.../docs/campaigns/abs/index.mdx → /campaigns/abs/
 * @param {string} docPath - Absolute source path
 * @param {string} sourceDir - Absolute source directory (with trailing slash)
 * @returns {string} Normalized URL path
 */
function docPathToUrl(docPath, sourceDir) {
  const normalizedSource = sourceDir.endsWith('/') ? sourceDir : sourceDir + '/';
  const rawUrl = '/' + docPath.replace(normalizedSource, '').replace(/\.(md|mdx|txt|yml|yaml)$/, '.html');
  return normalizeUrl(rawUrl);
}

/**
 * Broadcast a message to all connected WebSocket clients.
 * @param {object} messageObj - Object to JSON.stringify and send
 */
function broadcastMessage(messageObj) {
  if (!wss) return;
  const message = JSON.stringify(messageObj);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(message);
  });
}

/**
 * Send a message only to clients viewing a specific set of URLs.
 * Compares using normalizeUrl for consistent matching.
 * @param {object} messageObj - Object to send
 * @param {Set<string>} urls - Set of normalized URL paths to match against
 */
function sendToClientsViewing(messageObj, urls) {
  if (!wss) return;
  const message = JSON.stringify(messageObj);
  for (const [client, clientUrl] of clientUrls) {
    if (client.readyState === 1 && clientUrl && urls.has(normalizeUrl(clientUrl))) {
      client.send(message);
    }
  }
}

/**
 * Broadcast a reload message to all connected clients
 * @param {string} [changedFile] - Optional path of the changed file
 */
function broadcastReload(changedFile = null) {
  broadcastMessage({ type: 'reload', file: changedFile, timestamp: Date.now() });
  const clientCount = wss ? wss.clients.size : 0;
  if (clientCount > 0) {
    console.log(`🔄 Hot reload: notified ${clientCount} browser${clientCount > 1 ? 's' : ''}`);
  }
}

/**
 * Send reload only to clients viewing the given URL paths.
 * Other clients get 'update-no-affect' to clear their loading indicator.
 * @param {Set<string>} affectedUrls - URL paths that were regenerated
 * @param {string} [changedFile] - Source file that changed
 */
function reloadAffectedClients(affectedUrls, changedFile = null) {
  if (!wss) return;
  let reloaded = 0;
  let cleared = 0;
  for (const [client, clientUrl] of clientUrls) {
    if (client.readyState !== 1) continue;
    const normalized = normalizeUrl(clientUrl);
    if (normalized && affectedUrls.has(normalized)) {
      client.send(JSON.stringify({ type: 'reload', file: changedFile, timestamp: Date.now() }));
      reloaded++;
    } else {
      client.send(JSON.stringify({ type: 'update-no-affect', timestamp: Date.now() }));
      cleared++;
    }
  }
  if (reloaded > 0) {
    console.log(`🔄 Hot reload: ${reloaded} affected client${reloaded > 1 ? 's' : ''} reloaded${cleared > 0 ? `, ${cleared} unaffected` : ''}`);
  }
}

/**
 * Generate the hot reload client script
 * @param {number} wsPort - WebSocket server port
 * @returns {string} JavaScript code to inject
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
    
    ws.onerror = function(error) {
      console.error('[Ursa] Hot reload WebSocket error');
    };
  }
  
  connect();

  // Track navigation (SPA-style or hash changes)
  window.addEventListener('popstate', sendUrl);
  // Also re-send on page visibility change (e.g. tab switch)
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) sendUrl();
  });
})();
</script>
`;
}

// Lock for preventing concurrent regenerations
let isRegenerating = false;

// Debounce state for file change batching
const DEBOUNCE_MS = 500; // Wait 500ms of quiet before starting regeneration
let pendingChanges = [];    // { evt, name, watcher: 'source'|'meta' }
let debounceTimer = null;

/**
 * Copy a single CSS file to the output directory
 * @param {string} cssPath - Absolute path to the CSS file
 * @param {string} sourceDir - Source directory root
 * @param {string} outputDir - Output directory root
 */
async function copyCssFile(cssPath, sourceDir, outputDir) {
  const startTime = Date.now();
  const relativePath = cssPath.replace(sourceDir, '');
  const outputPath = join(outputDir, relativePath);
  
  try {
    const content = await readFile(cssPath, 'utf8');
    await outputFile(outputPath, content);
    const elapsed = Date.now() - startTime;
    return { success: true, message: `Copied ${relativePath} in ${elapsed}ms` };
  } catch (e) {
    return { success: false, message: `Error copying CSS: ${e.message}` };
  }
}

// Static file extensions that should be copied (images, fonts, etc.)
const STATIC_FILE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|eot|pdf|mp3|mp4|webm|ogg)$/i;
// Image extensions that get preview processing
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i;

/**
 * Copy a single static file to the output directory
 * For images, also generates a preview version and updates the imageMap cache
 * @param {string} filePath - Absolute path to the static file
 * @param {string} sourceDir - Source directory root
 * @param {string} outputDir - Output directory root
 */
async function copyStaticFile(filePath, sourceDir, outputDir) {
  const startTime = Date.now();
  const relativePath = filePath.replace(sourceDir, '');
  const relativeDir = dirname(relativePath);
  const absoluteOutputDir = join(outputDir, relativeDir);
  
  try {
    // Check if this is an image that needs preview processing
    if (IMAGE_EXTENSIONS.test(filePath)) {
      const result = await processImage(filePath, absoluteOutputDir, relativeDir);
      const elapsed = Date.now() - startTime;
      
      // Update the watchModeCache.imageMap so regenerated documents can use the new image
      if (result && watchModeCache.imageMap) {
        // The key is the absolute URL path (e.g., /campaigns/ABS/img/map.jpg)
        const imageKey = result.original;
        watchModeCache.imageMap.set(imageKey, result);
      }
      
      if (result && result.preview !== result.original) {
        return { success: true, message: `Processed ${relativePath} with preview in ${elapsed}ms` };
      }
      return { success: true, message: `Copied ${relativePath} in ${elapsed}ms` };
    }
    
    // For non-image files, just copy
    const outputPath = join(outputDir, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(filePath, outputPath);
    const elapsed = Date.now() - startTime;
    return { success: true, message: `Copied ${relativePath} in ${elapsed}ms` };
  } catch (e) {
    return { success: false, message: `Error copying static file: ${e.message}` };
  }
}

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
  _exclude = null
} = {}) {
  const sourceDir = resolve(_source);
  const metaDir = resolve(_meta);
  const outputDir = resolve(_output);

  console.log({ source: sourceDir, meta: metaDir, output: outputDir, port, whitelist: _whitelist, exclude: _exclude, clean: _clean });

  // Resolve port (prompt user if occupied)
  port = await resolvePort(port);

  // Ensure output directory exists and start server immediately
  await mkdir(outputDir, { recursive: true });
  serveFiles(outputDir, port);
  console.log(`🚀 Development server running at http://localhost:${port}`);
  console.log("📁 Serving files from:", outputDir);
  console.log("⏳ Generating site in background (deferred image + search index processing)...\n");

  // Initial generation with deferred image and search index processing for faster startup
  // This also initializes the watch cache for fast single-file updates
  generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist, _exclude, _clean, _deferImages: true, _deferSearchIndex: true })
    .then(async (result) => {
      console.log("\n✅ Initial HTML generation complete. Fast single-file regeneration enabled.");
      console.log("   Note: Images/search may be incomplete until background processing completes.\n");
      
      // Wait for deferred processing to complete in parallel
      const promises = [];
      
      if (result && result.deferredImageProcessing) {
        promises.push(
          result.deferredImageProcessing
            .then(() => console.log("\n✅ Image preview generation complete."))
            .catch(error => console.error("Error during image processing:", error.message))
        );
      }
      
      if (result && result.deferredSearchIndex) {
        promises.push(
          result.deferredSearchIndex
            .then(() => console.log("✅ Search index generation complete."))
            .catch(error => console.error("Error during search index generation:", error.message))
        );
      }
      
      await Promise.all(promises);
      if (promises.length > 0) {
        console.log("\n✅ Full site ready.\n");
      }
    })
    .catch((error) => console.error("Error during initial generation:", error.message));

  // Watch for changes
  console.log("👀 Watching for changes in:");
  console.log("   Source:", sourceDir, "(fast single-file mode)");
  console.log("   Meta:", metaDir, "(full rebuild)");
  console.log("\nPress Ctrl+C to stop the server\n");

  /**
   * Queue a file change for debounced batch processing.
   * Sends 'update-start' to all clients on the first change in a batch.
   * Resets the 500ms debounce timer on each subsequent change.
   */
  function queueChange(evt, name, watcher) {
    // Send 'update-start' immediately on first change in a batch
    if (pendingChanges.length === 0) {
      broadcastMessage({ type: 'update-start', timestamp: Date.now() });
    }
    pendingChanges.push({ evt, name, watcher });

    // Reset debounce timer
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const batch = pendingChanges.splice(0);
      processChangeBatch(batch, sourceDir, metaDir, outputDir, _whitelist, _exclude);
    }, DEBOUNCE_MS);
  }

  /**
   * Process a batch of accumulated file changes.
   * Categorizes changes, handles immediate operations (copies), then
   * regenerates affected documents with priority ordering.
   */
  async function processChangeBatch(batch, sourceDir, metaDir, outputDir, _whitelist, _exclude) {
    if (isRegenerating) {
      console.log(`⏳ Debounce batch skipped (regeneration already in progress) — ${batch.length} changes lost`);
      broadcastMessage({ type: 'update-no-affect', timestamp: Date.now() });
      return;
    }
    isRegenerating = true;

    try {
      // Categorize changes
      const metaChanges = batch.filter(c => c.watcher === 'meta');
      const sourceChanges = batch.filter(c => c.watcher === 'source');

      const cssChanges = sourceChanges.filter(c => c.name?.endsWith('.css'));
      const scriptJsChanges = sourceChanges.filter(c => c.name && basename(c.name) === 'script.js');
      const staticChanges = sourceChanges.filter(c => c.name && STATIC_FILE_EXTENSIONS.test(c.name));
      const menuConfigChanges = sourceChanges.filter(c => {
        if (!c.name) return false;
        return c.name.includes('_menu') || c.name.includes('menu.') || c.name.includes('_config') || c.name.includes('.ursa');
      });
      const articleChanges = sourceChanges.filter(c => c.name && /\.(md|mdx|txt|yml)$/.test(c.name))
        .filter(c => !menuConfigChanges.some(m => m.name === c.name)); // exclude menu files already handled
      const otherSourceChanges = sourceChanges.filter(c =>
        !cssChanges.includes(c) && !scriptJsChanges.includes(c) && !staticChanges.includes(c) &&
        !menuConfigChanges.includes(c) && !articleChanges.includes(c)
      );

      const allNames = batch.map(c => c.name).filter(Boolean);
      const uniqueNames = [...new Set(allNames)];
      console.log(`\n📦 Processing batch: ${uniqueNames.length} file(s) changed`);
      for (const n of uniqueNames) console.log(`   ${n}`);

      // Track whether we need a full rebuild (menu/config change, or unknown meta change)
      let needsFullRebuild = false;
      let fullRebuildReason = '';
      // Collect all document paths that need regeneration (for selective rebuild)
      const affectedDocPaths = new Set();

      // --- 1) Handle static file copies (immediate, no rebuild) ---
      for (const change of staticChanges) {
        const { evt, name } = change;
        if (evt === 'remove') {
          const relativePath = name.replace(sourceDir, '');
          const outputPath = join(outputDir, relativePath);
          try { await promises.unlink(outputPath); console.log(`🗑️  Removed static: ${relativePath}`); } catch {}
        } else {
          const result = await copyStaticFile(name, sourceDir + '/', outputDir + '/');
          if (result.success) console.log(`✅ ${result.message}`);
        }
      }

      // --- 2) Handle CSS copies + gather affected docs ---
      for (const change of cssChanges) {
        const result = await copyCssFile(change.name, sourceDir + '/', outputDir + '/');
        if (result.success) console.log(`✅ ${result.message}`);
        // Clear CSS bundle cache so affected documents will regenerate bundles
        clearStyleCache();
        if (watchModeCache.isInitialized) {
          const plan = dependencyTracker.getInvalidationPlan(change.name, sourceDir);
          if (plan.requiresFullRebuild) {
            needsFullRebuild = true;
            fullRebuildReason = plan.reason;
          } else {
            plan.affectedDocuments.forEach(d => affectedDocPaths.add(d));
          }
        }
      }

      // --- 3) Handle script.js copies + gather affected docs ---
      for (const change of scriptJsChanges) {
        const relativePath = change.name.replace(sourceDir + '/', '').replace(sourceDir, '');
        const outputPath = join(outputDir, relativePath);
        const content = await readFile(change.name, 'utf8');
        await outputFile(outputPath, content);
        console.log(`✅ Copied ${relativePath}`);
        // Clear script bundle cache so affected documents will regenerate bundles
        clearScriptCache();
        if (watchModeCache.isInitialized) {
          const plan = dependencyTracker.getInvalidationPlan(change.name, sourceDir);
          plan.affectedDocuments.forEach(d => affectedDocPaths.add(d));
        }
      }

      // --- 4) Handle meta changes ---
      if (metaChanges.length > 0) {
        console.log(`🎨 Processing ${metaChanges.length} meta change(s)`);
        const pub = join(outputDir, 'public');
        clearMetaBundleCache();
        await copyMetaAssets(metaDir, pub);
        const freshTemplates = await getTemplates(metaDir);
        const bundledTemplates = await bundleMetaTemplateAssets(freshTemplates, metaDir, pub, { minify: true, sourcemap: false });
        console.log('🔄 Reloaded and re-bundled meta templates');

        if (watchModeCache.isInitialized) {
          watchModeCache.templates = bundledTemplates;
          // Check each meta change for its invalidation plan
          for (const change of metaChanges) {
            const plan = dependencyTracker.getMetaInvalidationPlan(change.name, metaDir);
            if (plan.requiresFullRebuild) {
              needsFullRebuild = true;
              fullRebuildReason = plan.reason;
            } else {
              plan.affectedDocuments.forEach(d => affectedDocPaths.add(d));
            }
          }
        } else {
          needsFullRebuild = true;
          fullRebuildReason = 'Cache not initialized';
        }
      }

      // --- 5) Handle menu/config changes → force full rebuild ---
      if (menuConfigChanges.length > 0) {
        needsFullRebuild = true;
        fullRebuildReason = `Menu/config change: ${menuConfigChanges.map(c => basename(c.name)).join(', ')}`;
        // Delete on-disk caches to force full navigation + content rebuild
        const ursaDir = join(sourceDir, '.ursa');
        try { await promises.unlink(join(ursaDir, 'content-hashes.json')); } catch {}
        try { await promises.unlink(join(ursaDir, 'nav-cache.json')); } catch {}
      }

      // --- 6) Handle article changes via fast single-file regen ---
      // Deduplicate articles (same file may appear multiple times in rapid saves)
      const uniqueArticles = [...new Set(articleChanges.map(c => c.name))];
      for (const articlePath of uniqueArticles) {
        affectedDocPaths.add(articlePath);
      }

      // --- 7) Handle other source changes → full rebuild ---
      if (otherSourceChanges.length > 0) {
        needsFullRebuild = true;
        fullRebuildReason = `Non-standard source change: ${otherSourceChanges.map(c => basename(c.name || 'unknown')).join(', ')}`;
      }

      // --- 8) Execute rebuild ---
      if (needsFullRebuild) {
        console.log(`📦 Full rebuild required: ${fullRebuildReason}`);
        clearWatchCache();
        try {
          const result = await generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist, _exclude, _deferImages: true, _deferSearchIndex: true });
          console.log("HTML regeneration complete.");
          if (result?.deferredImageProcessing) {
            result.deferredImageProcessing.then(() => console.log("Image preview generation complete.")).catch(e => console.error("Image processing error:", e.message));
          }
          if (result?.deferredSearchIndex) {
            result.deferredSearchIndex.then(() => console.log("Search index generation complete.")).catch(e => console.error("Search index error:", e.message));
          }
          // Full rebuild: reload all clients
          broadcastReload(uniqueNames[0]);
        } catch (genError) {
          console.error(`❌ Full rebuild failed:`, genError);
          console.error(genError.stack);
          // Still reload — fresh content may be partially written, better than stale
          broadcastReload(uniqueNames[0]);
        }
      } else if (affectedDocPaths.size > 0) {
        // Selective rebuild with priority ordering
        const docPathsArray = [...affectedDocPaths];

        // Determine which URLs clients are viewing, map to source paths for priority
        const viewedUrls = getClientViewedUrls().map(normalizeUrl);
        const priorityPaths = [];
        const affectedUrlSet = new Set();

        for (const docPath of docPathsArray) {
          const url = docPathToUrl(docPath, sourceDir + '/');
          affectedUrlSet.add(url);
          if (viewedUrls.includes(url)) {
            priorityPaths.push(docPath);
          }
        }

        console.log(`🔀 Selective rebuild: ${docPathsArray.length} docs, ${priorityPaths.length} priority`);
        if (priorityPaths.length > 0) {
          console.log(`   Priority: ${priorityPaths.map(p => basename(p)).join(', ')}`);
        }
        console.log(`   Client URLs: ${viewedUrls.join(', ') || '(none)'}`);
        console.log(`   Affected URLs: ${[...affectedUrlSet].slice(0, 5).join(', ')}${affectedUrlSet.size > 5 ? ` +${affectedUrlSet.size - 5} more` : ''}`);

        // Notify clients whether the change affects them
        if (affectedUrlSet.size > 0) {
          sendToClientsViewing({ type: 'update-affects-you', timestamp: Date.now() }, affectedUrlSet);
        }

        const regenResult = await regenerateAffectedDocuments(docPathsArray, {
          _source: sourceDir, _meta: metaDir, _output: outputDir,
          reason: `batch: ${uniqueNames.map(n => basename(n)).join(', ')}`,
          priorityPaths,
          onPriorityComplete: ({ regenerated, failed, priorityDocs }) => {
            if (regenerated > 0) {
              // Immediately reload clients whose pages are now ready
              const readyUrls = new Set(priorityDocs.map(p => docPathToUrl(p, sourceDir + '/')));
              console.log(`⚡ Priority complete: ${regenerated} OK, ${failed} failed → reloading clients`);
              reloadAffectedClients(readyUrls, uniqueNames[0]);
            } else if (failed > 0) {
              console.warn(`⚠️  Priority regen failed for all ${failed} docs — not reloading yet`);
            }
          },
        });

        // After all remaining docs are done, reload any remaining affected clients
        // (non-priority clients that weren't reloaded during onPriorityComplete)
        const priorityUrlSet = new Set(priorityPaths.map(p => docPathToUrl(p, sourceDir + '/')));
        const remainingUrls = new Set([...affectedUrlSet].filter(u => !priorityUrlSet.has(u)));
        if (remainingUrls.size > 0) {
          reloadAffectedClients(remainingUrls, uniqueNames[0]);
        }

        // If priority docs all failed, try reloading anyway now that remaining are done
        if (priorityPaths.length > 0 && regenResult.regenerated > 0) {
          const failedPriorityUrls = new Set();
          // Check if any priority was among the failed — reload all affected as fallback
          for (const pp of priorityPaths) {
            failedPriorityUrls.add(docPathToUrl(pp, sourceDir + '/'));
          }
          // If regeneration succeeded overall, make sure all priority clients got reloaded
          for (const [client, clientUrl] of clientUrls) {
            if (client.readyState === 1 && clientUrl && failedPriorityUrls.has(normalizeUrl(clientUrl))) {
              // Client might not have been reloaded if their specific doc failed but others succeeded
              // The onPriorityComplete callback should have handled this, this is a safety net
            }
          }
        }

        // Clear indicator for clients not affected at all
        for (const [client, clientUrl] of clientUrls) {
          if (client.readyState === 1 && clientUrl && !affectedUrlSet.has(normalizeUrl(clientUrl))) {
            client.send(JSON.stringify({ type: 'update-no-affect', timestamp: Date.now() }));
          }
        }
      } else {
        // No documents affected (e.g. static-only changes) — reload all clients
        if (staticChanges.length > 0) {
          broadcastReload(uniqueNames[0]);
        } else {
          // Nothing to do — clear indicators
          broadcastMessage({ type: 'update-no-affect', timestamp: Date.now() });
        }
      }
    } catch (error) {
      console.error(`❌ Error during batch processing:`, error);
      console.error(error.stack);
      // Reload clients as fallback — stale content with a reload is better than a stuck spinner
      broadcastReload();
    } finally {
      isRegenerating = false;
    }
  }
  
  // Meta changes: queue for debounced batch processing
  watch(metaDir, { recursive: true, filter: /\.(js|json|css|html|md|txt|yml|yaml)$/ }, (evt, name) => {
    queueChange(evt, name, 'meta');
  });

  // Source changes: queue for debounced batch processing
  watch(sourceDir, { 
    recursive: true, 
    filter: (f, skip) => {
      // Skip .ursa folder (contains hash cache that gets updated during generation)
      if (/[\/\\]\.ursa[\/\\]?/.test(f)) return skip;
      // Watch article files, config files, and static assets
      return /\.(js|json|css|html|md|mdx|txt|yml|yaml|tsx|ts|jsx|jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|eot|pdf|mp3|mp4|webm|ogg)$/i.test(f);
    }
  }, (evt, name) => {
    queueChange(evt, name, 'source');
  });
}

/**
 * Start HTTP server to serve static files with hot reload support
 * @param {string} outputDir - Directory to serve files from
 * @param {number} port - HTTP server port
 * @returns {object} Object containing httpServer and wsPort
 */
function serveFiles(outputDir, port = 8080) {
  const app = express();
  const wsPort = port + 1; // WebSocket on port+1

  // Enable gzip compression for all responses
  // This significantly reduces transfer size for JSON and HTML files
  app.use(compression({
    // Compress everything over 1KB
    threshold: 1024,
    // Use default compression level (good balance of speed vs size)
    level: 6
  }));

  // Middleware to inject hot reload script into HTML responses
  app.use(async (req, res, next) => {
    // Only intercept HTML requests
    const url = req.url;
    const isHtmlRequest = url.endsWith('.html') || 
                          url.endsWith('/') || 
                          !url.includes('.') ||
                          url === '/';
    
    if (!isHtmlRequest) {
      return next();
    }
    
    // Determine the file path
    let filePath;
    if (url === '/' || url.endsWith('/')) {
      filePath = join(outputDir, url, 'index.html');
    } else if (url.endsWith('.html')) {
      filePath = join(outputDir, url);
    } else {
      // Try adding .html extension
      filePath = join(outputDir, url + '.html');
      if (!fs.existsSync(filePath)) {
        filePath = join(outputDir, url, 'index.html');
      }
    }
    
    try {
      if (fs.existsSync(filePath)) {
        let html = await readFile(filePath, 'utf8');
        // Inject hot reload script before </body>
        const hotReloadScript = getHotReloadScript(wsPort);
        if (html.includes('</body>')) {
          html = html.replace('</body>', hotReloadScript + '</body>');
        } else {
          html += hotReloadScript;
        }
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      } else {
        next();
      }
    } catch (error) {
      next();
    }
  });

  // Fallback static file serving for non-HTML files
  app.use(
    express.static(outputDir, { extensions: ["html"], index: "index.html" })
  );

  // Create HTTP server
  const httpServer = createServer(app);
  
  // Create WebSocket server for hot reload
  wss = new WebSocketServer({ port: wsPort });
  
  wss.on('connection', (ws) => {
    // Send a ping to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) {
        ws.ping();
      }
    }, 30000);
    
    // Handle messages from the client (URL tracking)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'url' && msg.url) {
          clientUrls.set(ws, msg.url);
        }
      } catch (e) { /* ignore non-JSON messages */ }
    });
    
    ws.on('close', () => {
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

/**
 * we're only interested in meta (and maybe, in the future, source)
 * for src changes, we need the node process to restart
 */
function filter(filename, skip) {
  // console.log("testing ", filename);
  if (/\/build/.test(filename)) return skip;
  if (/\/node_modules/.test(filename)) return skip;
  if (/\.git/.test(filename)) return skip;
  if (/\/src/.test(filename)) return skip;
  if (/\/meta/.test(filename)) return true;
  return false;
}

// Default serve function for backward compatibility (only run when executed directly)
if (import.meta.url === `file://${process.argv[1]}`) {
  const source = resolve(process.env.SOURCE ?? join(process.cwd(), "source"));
  const meta = resolve(process.env.META ?? join(process.cwd(), "meta"));
  const output = resolve(process.env.OUTPUT ?? join(process.cwd(), "build"));

  console.log({ source, meta, output });

  await generate({ _source: source, _meta: meta, _output: output });
  console.log("done generating. now serving...");

  serveFiles(output);

  watch(meta, { recursive: true }, async (evt, name) => {
    console.log("meta files changed! generating output");
    await generate({ _source: source, _meta: meta, _output: output });
  });

  watch(source, { recursive: true }, async (evt, name) => {
    console.log("source files changed! generating output");
    await generate({ _source: source, _meta: meta, _output: output });
  });
}
