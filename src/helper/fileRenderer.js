
import { markdownToHtml } from "./markdownHelper.cjs";
import { wikiToHtml } from "./wikitextHelper.js";
import { renderMDX, generateHydrationScript } from "./mdxRenderer.js";
import { parseWithWorker, terminateParserPool } from "./parserPool.js";

const DEFAULT_WIKITEXT_ARGS = { db: "noDB", noSection: true, noTOC: true };

/**
 * Render a file synchronously (legacy/fallback)
 * Note: .mdx files require async rendering; use renderFileAsync instead.
 * @param {Object} options - Render options
 * @param {string} options.fileContents - Raw file content
 * @param {string} options.type - File extension (.md, .txt)
 * @param {string} options.dirname - Directory name
 * @param {string} options.basename - Base filename
 * @returns {string} Rendered HTML
 */
export function renderFile({ fileContents, type, dirname, basename }) {
  switch (type) {
    case ".md":
      return markdownToHtml(fileContents);
    case ".txt":
      return wikiToHtml({
        wikitext: fileContents,
        articleName: basename,
        args: { ...DEFAULT_WIKITEXT_ARGS, db: dirname },
      })?.html;
  }
}

/**
 * Render a file asynchronously using worker threads for parallel processing
 * Falls back to main thread for wikitext or if workers are unavailable
 * @param {Object} options - Render options
 * @param {string} options.fileContents - Raw file content
 * @param {string} options.type - File extension (.md, .txt, or .mdx)
 * @param {string} options.dirname - Directory name
 * @param {string} options.basename - Base filename
 * @param {string} [options.filePath] - Absolute path to file (required for .mdx)
 * @param {string} [options.sourceRoot] - Source root directory (for .mdx absolute imports)
 * @param {boolean} [options.useWorker=true] - Whether to attempt worker thread parsing
 * @param {boolean} [options.hydrate=false] - Whether to enable client-side hydration (.mdx only)
 * @returns {Promise<string|{html: string, hydrationScript?: string}>} Rendered HTML or object with HTML and hydration script
 */
export async function renderFileAsync({ fileContents, type, dirname, basename, filePath, sourceRoot, useWorker = true, hydrate = false }) {
  // Wikitext always runs on main thread due to complex ES module dependencies
  if (type === ".txt") {
    return wikiToHtml({
      wikitext: fileContents,
      articleName: basename,
      args: { ...DEFAULT_WIKITEXT_ARGS, db: dirname },
    })?.html;
  }
  
  // Markdown can use worker threads
  if (type === ".md") {
    if (useWorker) {
      return parseWithWorker(
        fileContents,
        type,
        dirname,
        basename,
        () => markdownToHtml(fileContents) // Fallback to main thread
      );
    }
    return markdownToHtml(fileContents);
  }

  // MDX uses mdx-bundler + React SSR (always async, no worker support)
  // Falls back to markdown rendering if MDX compilation fails
  if (type === ".mdx") {
    try {
      const result = await renderMDX({ source: fileContents, filePath, sourceRoot, hydrate });
      
      // If hydration was requested and we have client code, return object with hydration script
      if (hydrate && result.clientCode) {
        return {
          html: result.html,
          hydrationScript: generateHydrationScript(result.clientCode),
        };
      }
      
      return result.html;
    } catch (mdxError) {
      // Extract a concise error description for the warning banner
      const errorMsg = mdxError.message || String(mdxError);
      const shortPath = filePath?.split('/').slice(-3).join('/') || 'unknown file';
      
      // Extract the actionable part of the error (skip the "MDX compilation failed for <path>:" preamble)
      const lines = errorMsg.split('\n').filter(l => l.trim());
      const actionableLine = lines.length > 1 ? lines.slice(1).join(' ').trim() : lines[0];
      const errorDetail = actionableLine.slice(0, 300);

      console.warn(`⚠️  MDX compilation failed for ${shortPath}, falling back to Markdown rendering`);
      console.warn(`   ${errorDetail}`);

      // Render as markdown instead (handles raw HTML fine, just no custom components)
      const markdownHtml = markdownToHtml(fileContents);
      const warningBanner = `<div style="background:#fef3cd;border:1px solid #ffc107;color:#856404;padding:0.75rem 1rem;margin-bottom:1rem;border-radius:4px;font-size:0.875rem;">`
        + `<strong>⚠️ MDX compilation error</strong> — this page was rendered as Markdown (custom components like &lt;CharacterCard&gt; will not appear).<br>`
        + `<code style="font-size:0.8rem;word-break:break-all;">${errorDetail.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`
        + `</div>`;
      return warningBanner + markdownHtml;
    }
  }
  
  return undefined;
}

// Re-export for cleanup on shutdown
export { terminateParserPool };