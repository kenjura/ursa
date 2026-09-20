/**
 * `ursa generate`: one build pass over the incremental build graph.
 *
 * The pass is the same one `ursa serve` runs on every change (see
 * docs/SERVE.md §5.4 and src/helper/build/pass.js). A cold start is a pass in
 * which every leaf is new; a warm start re-checks the persisted graph in
 * `.ursa/graph.json` and recomputes only what its inputs say has changed.
 * Outputs whose source is gone are deleted, so the output directory converges
 * on what a clean build would produce without `--clean`.
 *
 * ## JSON-ONLY MODE (`_jsonOnly`)
 *
 * Emits only the `.json` data files — every document's `<name>.json` and every
 * directory's `<dir>.json` record list — and nothing else. Skipped: HTML, XML,
 * images and their previews, meta/template assets, the React runtime, per-folder
 * CSS/JS bundles, static file copying, the search and full-text indices,
 * recent-activity and menu data, and auto-generated index pages.
 *
 * The emitted JSON is byte-identical to what a full build writes: the JSON's
 * `bodyHtml` is the pre-template render, which none of the skipped steps touch.
 * Mixing modes against one source tree is safe — the graph records what each
 * output consumed, and a node that was never demanded keeps its state.
 */

import { join, resolve } from "path";
import { outputFile } from "fs-extra";
import { createBuild } from "../helper/build/pass.js";
import { getProfiler } from "../helper/build/profiler.js";

export async function generate({
  _source = join(process.cwd(), "."),
  _meta = join(process.cwd(), "meta"),
  _output = join(process.cwd(), "build"),
  _whitelist = null,
  _exclude = null,
  _incremental = false, // Legacy flag, now ignored (always incremental)
  _clean = false, // When true, ignore the graph and regenerate all files
  _deferImages = false, // Legacy: previews are always scheduled after pages
  _deferSearchIndex = false, // Legacy: indices are always scheduled after pages
  _jsonOnly = false, // When true, emit only the .json data files (see JSON-ONLY MODE below)
  _explain = false, // Log why each recomputed node recomputed
} = {}) {
  const profiler = getProfiler(true);
  const source = resolve(_source);
  const meta = resolve(_meta);
  const output = resolve(_output);
  console.log({ source, meta, output, whitelist: _whitelist, exclude: _exclude, clean: _clean, jsonOnly: _jsonOnly });

  profiler.startPhase("Prepare");
  const build = await createBuild({
    source,
    meta,
    output,
    whitelist: _whitelist,
    exclude: _exclude,
    clean: _clean,
    jsonOnly: _jsonOnly,
    explain: _explain,
  });
  profiler.endPhase("Prepare");

  profiler.startPhase("Pass");
  let summary;
  try {
    summary = await build.runPass();
  } finally {
    await build.close();
  }
  profiler.endPhase("Pass");

  // Error report
  if (summary.failures.size > 0) {
    const errorReportPath = join(output, "_errors.log");
    let report = `URSA GENERATION ERROR REPORT\n`;
    report += `Generated: ${new Date().toISOString()}\n`;
    report += `Total errors: ${summary.failures.size}\n\n`;
    report += `${"=".repeat(60)}\nFAILED NODES:\n${"=".repeat(60)}\n\n`;
    for (const id of summary.failures.keys()) report += `  - ${id}\n`;
    report += `\n${"=".repeat(60)}\nERROR DETAILS:\n${"=".repeat(60)}\n\n`;
    for (const [id, error] of summary.failures) {
      const cause = error.cause ?? error;
      report += `${"─".repeat(60)}\nNode: ${id}\nError: ${cause.message}\n`;
      if (cause.stack) report += `Stack:\n${cause.stack}\n`;
      report += `\n`;
    }
    await outputFile(errorReportPath, report);
    console.log(`\n⚠️  ${summary.failures.size} error(s) occurred during generation.`);
    console.log(`   Error report written to: ${errorReportPath}\n`);
  } else {
    console.log(`\n✅ Generation complete with no errors.\n`);
  }

  console.log(profiler.report());

  return {
    summary,
    // Legacy shape: nothing is deferred any more
    deferredImageProcessing: null,
    deferredSearchIndex: null,
  };
}
