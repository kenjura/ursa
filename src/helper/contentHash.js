import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { getUrsaVersion } from './ursaVersion.js';

const URSA_DIR = '.ursa';
const CACHE_STAMP_FILE = 'cache-stamp.json';

/**
 * Get the path to the .ursa directory for a given source directory
 */
export function getUrsaDir(sourceDir) {
  return join(sourceDir, URSA_DIR);
}

/**
 * Stamp `.ursa/` with the running ursa version, discarding the whole directory
 * first if it was written by a different one.
 *
 * Hash-skipping compares *source* content only. It says nothing about the code
 * that turned that source into output, so a cache warmed by an older ursa keeps
 * whole documents from being re-rendered even after the templates, renderers and
 * asset bundles that produced them have changed — the symptom users hit as
 * "I had to run --clean again". Run this before loading any cache.
 *
 * On a first build there is nothing to discard, and `reset` is false.
 *
 * @param {string} sourceDir - Source directory root
 * @param {string} [version] - Version to stamp with; defaults to ursa's own
 * @returns {Promise<{reset: boolean, previous: string|null, version: string}>}
 */
export async function enforceCacheVersion(sourceDir, version = getUrsaVersion()) {
  const ursaDir = getUrsaDir(sourceDir);
  const stampPath = join(ursaDir, CACHE_STAMP_FILE);

  let previous = null;
  try {
    if (existsSync(stampPath)) {
      const stamp = JSON.parse(await readFile(stampPath, 'utf8'));
      previous = typeof stamp?.ursaVersion === 'string' ? stamp.ursaVersion : null;
    }
  } catch (e) {
    // An unreadable stamp tells us nothing about what wrote the cache, so treat
    // it the same as a mismatch rather than trusting the caches beside it.
    previous = null;
  }

  if (previous === version) return { reset: false, previous, version };

  // A cache directory with no stamp predates stamping (or was hand-edited);
  // either way its contents were not written by this ursa.
  const hadCache = existsSync(ursaDir);
  if (hadCache) await rm(ursaDir, { recursive: true, force: true });

  try {
    await mkdir(ursaDir, { recursive: true });
    await writeFile(stampPath, JSON.stringify({ ursaVersion: version }, null, 2));
  } catch (e) {
    // A cache we cannot stamp is a cache we will discard again next run:
    // correct, just slower. Not worth failing the build over.
    console.warn('Could not write cache stamp:', e.message);
  }

  return { reset: hadCache, previous, version };
}
