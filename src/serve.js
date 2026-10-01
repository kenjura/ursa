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

import watch from "node-watch";
import { resolve, relative } from "path";
import { promises as fsp } from "fs";
import { resolvePort } from "./helper/portUtils.js";
import { createBuild } from "./helper/build/pass.js";
import { createIgnoreFilter } from "./helper/build/watchFilter.js";
import { createDevServer } from "./devServer.js";

const { mkdir } = fsp;

const DEBOUNCE_QUIET_MS = 500;
const DEBOUNCE_MAX_MS = 2000;

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
  _directoryJson = true,
  _directoryDepth = Infinity,
  _concurrency = undefined,
} = {}) {
  const sourceDir = resolve(_source);
  const metaDir = resolve(_meta);
  const outputDir = resolve(_output);

  console.log({ source: sourceDir, meta: metaDir, output: outputDir, port, whitelist: _whitelist, exclude: _exclude, clean: _clean });

  // Resolve port (prompt user if occupied)
  port = await resolvePort(port, { strict: strictPort });

  // Ensure output directory exists and start server immediately
  await mkdir(outputDir, { recursive: true });
  const dev = createDevServer({ outputDir, port });
  await dev.listen();
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
    directoryJson: _directoryJson,
    directoryDepth: _directoryDepth,
    concurrency: _concurrency,
  });

  // ---- Batching and the single writer ------------------------------------

  let pending = new Set(); // paths with events in the current batch
  let quietTimer = null;
  let maxTimer = null;
  let batchStartedAt = 0;
  let running = false;

  /** Paths never treated as inputs (§3.1). */
  const isIgnoredPath = createIgnoreFilter({ source: sourceDir, output: outputDir });

  function queueChange(evt, path) {
    if (isIgnoredPath(path)) return;
    if (pending.size === 0 && !running) {
      dev.notifyUpdateStart();
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
      // folder alone (§3.2).
      build.invalidate(paths);
      console.log(`\n🔄 ${paths.length} change(s) after ${Date.now() - batchStartedAt}ms: ${paths.slice(0, 5).map((p) => relative(sourceDir, p) || p).join(", ")}${paths.length > 5 ? ", …" : ""}`);
      await runPassWithClients();
    } catch (e) {
      console.error("Error during regeneration:", e);
      dev.notifyNoAffect();
    } finally {
      running = false;
      // Changes that arrived while the pass ran: next batch, no debounce (§5.5)
      if (pending.size > 0) {
        console.log(`▶️  Processing ${pending.size} change(s) queued during the last pass`);
        setImmediate(runQueued);
      }
    }
  }

  const runPassWithClients = () => dev.runPass(build);

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
