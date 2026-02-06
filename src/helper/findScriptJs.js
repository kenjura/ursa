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
