import { isHiddenOrSystemPath } from "./hiddenPaths.js";
import { extname, basename, join, dirname } from "path";
import { existsSync, readFileSync, readdirSync, isIgnoredDirEntry } from "./build/tracedFs.js";
import { getFolderConfig, isFolderHidden, getRootConfig } from "./folderConfig.js";
import { isMenuFile } from "./customMenu.js";
import {
  INDEX_EXTENSIONS,
  toDisplayName,
  getMenuLabelFromFile,
  getMenuSortAsFromFile,
  getFolderLabel,
  getFolderSortKey,
  readFrontmatterInfo,
} from "./menuLabels.js";

// Icon extensions to check for custom icons
const ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];

// Default icons (using emoji for simplicity, can be replaced with SVG)
const FOLDER_ICON = '📁';
const DOCUMENT_ICON = '📄';
const HOME_ICON = '🏠';

/**
 * Check if a file is an index file
 * @param {string} baseName - The file's base name (without extension)
 * @returns {boolean} True if this is an index file
 */
function isIndexFile(baseName) {
  return baseName.toLowerCase() === 'index';
}

/**
 * Check if a file acts as the "index" for its parent folder.
 * This is true for actual index files (index.md) and also for files
 * whose name matches their parent folder (e.g. Arcanist/Arcanist.md).
 * @param {string} filePath - Full path to the file
 * @returns {boolean}
 */
function isFolderNamedFile(filePath) {
  const ext = extname(filePath);
  const fileBase = basename(filePath, ext).toLowerCase();
  const parentBase = basename(dirname(filePath)).toLowerCase();
  return fileBase === parentBase;
}

function hasIndexFile(dirPath) {
  for (const ext of INDEX_EXTENSIONS) {
    const indexPath = join(dirPath, `index${ext}`);
    if (existsSync(indexPath)) {
      return true;
    }
  }
  return false;
}

function findCustomIcon(dirPath, source) {
  for (const ext of ICON_EXTENSIONS) {
    const iconPath = join(dirPath, `icon${ext}`);
    if (existsSync(iconPath)) {
      // Return the web-accessible path
      return iconPath.replace(source, '/');
    }
  }
  return null;
}

function getIcon(item, source, isHome = false) {
  if (isHome) {
    return `<span class="menu-icon">${HOME_ICON}</span>`;
  }
  
  if (item.children) {
    // It's a folder - check for custom icon
    const customIcon = findCustomIcon(item.path, source);
    if (customIcon) {
      return `<span class="menu-icon"><img src="${customIcon}" alt="" /></span>`;
    }
    return `<span class="menu-icon">${FOLDER_ICON}</span>`;
  }
  
  // It's a file - check for custom icon in parent directory with matching name
  const dir = dirname(item.path);
  const base = basename(item.path, extname(item.path));
  for (const ext of ICON_EXTENSIONS) {
    const iconPath = join(dir, `${base}-icon${ext}`);
    if (existsSync(iconPath)) {
      return `<span class="menu-icon"><img src="${iconPath.replace(source, '/')}" alt="" /></span>`;
    }
  }
  
  return `<span class="menu-icon">${DOCUMENT_ICON}</span>`;
}

/**
 * Resolve an href to a valid .html file path, checking against validPaths.
 * Returns { href, inactive, debug } where inactive is true if the link doesn't resolve to a valid path.
 * 
 * Logic:
 * - "/" -> "/index.html"
 * - Any link lacking an extension:
 *   - Try adding ".html" - if path exists, use it
 *   - Try adding "/index.html" - if path exists, use it
 *   - Otherwise, mark as inactive
 * - Links with extensions are checked directly
 * 
 * @param {string} rawHref - The original href
 * @param {Map<string, string>} validPaths - Map of normalized paths to canonical resolved paths
 */
function resolveHref(rawHref, validPaths) {
  const debugTries = [];
  
  if (!rawHref) {
    return { href: null, inactive: false, debug: 'null href' };
  }
  
  // Normalize for checking (lowercase)
  const normalize = (path) => path.toLowerCase();
  
  // Root link
  if (rawHref === '/') {
    const normalized = normalize('/');
    if (validPaths.has(normalized)) {
      const canonicalPath = validPaths.get(normalized);
      debugTries.push(`/ → ${canonicalPath} ✓`);
      return { href: canonicalPath, inactive: false, debug: debugTries.join(' | ') };
    }
    debugTries.push(`/ → ✗`);
    return { href: '/', inactive: true, debug: debugTries.join(' | ') };
  }
  
  // Check if the path exists in validPaths - use canonical resolved path
  const normalized = normalize(rawHref);
  if (validPaths.has(normalized)) {
    const canonicalPath = validPaths.get(normalized);
    debugTries.push(`${rawHref} → ${canonicalPath} ✓`);
    return { href: canonicalPath, inactive: false, debug: debugTries.join(' | ') };
  }
  
  // Check if the link already has an extension
  const ext = extname(rawHref);
  if (ext) {
    // Has extension but doesn't exist in validPaths
    debugTries.push(`${rawHref} → ✗`);
    return { href: rawHref, inactive: true, debug: debugTries.join(' | ') };
  }
  
  // No extension - try .html first
  const htmlPath = rawHref + '.html';
  if (validPaths.has(normalize(htmlPath))) {
    const canonicalPath = validPaths.get(normalize(htmlPath));
    debugTries.push(`${htmlPath} → ${canonicalPath} ✓`);
    return { href: canonicalPath, inactive: false, debug: debugTries.join(' | ') };
  }
  debugTries.push(`${htmlPath} → ✗`);
  
  // Try /index.html
  const indexPath = rawHref + '/index.html';
  if (validPaths.has(normalize(indexPath))) {
    const canonicalPath = validPaths.get(normalize(indexPath));
    debugTries.push(`${indexPath} → ${canonicalPath} ✓`);
    return { href: canonicalPath, inactive: false, debug: debugTries.join(' | ') };
  }
  debugTries.push(`${indexPath} → ✗`);
  
  // Neither exists - mark as inactive, keep original href
  return { href: rawHref, inactive: true, debug: debugTries.join(' | ') };
}

/**
 * Recursively check if a directory-tree node contains any document files.
 * @param {object} treeNode - A node from the directory-tree package
 * @param {string[]} docExtensions - Extensions that count as documents
 * @returns {boolean}
 */
function treeHasDocuments(treeNode, docExtensions) {
  if (!treeNode.children) {
    // Leaf node (file) — check its extension
    return docExtensions.includes(extname(treeNode.path));
  }
  // Directory — recurse into children
  return treeNode.children.some(child => treeHasDocuments(child, docExtensions));
}

// Build a flat tree structure with path info for JS navigation
// Set includeDebug=false to exclude debug fields and reduce JSON size
function buildMenuData(tree, source, validPaths, parentPath = '', includeDebug = true) {
  const items = [];
  
  // Document extensions that count as "real content"
  const DOC_EXTENSIONS = ['.md', '.mdx', '.txt', '.html'];
  
  // Files to hide from menu by default
  const hiddenFiles = ['config.json', 'style.css', 'footer.md'];
  
  for (const item of tree.children || []) {
    const ext = extname(item.path);
    const baseName = basename(item.path, ext);
    const fileName = basename(item.path);
    const hasChildren = !!item.children;
    const relativePath = item.path.replace(source, '');
    const folderPath = parentPath ? `${parentPath}/${baseName}` : baseName;
    
    // Skip hidden files (config.json, style.css, etc.) and menu files
    if (!hasChildren && (hiddenFiles.includes(fileName) || isMenuFile(fileName))) {
      continue;
    }
    
    // Skip metadata-only index files (they only provide folder metadata, not actual pages)
    if (!hasChildren && isIndexFile(baseName)) {
      if (readFrontmatterInfo(item.path)?.isMetadataOnly) {
        continue; // Skip - this file doesn't produce a page
      }
    }
    
    // Check if this folder is hidden via config.json.
    // Not gated on hasChildren: a hidden folder is ignored whether or not the
    // tree walker found children under it.
    if (isFolderHidden(item.path, source)) {
      continue; // Skip hidden folders
    }
    
    // Skip folders that contain no document files (recursively)
    if (hasChildren && !treeHasDocuments(item, DOC_EXTENSIONS)) {
      continue;
    }
    
    // Get folder config for custom label and icon (deprecated for labels, still used for icons/hidden)
    const folderConfig = hasChildren ? getFolderConfig(item.path) : null;
    
    // Determine the label - prefer menu-label from frontmatter
    let label;
    let sortKey;
    const isIndex = !hasChildren && (isIndexFile(baseName) || isFolderNamedFile(item.path));
    
    if (hasChildren) {
      // For folders, get label from index.md frontmatter, then config.json, then folder name
      label = getFolderLabel(item.path, folderConfig, baseName);
      // Get sort key from folder's index.md, fall back to baseName (not transformed label)
      sortKey = getFolderSortKey(item.path) || baseName;
    } else {
      // For files, check frontmatter for menu-label
      const fileLabel = getMenuLabelFromFile(item.path);
      if (isIndex) {
        // Index files (index.md or foldername.md) default to "Home" label
        label = fileLabel || 'Home';
      } else {
        label = fileLabel || toDisplayName(baseName);
      }
      // Get sort key from file's frontmatter, fall back to baseName (not transformed label)
      // This ensures menu-sort-as values can match original filenames consistently
      const fileSortKey = getMenuSortAsFromFile(item.path);
      sortKey = fileSortKey || baseName;
    }
    
    let rawHref = null;
    let href = null;
    let inactive = false;
    let debug = '';
    
    if (hasChildren) {
      // All folders now have index pages (either existing or auto-generated)
      const cleanPath = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
      rawHref = `${cleanPath}/index.html`.replace(/\/\//g, '/');
      href = rawHref;
      inactive = false; // Always active - auto-index ensures all folders have index.html
      debug = 'folder (auto-index enabled)';
    } else {
      const cleanPath = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
      rawHref = cleanPath.replace(ext, '');
      // Resolve the href and check if target exists
      const resolved = resolveHref(rawHref, validPaths);
      href = resolved.href;
      inactive = resolved.inactive;
      debug = resolved.debug;
    }
    
    // Determine icon - custom from config, or custom icon file, or default
    let icon = getIcon(item, source);
    if (folderConfig?.icon) {
      icon = `<span class="menu-icon"><img src="${folderConfig.icon}" alt="${label}" /></span>`;
    }
    
    const menuItem = {
      label,
      sortKey, // Used for sorting (menu-sort-as or label)
      path: folderPath,
      href,
      hasChildren,
      icon,
      isIndex, // Mark index files for special styling and sorting
    };
    
    // Only include debug and inactive fields if requested (for smaller JSON)
    if (includeDebug) {
      menuItem.inactive = inactive;
      menuItem.debug = debug;
    } else if (inactive) {
      // Only include inactive if true (to save space)
      menuItem.inactive = true;
    }
    
    if (hasChildren) {
      menuItem.children = buildMenuData(item, source, validPaths, folderPath, includeDebug);
    }
    
    items.push(menuItem);
  }
  
  // Sort: folders first (a-z), then index files, then other files (a-z)
  return items.sort((a, b) => {
    // Folders always come first
    if (a.hasChildren && !b.hasChildren) return -1;
    if (b.hasChildren && !a.hasChildren) return 1;
    // Index files come before other files (after folders)
    if (a.isIndex && !b.isIndex) return -1;
    if (b.isIndex && !a.isIndex) return 1;
    // Alphabetical sort by sortKey (case-insensitive)
    const aKey = (a.sortKey || '').toLowerCase();
    const bKey = (b.sortKey || '').toLowerCase();
    if (aKey > bKey) return 1;
    if (aKey < bKey) return -1;
    return 0;
  });
}

/**
 * Post-process menu data to collapse single-document folders.
 * When a folder contains only an index file (index.md) or a foldername-matching
 * file (e.g. Arcanist/Arcanist.md) and no other children, the folder is replaced
 * with a direct link to that document using the folder's label.
 * 
 * Conditions for collapse:
 * - Exactly one child
 * - That child is an index-like file (isIndex: true)
 * - The child has no children (i.e., not a subfolder)
 * 
 * This ensures folders with subfolders are never collapsed, even if they only
 * have 0-1 regular documents.
 */
function collapseSingleDocFolders(items) {
  return items.map(item => {
    if (!item.hasChildren || !item.children) return item;
    
    // Recurse first so nested single-doc folders are collapsed bottom-up
    item.children = collapseSingleDocFolders(item.children);
    
    // Only collapse if there is exactly one child that is an index-like file
    // Collapsed subfolders have isIndex: false, so they won't trigger collapse
    // Folders with any remaining subfolders (hasChildren: true) won't collapse
    if (item.children.length === 1) {
      const onlyChild = item.children[0];
      if (onlyChild.isIndex && !onlyChild.hasChildren) {
        return {
          ...item,
          hasChildren: false,
          children: undefined,
          href: onlyChild.href || item.href,
          isIndex: false,
        };
      }
    }
    
    return item;
  });
}

/**
 * Drop hidden/system nodes from a directory-tree, judging each node's path
 * RELATIVE to the docroot. See helper/hiddenPaths.js for why relative.
 *
 * Returns a new tree; the input is not mutated.
 *
 * @param {object} node - A directory-tree node
 * @param {string} source - Absolute path of the docroot
 * @returns {object} The pruned node
 */
export function pruneHiddenNodes(node, source) {
  if (!node.children) return node;
  return {
    ...node,
    children: node.children
      .filter((child) => !isHiddenOrSystemPath(child.path, source))
      .map((child) => pruneHiddenNodes(child, source)),
  };
}

/**
 * Build a directory tree in the shape `directory-tree` produced
 * ({name, path, children?}), reading through the traced filesystem so the
 * build graph records every listing the menu depends on. Entries are sorted
 * by name; readdir order never reaches the menu.
 * @param {string} dir - Absolute directory path
 * @returns {object|null} Tree node, or null if `dir` cannot be listed
 */
function walkTree(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const children = [];
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    // Never inputs (see tracedFs.isIgnoredDirEntry); skipping them here also
    // keeps the walk out of a .git or node_modules sitting inside the docroot.
    if (isIgnoredDirEntry(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const child = walkTree(path);
      if (child) children.push(child);
    } else if (entry.isFile()) {
      children.push({ name: entry.name, path });
    }
  }
  return { name: basename(dir), path: dir, children };
}

export async function getAutomenu(source, validPaths) {
  /*
   * Walk first, prune second.
   *
   * `dirTree`'s `exclude` is tested against each item's ABSOLUTE path,
   * including the root's. A docroot that merely lives under a dot-directory —
   * a git worktree under `.claude/worktrees/…`, anything in `~/.config` —
   * therefore excluded ITSELF, and `dirTree` returned null, which reached
   * `buildMenuData` as `Cannot read properties of null (reading 'children')`.
   *
   * Pruning afterwards judges each node relative to the docroot instead, which
   * is what "hidden folder" was always meant to mean. The cost is that a
   * `node_modules` sitting inside a docroot is now walked before being
   * discarded; docroots do not normally contain one, and correctness on every
   * ordinary path is worth more than speed on a pathological one.
   */
  const fullTree = walkTree(source.replace(/\/$/, ''));
  if (!fullTree) {
    throw new Error(
      `Cannot read docroot for menu generation: ${source} (does it exist and is it a directory?)`
    );
  }
  const tree = pruneHiddenNodes(fullTree, source);
  
  // Build menu data WITHOUT debug fields for smaller JSON
  let menuData = buildMenuData(tree, source, validPaths, '', false);
  
  // Post-process: collapse single-document folders into direct links
  menuData = collapseSingleDocFolders(menuData);
  
  // Get root config for openMenuItems setting
  const rootConfig = getRootConfig(source);
  const openMenuItems = rootConfig?.openMenuItems || [];
  
  // Partition top-level items: files go under Home, folders stay at top level
  const topLevelFolders = menuData.filter(item => item.hasChildren);
  const topLevelFiles = menuData.filter(item => !item.hasChildren);
  
  // Build Home item with top-level files as children
  const homeResolved = resolveHref('/', validPaths);
  const homeItem = {
    label: 'Home',
    path: '',
    href: homeResolved.href,
    hasChildren: topLevelFiles.length > 0,
    icon: `<span class="menu-icon">${HOME_ICON}</span>`,
  };
  if (topLevelFiles.length > 0) {
    homeItem.children = topLevelFiles;
  }
  
  const fullMenuData = [homeItem, ...topLevelFolders];
  
  // Embed the openMenuItems config as JSON (small, safe to embed)
  const menuConfigScript = `<script type="application/json" id="menu-config">${JSON.stringify({ openMenuItems })}</script>`;
  
  // Render the breadcrumb header (hidden by default, shown when navigating)
  const breadcrumbHtml = `
<div class="menu-breadcrumb" style="display: none;">
  <button class="menu-back" title="Go back">←</button>
  <button class="menu-home" title="Go to root">🏠</button>
  <span class="menu-current-path"></span>
</div>`;

  // Render the initial menu (root level only - children loaded from external JSON)
  const menuHtml = renderMenuLevel(fullMenuData, 0);
  
  // Return both the HTML for embedding and the full menu data for the static JSON file
  return {
    html: `${menuConfigScript}${breadcrumbHtml}<ul class="menu-level" data-level="0">${menuHtml}</ul>`,
    menuData: fullMenuData
  };
}

function renderMenuLevel(items, level) {
  return items.map(item => {
    const hasChildrenClass = item.hasChildren ? ' has-children' : '';
    const hasChildrenIndicator = item.hasChildren ? '<span class="menu-more">⋯</span>' : '';
    const inactiveClass = item.inactive ? ' inactive' : '';
    const isIndexClass = item.isIndex ? ' is-index' : '';
    
    const labelHtml = item.href
      ? `<a href="${item.href}" class="menu-label${inactiveClass}">${item.label}</a>`
      : `<span class="menu-label">${item.label}</span>`;
    
    return `
<li class="menu-item${hasChildrenClass}${isIndexClass}" data-path="${item.path}">
  <div class="menu-item-row">
    ${item.icon}
    ${labelHtml}
    ${hasChildrenIndicator}
  </div>
</li>`;
  }).join('');
}

function childSorter(a, b) {
  if (a.children && !b.children) return -1;
  if (b.children && !a.children) return 1;
  if (a.name > b.name) return 1;
  if (a.name < b.name) return -1;
  return 0;
}

function menuItemSorter(a, b) {
  if (a.childMenuItems && !b.childMenuItems) return -1;
  if (b.childMenuItems && !a.childMenuItems) return 1;
  if (a.label > b.label) return 1;
  if (a.label < b.label) return -1;
  return 0;
}

export async function OLDgetAutomenu(source) {
  const trimmedFilenames = allSourceFilenames.map((filename) => ({
    filename: filename.replace(source, ""),
    depth: filename.split("").filter((char) => char === "/").length,
  }));
  const sortedFilenames = [...trimmedFilenames].sort((a, b) => {
    if (a.depth > b.depth) return 1;
    if (a.depth < b.depth) return -1;
    if (a.filename > b.filename) return 1;
    if (a.filename < b.filename) return -1;
    return 0;
  });
  const menuItems = sortedFilenames
    .filter((filename) => /\.(md|mdx|txt)$/.test(filename))
    .filter((filename) => filename.indexOf("menu.") === -1)
    .map((filename) => {
      const depthPrefix = filename
        .split("")
        .filter((char) => char === "/")
        .map((char) => "  ")
        .join("");
      const ext = extname(filename);
      const articleName = basename(filename, ext);
      const link = filename.replace(ext, "");
      const menuItem = `${depthPrefix}+ [${articleName}](${link})`;
      return menuItem;
    });
  return menuItems.join("\n");

  /*
+ [Home](/5e)
+ [Classes](/5e/Classes)
  + [Artificer](/5e/Classes/Artificer)
  + [Elementalist](/5e/Classes/Elementalist)
  */
}
