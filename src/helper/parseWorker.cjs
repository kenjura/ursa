/**
 * Worker thread for parallel markdown/wikitext parsing
 * This file runs in a separate worker thread to parallelize CPU-bound parsing operations
 */
const { parentPort, workerData } = require('worker_threads');
const { markdownToHtml } = require('./markdownHelper.cjs');

// We need to handle wikitext conversion differently since it's an ES module
// For now, we'll handle markdown in the worker and fallback to main thread for wikitext

/**
 * Parse markdown content to HTML
 * @param {string} content - Raw markdown content
 * @returns {string} HTML output
 */
function parseMarkdown(content) {
  return markdownToHtml(content);
}

// Listen for parsing requests
parentPort.on('message', (task) => {
  try {
    const { id, content, type, dirname, basename } = task;
    
    let result;
    if (type === '.md') {
      result = parseMarkdown(content);
    } else {
      // For wikitext (.txt), return null to indicate main thread should handle it
      // This is because wikiToHtml is an ES module with complex dependencies
      result = null;
    }
    
    parentPort.postMessage({ id, result, error: null });
  } catch (error) {
    parentPort.postMessage({ 
      id: task.id, 
      result: null, 
      error: error.message 
    });
  }
});
