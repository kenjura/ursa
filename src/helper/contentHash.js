import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

const URSA_DIR = '.ursa';
const HASH_CACHE_FILE = 'content-hashes.json';

/**
 * Get the path to the .ursa directory for a given source directory
 */
export function getUrsaDir(sourceDir) {
  return join(sourceDir, URSA_DIR);
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
