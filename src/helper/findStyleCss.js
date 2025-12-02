import { join, dirname, resolve } from "path";
import { existsSync } from "fs";

/**
 * Recursively search for style.css or _style.css up the directory tree.
 * Returns the contents of the first found file, or null if not found.
 * @param {string} startDir - Directory to start searching from
 * @param {string[]} [names=["style.css", "_style.css"]] - Filenames to look for
 * @param {string} [baseDir] - Stop searching when this directory is reached
 * @returns {Promise<string|null>} CSS contents or null
 */
export async function findStyleCss(startDir, names = ["style-ursa.css", "style.css", "_style.css"], baseDir = null) {
  let dir = resolve(startDir);
  baseDir = baseDir ? resolve(baseDir) : dir.split(/[\\/]/)[0] === '' ? '/' : dir.split(/[\\/]/)[0];
  while (true) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return (await import('fs/promises')).readFile(candidate, "utf8");
      }
    }
    if (dir === baseDir || dir === dirname(dir)) break;
    dir = dirname(dir);
  }
  return null;
}
