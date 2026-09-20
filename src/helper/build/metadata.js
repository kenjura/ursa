// Metadata transformation helpers for build
import { join } from "path";
import { pathToFileURL } from "url";
import { existsSync, readFileSync, hashBytes } from "./tracedFs.js";

/**
 * Get transformed metadata using custom or default transform function.
 *
 * `transformMetadata.js` is loaded with a dynamic `import()`, which Node
 * caches for the life of the process. The specifier carries the file's
 * content hash as a query so an edit takes effect in `serve` without a
 * restart; reading the file to hash it is also what records it as an input
 * of the document.
 *
 * @param {string} dirname - Directory containing the file
 * @param {Object} metadata - Raw metadata object
 * @returns {Promise<string>} Transformed metadata string
 */
export async function getTransformedMetadata(dirname, metadata) {
  // custom transform? else, use default
  const customTransformFnFilename = join(dirname, "transformMetadata.js");
  let transformFn = defaultTransformFn;
  try {
    if (existsSync(customTransformFnFilename)) {
      const source = readFileSync(customTransformFnFilename);
      const url = pathToFileURL(customTransformFnFilename);
      url.searchParams.set("v", hashBytes(source));
      const customTransformFn = (await import(url.href)).default;
      if (typeof customTransformFn === "function")
        transformFn = customTransformFn;
    }
  } catch (e) {
    // No usable custom transform found, use default
  }
  try {
    return transformFn(metadata);
  } catch (e) {
    return "error transforming metadata";
  }

  function defaultTransformFn(metadata) {
    return "default transform";
  }
}
