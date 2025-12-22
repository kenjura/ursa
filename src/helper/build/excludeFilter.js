// Exclude/filter helpers for build
import { existsSync } from "fs";
import { readFile, stat } from "fs/promises";

/**
 * Parse exclude option - can be comma-separated paths or a file path
 * @param {string} excludeOption - The exclude option value
 * @param {string} source - Source directory path
 * @returns {Promise<Set<string>>} Set of excluded folder paths (normalized)
 */
export async function parseExcludeOption(excludeOption, source) {
  const excludedPaths = new Set();
  
  if (!excludeOption) return excludedPaths;
  
  // Check if it's a file path (exists as a file)
  const isFile = existsSync(excludeOption) && (await stat(excludeOption)).isFile();
  
  let patterns;
  if (isFile) {
    // Read patterns from file (one per line)
    const content = await readFile(excludeOption, 'utf8');
    patterns = content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')); // Skip empty lines and comments
  } else {
    // Treat as comma-separated list
    patterns = excludeOption.split(',').map(p => p.trim()).filter(Boolean);
  }
  
  // Normalize patterns to absolute paths
  for (const pattern of patterns) {
    // Remove leading/trailing slashes and normalize
    const normalized = pattern.replace(/^\/+|\/+$/g, '');
    // Store as relative path for easier matching
    excludedPaths.add(normalized);
  }
  
  return excludedPaths;
}

/**
 * Create a filter function that excludes files in specified folders
 * @param {Set<string>} excludedPaths - Set of excluded folder paths
 * @param {string} source - Source directory path
 * @returns {Function} Filter function
 */
export function createExcludeFilter(excludedPaths, source) {
  if (excludedPaths.size === 0) {
    return () => true; // No exclusions, allow all
  }
  
  return (filePath) => {
    // Get path relative to source
    const relativePath = filePath.replace(source, '').replace(/^\/+/, '');
    
    // Check if file is in any excluded folder
    for (const excluded of excludedPaths) {
      if (relativePath === excluded || 
          relativePath.startsWith(excluded + '/') ||
          relativePath.startsWith(excluded + '\\')) {
        return false; // Exclude this file
      }
    }
    return true; // Include this file
  };
}
