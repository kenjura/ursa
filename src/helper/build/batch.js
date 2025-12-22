// Batch processing helpers for build

/**
 * Process items in batches to limit memory usage
 * @param {Array} items - Items to process
 * @param {Function} processor - Async function to process each item
 * @param {number} batchSize - Max concurrent operations
 */
export async function processBatched(items, processor, batchSize = 50) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
    // Allow GC to run between batches
    if (global.gc) global.gc();
  }
  return results;
}
