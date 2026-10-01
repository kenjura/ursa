/**
 * Which filesystem events are inputs (docs/SERVE.md §3.1): a deny-list, never
 * an extension allow-list. Shared by `ursa serve` and by programs that watch a
 * docroot themselves and feed changes to a build (ursa-server).
 */

import { basename, join } from "path";
import { isScratchName } from "./tracedFs.js";

/**
 * @param {object} opts
 * @param {string} opts.source - Docroot (absolute)
 * @param {string} [opts.output] - Output directory (absolute), excluded if inside a watched tree
 * @param {string|null} [opts.cacheDir] - Build cache folder, when not `<source>/.ursa`
 * @returns {(path: string) => boolean} true when the path is never a build input
 */
export function createIgnoreFilter({ source, output = null, cacheDir = null }) {
  const excludedRoots = [
    join(source, ".ursa"),
    join(source, ".ursa.json"),
    ...(output ? [output] : []),
    ...(cacheDir ? [cacheDir] : []),
  ];
  return function isIgnoredPath(path) {
    for (const root of excludedRoots) {
      if (path === root || path.startsWith(root + "/")) return true;
    }
    for (const part of path.split("/")) {
      if (part === "node_modules" || part === ".git") return true;
    }
    const name = basename(path);
    if (isScratchName(name)) return true;
    // Dot-files (editor scratch, OS metadata) are never inputs
    if (name.startsWith(".")) return true;
    return false;
  };
}
