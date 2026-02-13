// Watch mode cache and clear function for build

import { dependencyTracker } from "../dependencyTracker.js";

export const watchModeCache = {
  templates: null,
  menu: null,
  footer: null,
  validPaths: null,
  source: null,
  meta: null,
  output: null,
  hashCache: null,
  cacheBustTimestamp: null,
  cacheBustHashes: null,   // CacheBustHashMap instance for per-file cache-busting
  allArticlePaths: null,   // Array of all article paths (for full rebuild tracking)
  lastFullBuild: 0,
  isInitialized: false,
};

export function clearWatchCache(cssPathCache) {
  watchModeCache.templates = null;
  watchModeCache.menu = null;
  watchModeCache.footer = null;
  watchModeCache.validPaths = null;
  watchModeCache.hashCache = null;
  watchModeCache.cacheBustHashes = null;
  watchModeCache.allArticlePaths = null;
  watchModeCache.isInitialized = false;
  dependencyTracker.init("");
  if (cssPathCache) cssPathCache.clear();
  console.log('Watch cache cleared');
}
