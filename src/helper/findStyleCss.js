import { join, dirname, resolve } from "path";
import { existsSync } from "fs";

/**
 * Recursively search for style.css or _style.css up the directory tree.
 * Returns the path to the first found file, or null if not found.
 * @param {string} startDir - Directory to start searching from
 * @param {string[]} [names=["style.css", "_style.css"]] - Filenames to look for
 * @param {string} [baseDir] - Stop searching when this directory is reached
 * @returns {Promise<string|null>} CSS file path or null
 */
export async function findStyleCss(startDir, names = ["style-ursa.css", "style.css", "_style.css"], baseDir = null) {
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
 * Find ALL style.css or _style.css files from the docroot down to startDir.
 * Walks up from startDir to docroot collecting all matches, then returns them
 * sorted from shortest path (closest to docroot) to longest (closest to startDir).
 * @param {string} startDir - Directory to start searching from (deepest)
 * @param {string} docroot - The root directory to stop at (shallowest)
 * @param {string[]} [names=["style-ursa.css", "style.css", "_style.css"]] - Filenames to look for
 * @returns {Promise<string[]>} Array of CSS file paths, ordered from shallowest to deepest
 */
export async function findAllStyleCss(startDir, docroot, names = ["style-ursa.css", "style.css", "_style.css"]) {
  const found = [];
  let dir = resolve(startDir);
  const base = resolve(docroot);
  while (true) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        found.push(candidate);
        break; // Only one match per directory (prefer style-ursa.css > style.css > _style.css)
      }
    }
    if (dir === base || dir === dirname(dir)) break;
    dir = dirname(dir);
  }
  // Sort from shortest path (docroot) to longest (startDir)
  found.sort((a, b) => a.length - b.length);
  return found;
}
