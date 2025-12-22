// Menu helpers for build
import { getAutomenu } from "../automenu.js";
import { renderFile } from "../fileRenderer.js";
import { findCustomMenu, parseCustomMenu, buildCustomMenuHtml } from "../customMenu.js";
import { dirname, relative, resolve } from "path";

/**
 * Get menu HTML and menu data from source directory
 * @param {string[]} allSourceFilenames - All source file names
 * @param {string} source - Source directory path
 * @param {Set<string>} validPaths - Set of valid internal paths for link validation
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
 * @returns {Map<string, {menuPath: string, menuDir: string, menuData: Array}>} Map of menu dir to menu info
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
      const menuData = parseCustomMenu(menuInfo.content, menuInfo.menuDir, source);
      customMenus.set(menuInfo.menuDir, {
        menuPath: menuInfo.path,
        menuDir: menuInfo.menuDir,
        menuData,
        // The URL path for the menu JSON file
        menuJsonPath: '/public/custom-menu-' + getMenuId(menuInfo.menuDir, source) + '.json',
      });
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
 * @returns {{menuJsonPath: string, menuDir: string} | null} - Custom menu info or null
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
 * @returns {string} - HTML string for the menu
 */
export function buildCustomMenuHtmlExport(menuData) {
  return buildCustomMenuHtml(menuData);
}
