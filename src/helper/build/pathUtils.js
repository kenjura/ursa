// Path utility helpers for build

/**
 * Add trailing slash to a path if not present
 * @param {string} somePath - Path to modify
 * @returns {string} Path with trailing slash
 */
export function addTrailingSlash(somePath) {
  if (typeof somePath !== "string") return somePath;
  if (somePath.length < 1) return somePath;
  if (somePath[somePath.length - 1] === "/") return somePath;
  return `${somePath}/`;
}
