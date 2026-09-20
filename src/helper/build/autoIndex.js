// Auto-index generation helpers for build
import { readdir } from "./tracedFs.js";
import { basename, extname, join } from "path";
import { getFolderConfig, isFolderSelfHidden } from "../folderConfig.js";
import {
  toDisplayName,
  getFolderLabel,
  getFolderSortKey,
  getMenuSortAsFromFile,
  getFileLabel,
  findSourceDocument,
} from "../menuLabels.js";

// Document extensions for checking if a folder has content
const SOURCE_DOC_EXTENSIONS = ['.md', '.mdx', '.txt', '.yml', '.html'];

/**
 * Recursively check if a directory contains any document files.
 *
 * Documents inside a config-hidden subfolder do not count: they produce no
 * output, so a folder whose only contents are hidden must not be linked as if
 * it had pages. When `dir` is an output directory, pass the matching source
 * directory as `sourceDir` — the config.json lives in the source tree.
 *
 * @param {string} dir - Directory path to check
 * @param {string[]} extensions - File extensions that count as documents
 * @param {string|null} [sourceDir=dir] - Matching source directory, for hidden lookups
 * @returns {Promise<boolean>} True if the directory (or any subdirectory) contains at least one document
 */
async function directoryHasDocuments(dir, extensions, sourceDir = dir) {
  try {
    const children = await readdir(dir, { withFileTypes: true });
    for (const child of children) {
      if (child.name.startsWith('.')) continue;
      const fullPath = join(dir, child.name);
      if (child.isDirectory()) {
        if (child.name === 'img') continue;
        if (sourceDir && isFolderSelfHidden(join(sourceDir, child.name))) continue;
        const childSource = sourceDir ? join(sourceDir, child.name) : null;
        if (await directoryHasDocuments(fullPath, extensions, childSource)) return true;
      } else {
        const ext = extname(child.name).toLowerCase();
        if (extensions.includes(ext)) return true;
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

/**
 * Resolve the label and sort key for one auto-index entry, using the same
 * rules as the site-wide automenu: `menu-label` frontmatter wins, then
 * config.json `label` for folders, then the prettified file/folder name.
 *
 * @param {boolean} isDir - Whether the entry is a directory
 * @param {string} baseName - Name without extension
 * @param {string|null} sourceDir - Source directory holding this entry, if known
 * @returns {{label: string, sortKey: string}}
 */
function resolveEntryNaming(isDir, baseName, sourceDir) {
  if (!sourceDir) {
    return { label: toDisplayName(baseName), sortKey: baseName };
  }
  if (isDir) {
    const childDir = join(sourceDir, baseName);
    return {
      label: getFolderLabel(childDir, getFolderConfig(childDir), baseName),
      sortKey: getFolderSortKey(childDir) || baseName,
    };
  }
  const sourceFile = findSourceDocument(sourceDir, baseName);
  return {
    label: getFileLabel(sourceFile, baseName),
    sortKey: (sourceFile && getMenuSortAsFromFile(sourceFile)) || baseName,
  };
}

/**
 * Sort auto-index entries the way the automenu does: folders first, then by
 * sort key (case-insensitive).
 */
function compareEntries(a, b) {
  if (a.isDir && !b.isDir) return -1;
  if (!a.isDir && b.isDir) return 1;
  return a.sortKey.toLowerCase().localeCompare(b.sortKey.toLowerCase());
}

/**
 * Generate auto-index HTML content from the SOURCE folder
 * (used for inline auto-index generation in index.md files with generate-auto-index: true)
 * This version reads from source to avoid race conditions with concurrent file generation
 * @param {string} sourceDir - The source directory path
 * @param {number} depth - How deep to recurse (1 = current level only, 2 = current + children, etc.)
 * @param {number} [currentDepth=0] - Current recursion depth (internal use)
 * @param {string} [pathPrefix=''] - Path prefix for generating correct hrefs (internal use)
 * @returns {Promise<string>} HTML content for the auto-index
 */
export async function generateAutoIndexHtmlFromSource(sourceDir, depth = 1, currentDepth = 0, pathPrefix = '') {
  try {
    const children = await readdir(sourceDir, { withFileTypes: true });
    
    // Filter to only include relevant files and folders
    const filteredChildren = children
      .filter(child => {
        // Skip hidden files
        if (child.name.startsWith('.')) return false;
        // Skip index files (we're generating into the index)
        if (child.name.match(/^index\.(md|mdx|txt|yml|html)$/i)) return false;
        // Skip img folders (contain images, not content)
        if (child.isDirectory() && child.name === 'img') return false;
        // Skip folders config.json marks hidden — they produce no output
        if (child.isDirectory() && isFolderSelfHidden(join(sourceDir, child.name))) return false;
        // Include directories and article files (md, mdx, txt, yml, html)
        return child.isDirectory() || child.name.match(/\.(md|mdx|txt|yml|html)$/i);
      })
      .map(child => {
        const isDir = child.isDirectory();
        const baseName = isDir ? child.name : basename(child.name, extname(child.name));
        return { child, isDir, baseName, ...resolveEntryNaming(isDir, baseName, sourceDir) };
      })
      .sort(compareEntries);
    
    if (filteredChildren.length === 0) {
      return '';
    }
    
    const items = [];
    
    for (const { child, isDir, baseName, label } of filteredChildren) {
      // Skip directories that contain no documents
      if (isDir) {
        const childDir = join(sourceDir, child.name);
        if (!await directoryHasDocuments(childDir, SOURCE_DOC_EXTENSIONS)) continue;
      }
      // Generate href - directories link to folder/index.html, files convert to .html
      // Use pathPrefix to ensure hrefs are correct relative to the document root
      const childPath = pathPrefix ? `${pathPrefix}/${child.name}` : child.name;
      const href = isDir ? `${childPath}/index.html` : `${pathPrefix ? pathPrefix + '/' : ''}${baseName}.html`;
      const icon = isDir ? '📁' : '📄';
      
      let itemHtml = `<li>${icon} <a href="${href}">${label}</a>`;
      
      // If this is a directory and we need to go deeper, recurse
      if (isDir && currentDepth + 1 < depth) {
        const childDir = join(sourceDir, child.name);
        const childHtml = await generateAutoIndexHtmlFromSource(childDir, depth, currentDepth + 1, childPath);
        if (childHtml) {
          itemHtml += `\n${childHtml}`;
        }
      }
      
      itemHtml += '</li>';
      items.push(itemHtml);
    }
    
    return `<ul class="auto-index depth-${currentDepth + 1}">\n${items.join('\n')}\n</ul>`;
  } catch (e) {
    console.error(`Error generating auto-index HTML for ${sourceDir}: ${e.message}`);
    return '';
  }
}
