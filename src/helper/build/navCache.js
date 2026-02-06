// Navigation cache for build performance
// Caches the menu structure and only rebuilds when the file list changes

import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { createHash } from 'crypto';

const NAV_CACHE_FILE = 'nav-cache.json';

/**
 * Generate a hash of the file list to detect changes
 * @param {string[]} files - Array of file paths
 * @returns {string} Hash of the file list
 */
export function hashFileList(files) {
  const sorted = [...files].sort();
  return createHash('md5').update(sorted.join('\n')).digest('hex').substring(0, 16);
}

/**
 * Generate a hash of file stats for detecting content changes
 * Uses mtime and size for speed (avoids reading file contents)
 * @param {string[]} files - Array of file paths to check
 * @returns {Promise<string>} Hash of file stats
 */
export async function hashFileStats(files) {
  // Only check index files and config files that affect menu generation
  const relevantFiles = files.filter(f => {
    const base = basename(f).toLowerCase();
    return base === 'index.md' || 
           base === 'index.mdx' ||
           base === 'index.txt' || 
           base === 'index.yml' ||
           base === 'config.json' ||
           base.endsWith('-icon.png') ||
           base.endsWith('-icon.svg') ||
           base === 'icon.png' ||
           base === 'icon.svg';
  }).sort();
  
  // Stat files in parallel batches for speed
  const BATCH_SIZE = 100;
  const stats = [];
  
  for (let i = 0; i < relevantFiles.length; i += BATCH_SIZE) {
    const batch = relevantFiles.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (file) => {
      try {
        const s = await stat(file);
        return `${file}:${s.mtimeMs}:${s.size}`;
      } catch (e) {
        return null; // File might not exist
      }
    }));
    stats.push(...batchResults.filter(Boolean));
  }
  
  return createHash('md5').update(stats.join('\n')).digest('hex').substring(0, 16);
}

/**
 * Load the navigation cache from disk
 * @param {string} sourceDir - Source directory root
 * @returns {Promise<object|null>} Cached nav data or null
 */
export async function loadNavCache(sourceDir) {
  const cachePath = join(sourceDir, '.ursa', NAV_CACHE_FILE);
  try {
    if (existsSync(cachePath)) {
      const data = await readFile(cachePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    // Ignore errors
  }
  return null;
}

/**
 * Save the navigation cache to disk
 * @param {string} sourceDir - Source directory root
 * @param {object} cache - Cache data to save
 */
export async function saveNavCache(sourceDir, cache) {
  const ursaDir = join(sourceDir, '.ursa');
  const cachePath = join(ursaDir, NAV_CACHE_FILE);
  try {
    await mkdir(ursaDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn('Could not save nav cache:', e.message);
  }
}

/**
 * Check if the navigation cache is valid
 * @param {object} cache - The cached data
 * @param {string} fileListHash - Current file list hash
 * @param {string} fileStatsHash - Current file stats hash
 * @returns {boolean} True if cache is valid
 */
export function isNavCacheValid(cache, fileListHash, fileStatsHash) {
  if (!cache) return false;
  if (cache.fileListHash !== fileListHash) return false;
  if (cache.fileStatsHash !== fileStatsHash) return false;
  if (!cache.menuData || !cache.menuHtml || !cache.validPaths) return false;
  return true;
}

/**
 * Create a cache entry
 * @param {string} fileListHash - Hash of file list
 * @param {string} fileStatsHash - Hash of file stats
 * @param {object} menuData - Menu data structure
 * @param {string} menuHtml - Rendered menu HTML
 * @param {Array} validPathsArray - Valid paths as array of [key, value] pairs
 * @param {Map} customMenus - Custom menus map
 * @returns {object} Cache entry
 */
export function createNavCacheEntry(fileListHash, fileStatsHash, menuData, menuHtml, validPathsArray, customMenusArray) {
  return {
    version: 1,
    timestamp: Date.now(),
    fileListHash,
    fileStatsHash,
    menuData,
    menuHtml,
    validPaths: validPathsArray,
    customMenus: customMenusArray,
  };
}

/**
 * Restore a Map from cached array
 * @param {Array} arr - Array of [key, value] pairs
 * @returns {Map} Restored map
 */
export function restoreMap(arr) {
  return new Map(arr);
}
