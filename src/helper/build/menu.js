// Menu helpers for build
import { getAutomenu } from "../automenu.js";
import { renderFile } from "../fileRenderer.js";
import { findCustomMenu, parseCustomMenu, buildCustomMenuHtml, getCustomMenuForFile as getCustomMenuFromFile, extractMenuFrontmatter, combineAutoAndManualMenu } from "../customMenu.js";
import { dirname, relative, resolve } from "path";
import { readFileSync } from "fs";

/**
 * Get menu HTML and menu data from source directory
 * @param {string[]} allSourceFilenames - All source file names
 * @param {string} source - Source directory path
 * @param {Map<string, string>} validPaths - Map of normalized paths to canonical resolved paths for link validation
 * @returns {Promise<{html: string, menuData: Object}>} Menu HTML and menu data
 */
export async function getMenu(allSourceFilenames, source, validPaths) {
  const menuResult = await getAutomenu(source, validPaths);
  const menuBody = renderFile({ fileContents: menuResult.html, type: ".md" });
  return {
    html: menuBody,
    menuData: menuResult.menuData
  };
}

/**
 * Find all unique custom menus in the source tree
 * @param {string[]} allSourceFilenames - All source file names
 * @param {string} source - Source directory path
 * @returns {Map<string, {menuPath: string, menuDir: string, menuData: Array, menuPosition: string}>} Map of menu dir to menu info
 */
export function findAllCustomMenus(allSourceFilenames, source) {
  const customMenus = new Map();
  const checkedDirs = new Set();
  
  // Check each directory for custom menus
  for (const file of allSourceFilenames) {
    const dir = dirname(file);
    if (checkedDirs.has(dir)) continue;
    checkedDirs.add(dir);
    
    const menuInfo = findCustomMenu(dir, source);
    if (menuInfo && !customMenus.has(menuInfo.menuDir)) {
      // Use the enhanced getCustomMenuForFile that handles frontmatter
      const parsedMenu = getCustomMenuFromFile(dir + '/index.md', source);
      
      // If getCustomMenuFromFile found the same menu, use its parsed data
      if (parsedMenu && parsedMenu.menuDir === menuInfo.menuDir) {
        customMenus.set(menuInfo.menuDir, {
          menuPath: menuInfo.path,
          menuDir: menuInfo.menuDir,
          menuData: parsedMenu.menuData,
          menuPosition: parsedMenu.menuPosition || 'side',
          // The URL path for the menu JSON file
          menuJsonPath: '/public/custom-menu-' + getMenuId(menuInfo.menuDir, source) + '.json',
        });
      } else {
        // Fallback to direct parsing - also handles auto-generate
        const { frontmatter, body } = extractMenuFrontmatter(menuInfo.content);
        const autoGenerate = frontmatter['auto-generate-menu'] === true || frontmatter['auto-generate-menu'] === 'true';
        
        let menuData;
        if (autoGenerate) {
          // Auto-generate menu and combine with manual content
          const depth = parseInt(frontmatter['menu-depth'], 10) || 2;
          menuData = combineAutoAndManualMenu(body, menuInfo.menuDir, source, depth);
        } else {
          menuData = parseCustomMenu(body, menuInfo.menuDir, source);
        }
        
        customMenus.set(menuInfo.menuDir, {
          menuPath: menuInfo.path,
          menuDir: menuInfo.menuDir,
          menuData,
          menuPosition: frontmatter['menu-position'] || 'side',
          // The URL path for the menu JSON file
          menuJsonPath: '/public/custom-menu-' + getMenuId(menuInfo.menuDir, source) + '.json',
        });
      }
    }
  }
  
  return customMenus;
}

/**
 * Generate a unique ID for a custom menu based on its directory
 * @param {string} menuDir - The directory where the menu is located
 * @param {string} source - The source root directory
 * @returns {string} - A URL-safe ID
 */
function getMenuId(menuDir, source) {
  const relativePath = relative(source, menuDir);
  if (!relativePath) return 'root';
  return relativePath.replace(/[\/\\]/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
}

/**
 * Get the custom menu info for a specific file path
 * @param {string} filePath - The source file path
 * @param {string} source - The source root directory
 * @param {Map} customMenus - Map of all custom menus
 * @returns {{menuJsonPath: string, menuDir: string, menuPosition: string} | null} - Custom menu info or null
 */
export function getCustomMenuForFile(filePath, source, customMenus) {
  const fileDir = resolve(dirname(filePath));
  const sourceResolved = resolve(source);
  
  // Walk up from file dir to find matching custom menu
  let currentDir = fileDir;
  while (currentDir.startsWith(sourceResolved)) {
    if (customMenus.has(currentDir)) {
      const menuInfo = customMenus.get(currentDir);
      return {
        menuJsonPath: menuInfo.menuJsonPath,
        menuDir: relative(source, menuInfo.menuDir) || '',
        menuPosition: menuInfo.menuPosition || 'side',
      };
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  
  return null;
}

/**
 * Build HTML for a custom menu
 * @param {Array} menuData - The parsed menu data
 * @param {string} position - 'side' or 'top' (default: 'side')
 * @returns {string} - HTML string for the menu
 */
export function buildCustomMenuHtmlExport(menuData, position = 'side') {
  return buildCustomMenuHtml(menuData, position);
}
