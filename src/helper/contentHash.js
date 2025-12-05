import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Generate a short hash of content
 */
export function hashContent(content) {
  return createHash('md5').update(content).digest('hex').substring(0, 12);
}

/**
 * Load the hash cache from disk
 */
export async function loadHashCache(outputDir) {
  const cachePath = join(outputDir, '.content-hashes.json');
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
 * Save the hash cache to disk
 */
export async function saveHashCache(outputDir, hashMap) {
  const cachePath = join(outputDir, '.content-hashes.json');
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    const obj = Object.fromEntries(hashMap);
    await writeFile(cachePath, JSON.stringify(obj, null, 2));
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
 * Update the hash for a file in the cache
 */
export function updateHash(filePath, content, hashCache) {
  const hash = hashContent(content);
  hashCache.set(filePath, hash);
  return hash;
}
