/*
 * Shared menu label/sort-key resolution.
 *
 * Both the site-wide automenu (helper/automenu.js) and the per-folder
 * auto-index listings (helper/build/autoIndex.js) name the same folders and
 * documents, so they must agree on what those things are called. Keeping the
 * resolution rules here is what makes `menu-label: 'BNW - Brave New World'`
 * show up in both places instead of only in the sidebar.
 */
import { existsSync, readFileSync } from "fs";
import { basename, extname, join } from "path";
import { extractMetadata } from "./metadataExtractor.js";
import { stripHtml } from "./stripHtml.js";

// Index file extensions to check for folder metadata
export const INDEX_EXTENSIONS = ['.md', '.mdx', '.txt', '.yml', '.yaml'];

// Source extensions a rendered .html page can have come from
export const SOURCE_DOC_EXTENSIONS = ['.md', '.mdx', '.txt', '.yml', '.yaml', '.html'];

/**
 * Convert filename to display name (e.g., "foo-bar" -> "Foo Bar").
 * Unlike toTitleCase, this preserves interior capitalization, so a folder
 * named "SoL" stays "SoL" rather than becoming "Sol".
 */
export function toDisplayName(filename) {
  return filename
    .replace(/[-_]/g, ' ')  // Replace dashes and underscores with spaces
    .replace(/\b\w/g, c => c.toUpperCase());  // Capitalize first letter of each word
}

/**
 * Read a single frontmatter key from a file, with HTML stripped.
 * @param {string} filePath - Path to the source file
 * @param {string} key - Frontmatter key to read
 * @returns {string|null} The value, or null if absent/unreadable
 */
function getFrontmatterString(filePath, key) {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf8');
    const metadata = extractMetadata(content);
    if (metadata && metadata[key]) {
      return stripHtml(String(metadata[key]));
    }
  } catch (e) {
    // Ignore read errors
  }
  return null;
}

/**
 * Get the menu label from a file's frontmatter
 * @param {string} filePath - Path to the markdown file
 * @returns {string|null} The menu-label value (with HTML stripped), or null if not found
 */
export function getMenuLabelFromFile(filePath) {
  return getFrontmatterString(filePath, 'menu-label');
}

/**
 * Get the menu-sort-as value from a file's frontmatter
 * @param {string} filePath - Path to the markdown file
 * @returns {string|null} The menu-sort-as value (with HTML stripped), or null if not found
 */
export function getMenuSortAsFromFile(filePath) {
  return getFrontmatterString(filePath, 'menu-sort-as');
}

/**
 * Get the menu label for a folder from its index.md frontmatter
 * Falls back to config.json label (deprecated), then display name
 * @param {string} dirPath - Path to the folder
 * @param {object|null} folderConfig - The folder's config.json if any
 * @param {string} baseName - The folder's base name
 * @returns {string} The label to display
 */
export function getFolderLabel(dirPath, folderConfig, baseName) {
  // First, check index.md for menu-label (preferred method)
  for (const ext of INDEX_EXTENSIONS) {
    const indexPath = join(dirPath, `index${ext}`);
    const label = getMenuLabelFromFile(indexPath);
    if (label) return label;
  }

  // Fall back to config.json label (deprecated)
  if (folderConfig?.label) {
    return folderConfig.label;
  }

  // Default to display name from folder name
  return toDisplayName(baseName);
}

/**
 * Get the sort key for a folder from its index.md frontmatter
 * @param {string} dirPath - Path to the folder
 * @returns {string|null} The menu-sort-as value, or null if not found
 */
export function getFolderSortKey(dirPath) {
  for (const ext of INDEX_EXTENSIONS) {
    const indexPath = join(dirPath, `index${ext}`);
    const sortKey = getMenuSortAsFromFile(indexPath);
    if (sortKey) return sortKey;
  }
  return null;
}

/**
 * Locate the source document that produced (or would produce) a page.
 * Auto-index listings built from the OUTPUT folder only see "foo.html"; this
 * finds the "foo.md" it came from so its frontmatter can be read.
 * @param {string} dir - Source directory to look in
 * @param {string} baseName - File name without extension
 * @returns {string|null} Path to the source document, or null if none exists
 */
export function findSourceDocument(dir, baseName) {
  if (!dir) return null;
  for (const ext of SOURCE_DOC_EXTENSIONS) {
    const candidate = join(dir, `${baseName}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Get the menu label for a single document.
 * @param {string|null} filePath - Path to the source document (may be null)
 * @param {string} [baseName] - Fallback name; defaults to the file's base name
 * @returns {string} The label to display
 */
export function getFileLabel(filePath, baseName) {
  const fallback = baseName ?? (filePath ? basename(filePath, extname(filePath)) : '');
  if (!filePath) return toDisplayName(fallback);
  return getMenuLabelFromFile(filePath) || toDisplayName(fallback);
}
