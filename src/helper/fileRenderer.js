
import { markdownToHtml } from "./markdownHelper.cjs";
import { wikiToHtml } from "./wikitextHelper.js";
import { parseWithWorker, terminateParserPool } from "./parserPool.js";

const DEFAULT_WIKITEXT_ARGS = { db: "noDB", noSection: true, noTOC: true };

/**
 * Render a file synchronously (legacy/fallback)
 * @param {Object} options - Render options
 * @param {string} options.fileContents - Raw file content
 * @param {string} options.type - File extension (.md or .txt)
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
 * @param {string} options.type - File extension (.md or .txt)
 * @param {string} options.dirname - Directory name
 * @param {string} options.basename - Base filename
 * @param {boolean} options.useWorker - Whether to attempt worker thread parsing (default: true)
 * @returns {Promise<string>} Rendered HTML
 */
export async function renderFileAsync({ fileContents, type, dirname, basename, useWorker = true }) {
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
  
  return undefined;
}

// Re-export for cleanup on shutdown
export { terminateParserPool };