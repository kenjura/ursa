// Metadata transformation helpers for build
import { join } from "path";

/**
 * Get transformed metadata using custom or default transform function
 * @param {string} dirname - Directory containing the file
 * @param {Object} metadata - Raw metadata object
 * @returns {Promise<string>} Transformed metadata string
 */
export async function getTransformedMetadata(dirname, metadata) {
  // custom transform? else, use default
  const customTransformFnFilename = join(dirname, "transformMetadata.js");
  let transformFn = defaultTransformFn;
  try {
    const customTransformFn = (await import(customTransformFnFilename)).default;
    if (typeof customTransformFn === "function")
      transformFn = customTransformFn;
  } catch (e) {
    // No custom transform found, use default
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
