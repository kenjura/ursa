// Menu helpers for build
import { getAutomenu } from "../automenu.js";
import { renderFile } from "../fileRenderer.js";

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
