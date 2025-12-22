// Custom menu support - allows defining custom menus in menu.md, menu.txt, _menu.md, or _menu.txt
import { existsSync, readFileSync } from "fs";
import { join, dirname, relative, resolve, basename } from "path";

// Menu file names to look for (in order of priority)
const MENU_FILE_NAMES = ['menu.md', 'menu.txt', '_menu.md', '_menu.txt'];

// Source file extensions to check
const SOURCE_EXTENSIONS = ['.md', '.txt'];

// Default icons
const FOLDER_ICON = '📁';
const DOCUMENT_ICON = '📄';

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
    // Try markdown format: - [Label](path)
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
    if (href.startsWith('./') || href.startsWith('../') || !href.startsWith('/')) {
      // It's a relative path - resolve it relative to the menu directory
      absoluteSourcePath = resolve(menuDir, href);
      
      // Check if the source file exists
      const fileExists = sourceFileExists(absoluteSourcePath);
      
      if (fileExists) {
        // Convert to web-accessible path (relative to source root)
        href = '/' + relative(sourceRoot, absoluteSourcePath);
        // Normalize path separators for web
        href = href.replace(/\\/g, '/');
        // Ensure it ends with .html if it doesn't have an extension
        if (!href.match(/\.[a-z]+$/i)) {
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
 * @returns {{menuData: Array, menuPath: string} | null} - Menu data and path, or null if no custom menu
 */
export function getCustomMenuForFile(filePath, sourceRoot) {
  const fileDir = dirname(filePath);
  const customMenuInfo = findCustomMenu(fileDir, sourceRoot);
  
  if (!customMenuInfo) {
    return null;
  }
  
  const menuData = parseCustomMenu(customMenuInfo.content, customMenuInfo.menuDir, sourceRoot);
  
  return {
    menuData,
    menuPath: customMenuInfo.path,
    menuDir: customMenuInfo.menuDir,
  };
}

/**
 * Build menu HTML structure from custom menu data
 * This matches the format expected by the existing menu.js client-side code
 * @param {Array} menuData - The parsed menu data
 * @returns {string} - HTML string for the menu
 */
export function buildCustomMenuHtml(menuData) {
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
