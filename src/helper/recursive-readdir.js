import { resolve } from "path";
import { readdir } from "fs/promises";

/**
 * Recursively read directory contents.
 * Optimized to be more memory-efficient by using iteration instead of deep recursion.
 * @param {string} dir - Directory to read
 * @returns {Promise<string[]>} Array of file paths
 */
export async function recurse(dir) {
  const results = [];
  const stack = [dir];
  
  while (stack.length > 0) {
    const currentDir = stack.pop();
    try {
      const dirents = await readdir(currentDir, { withFileTypes: true });
      for (const dirent of dirents) {
        const res = resolve(currentDir, dirent.name);
        if (dirent.isDirectory()) {
          results.push(res);
          stack.push(res);
        } else {
          results.push(res);
        }
      }
    } catch (e) {
      // Skip directories we can't read (permission errors, etc.)
      console.warn(`Warning: Could not read directory ${currentDir}: ${e.message}`);
    }
  }
  
  return results;
}
