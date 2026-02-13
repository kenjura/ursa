import { join, dirname, resolve } from "path";
import { existsSync } from "fs";

/**
 * Recursively search for script.js or _script.js up the directory tree.
 * Returns the path to the first found file, or null if not found.
 * @param {string} startDir - Directory to start searching from
 * @param {string[]} [names=["script.js", "_script.js"]] - Filenames to look for
 * @param {string} [baseDir] - Stop searching when this directory is reached
 * @returns {Promise<string|null>} Script file path or null
 */
export async function findScriptJs(startDir, names = ["script.js", "_script.js"], baseDir = null) {
  let dir = resolve(startDir);
  baseDir = baseDir ? resolve(baseDir) : dir.split(/[\\/]/)[0] === '' ? '/' : dir.split(/[\\/]/)[0];
  while (true) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return candidate; // Return path instead of contents
      }
    }
    if (dir === baseDir || dir === dirname(dir)) break;
    dir = dirname(dir);
  }
  return null;
}

/**
 * Find ALL script.js or _script.js files from the docroot down to startDir.
 * Walks up from startDir to docroot collecting all matches, then returns them
 * sorted from shortest path (closest to docroot) to longest (closest to startDir).
 * @param {string} startDir - Directory to start searching from (deepest)
 * @param {string} docroot - The root directory to stop at (shallowest)
 * @param {string[]} [names=["script.js", "_script.js"]] - Filenames to look for
 * @returns {Promise<string[]>} Array of script file paths, ordered from shallowest to deepest
 */
export async function findAllScriptJs(startDir, docroot, names = ["script.js", "_script.js"]) {
  const found = [];
  let dir = resolve(startDir);
  const base = resolve(docroot);
  while (true) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        found.push(candidate);
        break; // Only one match per directory (prefer script.js over _script.js)
      }
    }
    if (dir === base || dir === dirname(dir)) break;
    dir = dirname(dir);
  }
  // Sort from shortest path (docroot) to longest (startDir)
  found.sort((a, b) => a.length - b.length);
  return found;
}
