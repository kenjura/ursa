import { existsSync, readFileSync } from './build/tracedFs.js';
import { join, dirname } from 'path';

const CONFIG_FILENAME = 'config.json';

/**
 * Folder configuration schema:
 * {
 *   label?: string,       // Custom label for menu display
 *   icon?: string,        // URL to icon image for menu
 *   hidden?: boolean,     // If true, ignore the folder entirely (see below)
 *   openMenuItems?: string[]  // (root only) Array of folder names to expand by default
 * }
 * 
 * `hidden: true` means *ignored*, not merely unlisted. The folder and its
 * whole subtree take no part in the build: no HTML is rendered from its
 * documents, its images and other static assets are not copied, it does not
 * appear in the sidebar menu, in any auto-index, in breadcrumbs, or in the
 * search index, and `ursa serve` will not render its pages on demand. The
 * files stay in the docroot; the site behaves as if they were not there.
 */

/**
 * Kept for callers that used to reset the per-run cache. There is no cache
 * any more: every read goes to the (traced) filesystem so that the build
 * graph records config.json as an input of whatever consulted it. A cached
 * hit would record nothing, and a `hidden: true` flip would go unnoticed.
 */
export function clearConfigCache() {}

/**
 * Read and parse a folder's config.json if it exists (synchronous)
 * @param {string} folderPath - Absolute path to the folder
 * @returns {object|null} Parsed config object or null if not found
 */
export function getFolderConfig(folderPath) {
  const configPath = join(folderPath, CONFIG_FILENAME);
  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn(`Could not read folder config at ${configPath}:`, e.message);
  }
  return null;
}

/**
 * Get the root folder's config
 * @param {string} sourceRoot - The source root directory
 * @returns {object|null} Config object or null
 */
export function getRootConfig(sourceRoot) {
  return getFolderConfig(sourceRoot.replace(/\/$/, ''));
}

/**
 * True when this exact folder's own config.json says `hidden: true`, ignoring
 * its ancestors.
 *
 * Use this where the ancestors have already been ruled out — walking a tree
 * top-down, say, where reaching a node means every folder above it was
 * visible. It needs no docroot, which is what makes it usable in the
 * auto-index builders, where only the folder being listed is known.
 *
 * @param {string} folderPath - Absolute path to a folder
 * @returns {boolean} True if that folder is marked hidden
 */
export function isFolderSelfHidden(folderPath) {
  return getFolderConfig(folderPath.replace(/\/$/, ''))?.hidden === true;
}

/**
 * Check if a path lies in a folder — its own, or any ancestor up to the
 * docroot — that config.json marks `hidden: true`.
 *
 * Accepts file paths as well as directories: the walk starts at `folderPath`
 * itself, and a file simply has no config.json of its own, so the first step
 * misses and the ancestors decide. That is what lets the build filter a mixed
 * list of files and directories through one predicate.
 *
 * @param {string} folderPath - Absolute path to check (file or directory)
 * @param {string} sourceRoot - The source root directory (stop checking at this level)
 * @returns {boolean} True if this path should be ignored
 */
export function isFolderHidden(folderPath, sourceRoot) {
  let currentPath = folderPath.replace(/\/$/, '');
  
  // Normalize source root for comparison
  const normalizedRoot = sourceRoot.replace(/\/$/, '');
  
  while (currentPath.length >= normalizedRoot.length) {
    const config = getFolderConfig(currentPath);
    if (config?.hidden === true) {
      return true;
    }
    
    // Move to parent directory
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) break; // Reached filesystem root
    currentPath = parentPath;
  }
  
  return false;
}
