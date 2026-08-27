import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { getUrsaVersion } from './ursaVersion.js';

const URSA_DIR = '.ursa';
const HASH_CACHE_FILE = 'content-hashes.json';
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

/**
 * Generate a short hash of content
 */
export function hashContent(content) {
  return createHash('md5').update(content).digest('hex').substring(0, 12);
}

/**
 * Load the hash cache from disk (.ursa folder in source directory)
 */
export async function loadHashCache(sourceDir) {
  const cachePath = join(getUrsaDir(sourceDir), HASH_CACHE_FILE);
  try {
    if (existsSync(cachePath)) {
      const data = await readFile(cachePath, 'utf8');
      return new Map(Object.entries(JSON.parse(data)));
    }
  } catch (e) {
    console.warn('Could not load hash cache:', e.message);
  }
  return new Map();
}

/**
 * Save the hash cache to disk (.ursa folder in source directory)
 */
export async function saveHashCache(sourceDir, hashMap) {
  const ursaDir = getUrsaDir(sourceDir);
  const cachePath = join(ursaDir, HASH_CACHE_FILE);
  try {
    await mkdir(ursaDir, { recursive: true });
    const obj = Object.fromEntries(hashMap);
    await writeFile(cachePath, JSON.stringify(obj, null, 2));
    console.log(`Saved ${hashMap.size} hashes to ${cachePath}`);
  } catch (e) {
    console.warn('Could not save hash cache:', e.message);
  }
}

/**
 * Check if a file needs regeneration based on content hash
 */
export function needsRegeneration(filePath, content, hashCache) {
  const newHash = hashContent(content);
  const oldHash = hashCache.get(filePath);
  return newHash !== oldHash;
}

/**
 * Check whether every expected output file for a source document exists.
 *
 * A matching content hash only proves the *source* is unchanged — it says
 * nothing about whether the output was ever written to this particular output
 * directory. The hash cache lives in the source tree (`<source>/.ursa/`) and is
 * shared by every output directory built from that source, so a hash written
 * during a build to one output dir will hash-skip the same file during a build
 * to another. Deleting (or partially losing) an output dir has the same effect.
 * Callers must combine this with needsRegeneration() so a missing output always
 * forces a rebuild.
 *
 * @param {string[]} outputPaths - Absolute paths to every file the build emits for this document
 * @returns {boolean} True only if all of them are present
 */
export function outputsExist(outputPaths) {
  return outputPaths.every((p) => existsSync(p));
}

/**
 * Update the hash for a file in the cache
 */
export function updateHash(filePath, content, hashCache) {
  const hash = hashContent(content);
  hashCache.set(filePath, hash);
  return hash;
}
