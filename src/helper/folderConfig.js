import { existsSync, readFileSync } from './build/tracedFs.js';
import { join, dirname, posix } from 'path';
import YAML from 'yaml';

/**
 * Folder metadata files, highest precedence first.
 *
 * A folder may hold any of these; when it holds more than one they are merged
 * key by key, the higher file winning. `config.json` is the original name and
 * is deprecated: it still works, but new folders should use one of the
 * `metadata.*` files. See docs/FOLDER_METADATA.md.
 */
export const FOLDER_METADATA_FILES = ['metadata.yml', 'metadata.json', 'config.json'];

/** The deprecated name, kept working. */
const LEGACY_FILENAME = 'config.json';

/**
 * An image named `thumb` or `thumbnail` in a folder is that folder's
 * thumbnail unless its metadata names one explicitly.
 */
export const THUMBNAIL_IMAGE_RE = /^thumb(nail)?\.(jpe?g|gif|png|webp|svg)$/i;

/** True when a basename is one of the folder metadata files (not a document). */
export function isFolderMetadataFile(name) {
  return FOLDER_METADATA_FILES.includes(name);
}

/**
 * Folder metadata. System-defined keys (see docs/FOLDER_METADATA.md):
 * {
 *   label?: string,       // Custom label for menu display (deprecated: prefer index frontmatter menu-label)
 *   icon?: string,        // URL to icon image for menu
 *   hidden?: boolean,     // If true, ignore the folder entirely (see below)
 *   thumbnail?: string,   // Image representing the folder: relative to the folder, or to the docroot with a leading /
 *   lang?: string,        // (root only) <html lang>, default "en"
 *   openMenuItems?: string[],  // (root only) Array of folder names to expand by default
 *   'inject-menu'?: object|object[]  // Named menus injected into every document below
 * }
 * Any other key is user-defined and passed through untouched (it appears in
 * `_directory.json`).
 * 
 * `hidden: true` means *ignored*, not merely unlisted. The folder and its
 * whole subtree take no part in the build: no HTML is rendered from its
 * documents, its images and other static assets are not copied, it does not
 * appear in the sidebar menu, in any auto-index, in breadcrumbs, or in the
 * search index, and `ursa serve` will not render its pages on demand. The
 * files stay in the docroot; the site behaves as if they were not there.
 */

const warnedOnce = new Set();
function warnOnce(key, msg) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(msg);
}

function parseMetadataFile(name, content) {
  const value = name.endsWith('.yml') ? YAML.parse(content) : JSON.parse(content);
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected a mapping of keys to values');
  }
  return value;
}

/**
 * Read every metadata file a folder holds and merge them.
 *
 * Reads go through tracedFs, so a build node that consults folder metadata
 * records each candidate file — present or absent — as an input, and creating
 * a `metadata.yml` later re-runs it.
 *
 * @param {string} folderPath - Absolute path to the folder
 * @returns {{metadata: object|null, sources: string[]}} merged metadata (null
 *   when the folder has none) and the basenames it came from, highest first
 */
export function readFolderMetadata(folderPath) {
  const sources = [];
  const layers = [];
  for (const name of FOLDER_METADATA_FILES) {
    const path = join(folderPath, name);
    try {
      if (!existsSync(path)) continue;
      const parsed = parseMetadataFile(name, readFileSync(path, 'utf8'));
      sources.push(name);
      layers.push(parsed);
      if (name === LEGACY_FILENAME) {
        warnOnce(
          'legacy-config-json',
          `⚠️  Folder config.json is deprecated; rename it to metadata.json or metadata.yml (first seen: ${path})`
        );
      }
    } catch (e) {
      warnOnce(`metadata:${path}`, `⚠️  Could not read folder metadata at ${path}: ${e.message}`);
    }
  }
  if (layers.length === 0) return { metadata: null, sources };
  // Lowest precedence first, so the higher file's keys win
  const metadata = Object.assign({}, ...layers.reverse());
  return { metadata, sources };
}

/**
 * Where a folder's thumbnail comes from: its metadata's `thumbnail`, or else
 * a `thumb(nail).<image>` file in the folder.
 *
 * @param {object} opts
 * @param {string} opts.dirRel - Folder relative to the docroot ("" at the root)
 * @param {object|null} opts.metadata - The folder's merged metadata
 * @param {string[]} opts.fileNames - Basenames of the files directly in the folder
 * @returns {{thumbnail: string|null, conflict: {explicit: string, image: string}|null}}
 *   the docroot-absolute thumbnail URL (or an external URL as written), and,
 *   when both an explicit value and a thumbnail image exist, what they were
 */
export function resolveFolderThumbnail({ dirRel, metadata, fileNames }) {
  const explicit = typeof metadata?.thumbnail === 'string' && metadata.thumbnail.trim()
    ? metadata.thumbnail.trim()
    : null;
  const image = [...fileNames].sort().find((n) => THUMBNAIL_IMAGE_RE.test(n)) ?? null;
  const conflict = explicit && image ? { explicit, image } : null;
  if (explicit) return { thumbnail: resolveFolderPath(dirRel, explicit), conflict };
  if (image) return { thumbnail: resolveFolderPath(dirRel, image), conflict };
  return { thumbnail: null, conflict };
}

/**
 * A path written in folder metadata → a docroot-absolute URL path. A leading
 * `/` is relative to the docroot; anything else is relative to the folder.
 * URLs with a scheme (and protocol-relative ones) are returned as written.
 */
export function resolveFolderPath(dirRel, value) {
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return value;
  if (value.startsWith('/')) return posix.normalize(value);
  return posix.normalize(posix.join('/', dirRel || '', value));
}

/**
 * Kept for callers that used to reset the per-run cache. There is no cache
 * any more: every read goes to the (traced) filesystem so that the build
 * graph records the metadata files as inputs of whatever consulted them. A cached
 * hit would record nothing, and a `hidden: true` flip would go unnoticed.
 */
export function clearConfigCache() {}

/**
 * A folder's merged metadata (metadata.yml > metadata.json > config.json).
 * @param {string} folderPath - Absolute path to the folder
 * @returns {object|null} Merged metadata object or null if the folder has none
 */
export function getFolderConfig(folderPath) {
  return readFolderMetadata(folderPath).metadata;
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
 * True when this exact folder's own metadata says `hidden: true`, ignoring
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
 * docroot — that folder metadata marks `hidden: true`.
 *
 * Accepts file paths as well as directories: the walk starts at `folderPath`
 * itself, and a file simply has no metadata of its own, so the first step
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
