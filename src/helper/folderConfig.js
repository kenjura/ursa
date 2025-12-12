import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

const CONFIG_FILENAME = 'config.json';

// Cache for folder configs to avoid repeated file reads
const configCache = new Map();

/**
 * Folder configuration schema:
 * {
 *   label?: string,       // Custom label for menu display
 *   icon?: string,        // URL to icon image for menu
 *   hidden?: boolean,     // If true, hide from menu and don't generate files
 *   openMenuItems?: string[]  // (root only) Array of folder names to expand by default
 * }
 */

/**
 * Clear the config cache (useful between generation runs)
 */
export function clearConfigCache() {
  configCache.clear();
}

/**
 * Read and parse a folder's config.json if it exists (synchronous)
 * @param {string} folderPath - Absolute path to the folder
 * @returns {object|null} Parsed config object or null if not found
 */
export function getFolderConfig(folderPath) {
  // Check cache first
  if (configCache.has(folderPath)) {
    return configCache.get(folderPath);
  }
  
  const configPath = join(folderPath, CONFIG_FILENAME);
  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      const config = JSON.parse(content);
      configCache.set(folderPath, config);
      return config;
    }
  } catch (e) {
    console.warn(`Could not read folder config at ${configPath}:`, e.message);
  }
  
  configCache.set(folderPath, null);
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
 * Check if a folder or any of its ancestors is hidden via config.json
 * @param {string} folderPath - Absolute path to check
 * @param {string} sourceRoot - The source root directory (stop checking at this level)
 * @returns {boolean} True if this folder should be hidden
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
