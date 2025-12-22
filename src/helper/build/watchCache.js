// Watch mode cache and clear function for build

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
  lastFullBuild: 0,
  isInitialized: false,
};

export function clearWatchCache(cssPathCache) {
  watchModeCache.templates = null;
  watchModeCache.menu = null;
  watchModeCache.footer = null;
  watchModeCache.validPaths = null;
  watchModeCache.hashCache = null;
  watchModeCache.isInitialized = false;
  if (cssPathCache) cssPathCache.clear();
  console.log('Watch cache cleared');
}
