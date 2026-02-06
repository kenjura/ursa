// Custom menu support - allows defining custom menus in menu.md, menu.txt, _menu.md, or _menu.txt
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, relative, resolve, basename, extname } from "path";
import { extractMetadata } from "./metadataExtractor.js";

// Menu file names to look for (in order of priority)
const MENU_FILE_NAMES = ['menu.md', 'menu.txt', '_menu.md', '_menu.txt'];

// Token to mark where auto-generated menu should be inserted
const MENU_TOKEN = '{menu}';

// Source file extensions to check
const SOURCE_EXTENSIONS = ['.md', '.txt'];

// Index file names for folder links
const INDEX_NAMES = ['index', 'home'];

// Default icons
const FOLDER_ICON = '📁';
const DOCUMENT_ICON = '📄';

/**
 * Extract frontmatter from menu file content
 * @param {string} content - Menu file content
 * @returns {{frontmatter: object, body: string}} - Parsed frontmatter and remaining body
 */
export function extractMenuFrontmatter(content) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }
  
  try {
    // Parse YAML-like frontmatter (simple key: value pairs)
    const frontmatterText = frontmatterMatch[1];
    const frontmatter = {};
    for (const line of frontmatterText.split('\n')) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Parse boolean values
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        // Parse quoted strings
        else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        frontmatter[key] = value;
      }
    }
    return { frontmatter, body: frontmatterMatch[2] };
  } catch (e) {
    return { frontmatter: {}, body: content };
  }
}

/**
 * Convert filename to display name (e.g., "foo-bar" -> "Foo Bar")
 */
function toDisplayName(filename) {
  return filename
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Check if a source file exists for a given path
 * Checks for: ./Foo.md, ./Foo.txt, ./Foo/index.md, ./Foo/index.txt, ./Foo/home.md, ./Foo/home.txt, ./Foo/Foo.md, ./Foo/Foo.txt
 * @param {string} basePath - The base path without extension (absolute path in source)
 * @returns {boolean} - True if a source file exists
 */
function sourceFileExists(basePath) {
  const name = basename(basePath);
  
  // Check direct file (./Foo.md, ./Foo.txt)
  for (const ext of SOURCE_EXTENSIONS) {
    if (existsSync(basePath + ext)) {
      return true;
    }
  }
  
  // Check as folder with index files (./Foo/index.md, ./Foo/index.txt, ./Foo/home.md, ./Foo/home.txt, ./Foo/Foo.md, ./Foo/Foo.txt)
  const indexNames = ['index', 'home', name];
  for (const indexName of indexNames) {
    for (const ext of SOURCE_EXTENSIONS) {
      if (existsSync(join(basePath, indexName + ext))) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Get the menu-label from a file's frontmatter
 * @param {string} filePath - Path to the file
 * @returns {string|null} - Menu label or null
 */
function getMenuLabelFromFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf8');
    const metadata = extractMetadata(content);
    return metadata?.['menu-label'] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Auto-generate menu items from folder contents
 * Similar to the main automenu but for custom menu contexts
 * @param {string} folderPath - Absolute path to folder
 * @param {string} sourceRoot - Root source directory
 * @param {number} depth - How deep to recurse (default: 2)
 * @param {boolean} isRoot - Whether this is the root level (adds Home item)
 * @returns {Array} - Menu items array
 */
export function autoGenerateMenuFromFolder(folderPath, sourceRoot, depth = 2, isRoot = true) {
  const items = [];
  
  if (depth <= 0 || !existsSync(folderPath)) {
    return items;
  }
  
  // Home item to be added at the start (after sorting other items)
  let homeItem = null;
  if (isRoot) {
    const relativePath = '/' + relative(sourceRoot, folderPath).replace(/\\/g, '/');
    homeItem = {
      label: 'Home',
      path: 'home',
      href: relativePath + '/index.html',
      hasChildren: false,
      icon: `<span class="menu-icon">${DOCUMENT_ICON}</span>`,
      children: [],
    };
  }
  
  try {
    const entries = readdirSync(folderPath, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip hidden files/folders
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      // Skip menu files themselves
      if (MENU_FILE_NAMES.includes(entry.name)) continue;
      // Skip config files
      if (entry.name === 'config.json') continue;
      // Skip img folders
      if (entry.name === 'img' && entry.isDirectory()) continue;
      
      const fullPath = join(folderPath, entry.name);
      const relativePath = '/' + relative(sourceRoot, fullPath).replace(/\\/g, '/');
      
      if (entry.isDirectory()) {
        // Check for index file to get label
        let label = null;
        for (const ext of SOURCE_EXTENSIONS) {
          const indexPath = join(fullPath, `index${ext}`);
          label = getMenuLabelFromFile(indexPath);
          if (label) break;
        }
        if (!label) label = toDisplayName(entry.name);
        
        const children = depth > 1 ? autoGenerateMenuFromFolder(fullPath, sourceRoot, depth - 1, false) : [];
        
        items.push({
          label,
          path: entry.name.toLowerCase().replace(/\s+/g, '-'),
          href: relativePath + '/index.html',
          hasChildren: children.length > 0,
          icon: `<span class="menu-icon">${FOLDER_ICON}</span>`,
          children,
        });
      } else {
        // It's a file
        const ext = extname(entry.name);
        if (!SOURCE_EXTENSIONS.includes(ext)) continue;
        
        const baseName = basename(entry.name, ext);
        // Skip index files (they're represented by the folder)
        if (INDEX_NAMES.includes(baseName.toLowerCase())) continue;
        
        // Get label from frontmatter or filename
        const label = getMenuLabelFromFile(fullPath) || toDisplayName(baseName);
        
        items.push({
          label,
          path: baseName.toLowerCase().replace(/\s+/g, '-'),
          href: relativePath.replace(ext, '.html'),
          hasChildren: false,
          icon: `<span class="menu-icon">${DOCUMENT_ICON}</span>`,
          children: [],
        });
      }
    }
    
    // Sort: folders first, then alphabetically
    items.sort((a, b) => {
      if (a.hasChildren && !b.hasChildren) return -1;
      if (!a.hasChildren && b.hasChildren) return 1;
      return a.label.localeCompare(b.label);
    });
    
  } catch (e) {
    console.error(`Error reading folder ${folderPath}:`, e);
  }
  
  // Add Home item at the very start (after sorting)
  if (homeItem) {
    items.unshift(homeItem);
  }
  
  return items;
}

/**
 * Combine auto-generated menu with manual menu content from menu.md
 * 
 * The manual content can contain a {menu} token to specify where the auto-generated
 * menu should be inserted. If no token is present, the manual content is appended
 * after the auto-generated menu.
 * 
 * Example menu.md:
 * ```
 * ---
 * auto-generate-menu: true
 * menu-position: top
 * ---
 * 
 * * [Custom Link 1](#)
 * {menu}
 * * [Custom Link 2](#)
 * ```
 * 
 * @param {string} manualContent - The menu file content (without frontmatter)
 * @param {string} menuDir - The directory where the menu file was found
 * @param {string} sourceRoot - The root source directory
 * @param {number} depth - How many levels deep to auto-generate
 * @returns {Array} - Combined menu data array
 */
export function combineAutoAndManualMenu(manualContent, menuDir, sourceRoot, depth = 2) {
  // Generate the auto menu
  const autoMenuItems = autoGenerateMenuFromFolder(menuDir, sourceRoot, depth, true);
  
  // Check if manual content is empty or only whitespace
  const trimmedContent = manualContent.trim();
  if (!trimmedContent) {
    return autoMenuItems;
  }
  
  // Check if the content contains the {menu} token
  const hasMenuToken = trimmedContent.includes(MENU_TOKEN);
  
  if (hasMenuToken) {
    // Split content at the {menu} token
    const [beforeToken, afterToken] = trimmedContent.split(MENU_TOKEN);
    
    // Parse each part
    const beforeItems = beforeToken.trim() ? parseCustomMenu(beforeToken, menuDir, sourceRoot) : [];
    const afterItems = afterToken.trim() ? parseCustomMenu(afterToken, menuDir, sourceRoot) : [];
    
    // Combine: before + auto + after
    return [...beforeItems, ...autoMenuItems, ...afterItems];
  } else {
    // No token - append manual content after auto-generated menu
    const manualItems = parseCustomMenu(trimmedContent, menuDir, sourceRoot);
    return [...autoMenuItems, ...manualItems];
  }
}

/**
 * Find a custom menu file in the given directory or any parent directory
 * @param {string} dirPath - The directory to start searching from
 * @param {string} sourceRoot - The root source directory (stop searching here)
 * @returns {{path: string, content: string, menuDir: string} | null} - Menu file info or null if not found
 */
export function findCustomMenu(dirPath, sourceRoot) {
  // Normalize paths
  const normalizedDir = resolve(dirPath);
  const normalizedRoot = resolve(sourceRoot);
  
  let currentDir = normalizedDir;
  
  // Walk up the directory tree until we reach or pass the source root
  while (currentDir.startsWith(normalizedRoot)) {
    for (const menuFileName of MENU_FILE_NAMES) {
      const menuPath = join(currentDir, menuFileName);
      if (existsSync(menuPath)) {
        try {
          const content = readFileSync(menuPath, 'utf8');
          return {
            path: menuPath,
            content,
            menuDir: currentDir, // The directory where the menu was found
          };
        } catch (e) {
          console.error(`Error reading menu file ${menuPath}:`, e);
        }
      }
    }
    
    // Move up one directory
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }
  
  return null;
}

/**
 * Parse a custom menu file and return menu data structure
 * Supports two formats:
 * 
 * Markdown format:
 * - [Label](./relative/path)
 *   - [Child Label](./relative/child/path)
 * 
 * Wikitext format:
 * * [[path|Label]]
 * ** [[child/path|Child Label]]
 * or
 * * [[Label]]  (path derived from label)
 * 
 * @param {string} content - The menu file content
 * @param {string} menuDir - The directory where the menu file was found
 * @param {string} sourceRoot - The root source directory
 * @returns {Array} - Menu data array compatible with the existing menu system
 */
export function parseCustomMenu(content, menuDir, sourceRoot) {
  const lines = content.split('\n');
  const menuItems = [];
  const stack = [{ children: menuItems, indent: -1 }]; // Stack for tracking nesting
  
  for (const line of lines) {
    // Skip empty lines
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }
    
    let label = null;
    let href = null;
    let indent = 0;
    
    // Try wikitext format first: * [[path|Label]] or * [[Label]]
    if (trimmedLine.match(/^\*+\s*\[\[/)) {
      // Count asterisks for indent level
      const asteriskMatch = trimmedLine.match(/^(\*+)/);
      indent = asteriskMatch ? (asteriskMatch[1].length - 1) * 2 : 0; // Convert to space-equivalent
      
      // Parse wikitext link: [[path|label]] or [[label]]
      const wikiMatch = trimmedLine.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      if (wikiMatch) {
        if (wikiMatch[2]) {
          // [[path|label]] format - first part is path, second is label
          // Special case: _home means index
          const pathPart = wikiMatch[1] === '_home' ? 'index' : wikiMatch[1];
          label = wikiMatch[2];
          href = './' + pathPart;
        } else {
          // [[label]] format - path derived from label
          label = wikiMatch[1];
          // Special case: _home means index
          href = './' + (wikiMatch[1] === '_home' ? 'index' : wikiMatch[1]);
        }
      }
    }
    // Try markdown format with asterisks: * [Label](path) or ** [Label](path)
    else if (trimmedLine.match(/^\*+\s*\[/)) {
      // Count asterisks for indent level
      const asteriskMatch = trimmedLine.match(/^(\*+)/);
      indent = asteriskMatch ? (asteriskMatch[1].length - 1) * 2 : 0; // Convert to space-equivalent
      
      // Parse the markdown link: * [Label](path)
      const linkMatch = trimmedLine.match(/^\*+\s*\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        label = linkMatch[1];
        href = linkMatch[2];
      }
    }
    // Try markdown format with dashes: - [Label](path)
    else if (trimmedLine.startsWith('-')) {
      // Calculate indentation level (count leading spaces/tabs before the dash)
      const leadingWhitespace = line.match(/^(\s*)/)[1];
      indent = leadingWhitespace.length;
      
      // Parse the markdown link: - [Label](path)
      const linkMatch = trimmedLine.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        label = linkMatch[1];
        href = linkMatch[2];
      }
    }
    
    // Skip if we couldn't parse
    if (!label || !href) {
      continue;
    }
    
    // Resolve relative paths based on where the menu file was found
    // Resolve relative paths and check if source file exists
    let absoluteSourcePath = null;
    
    // Preserve external URLs, anchor links, and special protocols as-is
    const isExternalOrSpecial = href.startsWith('#') || 
                                href.startsWith('http://') || 
                                href.startsWith('https://') ||
                                href.startsWith('mailto:') ||
                                href.startsWith('tel:') ||
                                href.startsWith('javascript:');
    
    if (isExternalOrSpecial) {
      // Keep href as-is - it's an external link, anchor, or special protocol
    } else if (href.startsWith('./') || href.startsWith('../') || !href.startsWith('/')) {
      // It's a relative path - resolve it relative to the menu directory
      absoluteSourcePath = resolve(menuDir, href);
      
      // Check if the path already has a source extension (.md, .txt)
      const hrefExt = extname(href).toLowerCase();
      const hasSourceExt = SOURCE_EXTENSIONS.includes(hrefExt);
      
      // If it has a source extension, check if that exact file exists
      // Otherwise use sourceFileExists which tries multiple extensions
      let fileExists = false;
      if (hasSourceExt) {
        fileExists = existsSync(absoluteSourcePath);
      } else {
        fileExists = sourceFileExists(absoluteSourcePath);
      }
      
      if (fileExists) {
        // Convert to web-accessible path (relative to source root)
        href = '/' + relative(sourceRoot, absoluteSourcePath);
        // Normalize path separators for web
        href = href.replace(/\\/g, '/');
        // Convert source extensions to .html
        if (hasSourceExt) {
          href = href.replace(/\.(md|txt)$/i, '.html');
        } else if (!href.match(/\.[a-z]+$/i)) {
          // Ensure it ends with .html if it doesn't have an extension
          // Check if it's likely a folder (ends with /) or file
          if (href.endsWith('/')) {
            href = href + 'index.html';
          } else {
            // Assume it's a file - add .html
            href = href + '.html';
          }
        }
      } else {
        // Source file doesn't exist - this is a non-navigable menu item
        href = null;
      }
    }
    
    const menuItem = {
      label,
      path: label.toLowerCase().replace(/\s+/g, '-'), // Generate path from label
      href,
      hasChildren: false, // Will be updated if children are added
      icon: `<span class="menu-icon">${href ? DOCUMENT_ICON : FOLDER_ICON}</span>`,
      children: [],
    };
    
    // Find the correct parent based on indentation
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    
    // Add this item to the current parent
    const parent = stack[stack.length - 1];
    parent.children.push(menuItem);
    
    // If this is the first child, mark parent as having children
    if (parent.menuItem) {
      parent.menuItem.hasChildren = true;
      parent.menuItem.icon = `<span class="menu-icon">${FOLDER_ICON}</span>`;
    }
    
    // Push this item onto the stack as a potential parent
    stack.push({ children: menuItem.children, indent, menuItem });
  }
  
  return menuItems;
}

/**
 * Get custom menu data for a given file path
 * @param {string} filePath - The source file path
 * @param {string} sourceRoot - The root source directory
 * @returns {{menuData: Array, menuPath: string, menuPosition: string} | null} - Menu data and path, or null if no custom menu
 */
export function getCustomMenuForFile(filePath, sourceRoot) {
  const fileDir = dirname(filePath);
  const customMenuInfo = findCustomMenu(fileDir, sourceRoot);
  
  if (!customMenuInfo) {
    return null;
  }
  
  // Extract frontmatter options
  const { frontmatter, body } = extractMenuFrontmatter(customMenuInfo.content);
  const autoGenerate = frontmatter['auto-generate-menu'] === true || frontmatter['auto-generate-menu'] === 'true';
  const menuPosition = frontmatter['menu-position'] || 'side';
  const depth = parseInt(frontmatter['menu-depth'], 10) || 2;
  
  let menuData;
  
  if (autoGenerate) {
    // Auto-generate menu and combine with manual menu content
    menuData = combineAutoAndManualMenu(body, customMenuInfo.menuDir, sourceRoot, depth);
  } else {
    // Parse the custom menu content (excluding frontmatter)
    menuData = parseCustomMenu(body, customMenuInfo.menuDir, sourceRoot);
  }
  
  return {
    menuData,
    menuPath: customMenuInfo.path,
    menuDir: customMenuInfo.menuDir,
    menuPosition, // 'top' or 'side'
  };
}

/**
 * Build menu HTML structure from custom menu data
 * This matches the format expected by the existing menu.js client-side code
 * @param {Array} menuData - The parsed menu data
 * @param {string} position - 'side' or 'top'
 * @returns {string} - HTML string for the menu
 */
export function buildCustomMenuHtml(menuData, position = 'side') {
  if (position === 'top') {
    return buildTopMenuHtml(menuData);
  }
  
  const menuConfigScript = `<script type="application/json" id="menu-config">${JSON.stringify({ openMenuItems: [], customMenu: true })}</script>`;
  
  const breadcrumbHtml = `
<div class="menu-breadcrumb" style="display: none;">
  <button class="menu-back" title="Go back">←</button>
  <button class="menu-home" title="Go to root">🏠</button>
  <span class="menu-current-path"></span>
</div>`;

  const menuHtml = renderCustomMenuLevel(menuData);
  
  return `${menuConfigScript}${breadcrumbHtml}<ul class="menu-level" data-level="0">${menuHtml}</ul>`;
}

/**
 * Build top navigation menu HTML
 * Top-level items are horizontal, with dropdowns for children
 * @param {Array} menuData - The parsed menu data
 * @returns {string} - HTML string for the top menu
 */
function buildTopMenuHtml(menuData) {
  const menuConfigScript = `<script type="application/json" id="menu-config">${JSON.stringify({ openMenuItems: [], customMenu: true, position: 'top' })}</script>`;
  
  const menuItems = menuData.map(item => {
    const hasChildrenClass = item.hasChildren ? ' has-dropdown' : '';
    
    const labelHtml = item.href
      ? `<a href="${item.href}" class="top-menu-label">${item.label}</a>`
      : `<span class="top-menu-label">${item.label}</span>`;
    
    let dropdownHtml = '';
    if (item.hasChildren && item.children && item.children.length > 0) {
      dropdownHtml = `<ul class="top-menu-dropdown">${renderTopMenuDropdown(item.children)}</ul>`;
    }
    
    return `
<li class="top-menu-item${hasChildrenClass}">
  ${labelHtml}
  ${dropdownHtml}
</li>`;
  }).join('');
  
  return `${menuConfigScript}<ul class="top-menu-level">${menuItems}</ul>`;
}

/**
 * Render dropdown items for top menu
 * @param {Array} items - Menu items
 * @returns {string} - HTML string
 */
function renderTopMenuDropdown(items) {
  return items.map(item => {
    const hasChildrenClass = item.hasChildren ? ' has-flyout' : '';
    
    const labelHtml = item.href
      ? `<a href="${item.href}" class="dropdown-label">${item.label}</a>`
      : `<span class="dropdown-label">${item.label}</span>`;
    
    let flyoutHtml = '';
    if (item.hasChildren && item.children && item.children.length > 0) {
      flyoutHtml = `<ul class="top-menu-flyout">${renderTopMenuDropdown(item.children)}</ul>`;
    }
    
    return `
<li class="dropdown-item${hasChildrenClass}">
  ${labelHtml}
  ${item.hasChildren ? '<span class="flyout-indicator">▶</span>' : ''}
  ${flyoutHtml}
</li>`;
  }).join('');
}

/**
 * Render a level of the custom menu
 * @param {Array} items - Menu items at this level
 * @returns {string} - HTML string
 */
function renderCustomMenuLevel(items) {
  return items.map(item => {
    const hasChildrenClass = item.hasChildren ? ' has-children' : '';
    const hasChildrenIndicator = item.hasChildren ? '<span class="menu-more">⋯</span>' : '';
    
    const labelHtml = item.href
      ? `<a href="${item.href}" class="menu-label">${item.label}</a>`
      : `<span class="menu-label">${item.label}</span>`;
    
    return `
<li class="menu-item${hasChildrenClass}" data-path="${item.path}">
  <div class="menu-item-row">
    ${item.icon}
    ${labelHtml}
    ${hasChildrenIndicator}
  </div>
</li>`;
  }).join('');
}

/**
 * Check if a directory (or any parent) has a custom menu
 * @param {string} dirPath - The directory to check
 * @param {string} sourceRoot - The root source directory
 * @returns {boolean} - True if a custom menu exists
 */
export function hasCustomMenu(dirPath, sourceRoot) {
  return findCustomMenu(dirPath, sourceRoot) !== null;
}
