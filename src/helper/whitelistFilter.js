import { readFile } from 'fs/promises';
import { resolve, relative } from 'path';
import { existsSync } from 'fs';

/**
 * Creates a filter function based on a whitelist file
 * @param {string} whitelistPath - Path to the whitelist file
 * @param {string} sourceRoot - Root source directory for relative path matching
 * @returns {Function} Filter function that returns true if file should be included
 */
export async function createWhitelistFilter(whitelistPath, sourceRoot) {
  if (!whitelistPath || !existsSync(whitelistPath)) {
    return () => true; // No whitelist = include all files
  }

  try {
    const whitelistContent = await readFile(whitelistPath, 'utf8');
    const patterns = whitelistContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')); // Remove empty lines and comments

    if (patterns.length === 0) {
      return () => true; // Empty whitelist = include all files
    }

    return (filePath) => {
      const absolutePath = resolve(filePath);
      const relativePath = relative(sourceRoot, absolutePath);
      
      return patterns.some(pattern => {
        // Full absolute path match
        if (pattern.startsWith('/') && absolutePath === pattern) {
          return true;
        }
        
        // Relative path match (from source root)
        if (relativePath === pattern || relativePath.includes(pattern)) {
          return true;
        }
        
        // Directory match (pattern ends with /)
        if (pattern.endsWith('/')) {
          const dirPattern = pattern.slice(0, -1);
          return relativePath.startsWith(dirPattern + '/') || relativePath === dirPattern;
        }
        
        // Filename match
        const fileName = absolutePath.split('/').pop();
        if (fileName === pattern) {
          return true;
        }
        
        // Partial path match (anywhere in the path)
        if (absolutePath.includes(pattern) || relativePath.includes(pattern)) {
          return true;
        }
        
        return false;
      });
    };
  } catch (error) {
    console.warn(`Warning: Could not read whitelist file ${whitelistPath}:`, error.message);
    return () => true; // Fallback to include all files
  }
}