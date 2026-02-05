// Image processing helpers for build
// Generates optimized WebP preview images and copies originals

import { mkdir, copyFile, stat, readFile, writeFile } from "fs/promises";
import { dirname, basename, extname, join, parse } from "path";
import { existsSync } from "fs";

// Preview image settings
// 50rem ~= 800px at default 16px font size
const PREVIEW_MAX_WIDTH = 800;
const PREVIEW_MAX_HEIGHT = 800;
const PREVIEW_QUALITY = 80;

// Parallel processing settings
const PARALLEL_BATCH_SIZE = 8; // Process 8 images at a time (CPU-bound task)

// Image extensions that can be processed to WebP previews
const PROCESSABLE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
// Extensions that should just be copied (SVG, ICO are vector/special formats)
const COPY_ONLY_EXTENSIONS = ['.svg', '.ico'];

// Cache to track which images have been processed (in-memory for single run)
const processedImages = new Map();

// Persistent cache for image metadata (to avoid re-processing unchanged images)
const IMAGE_CACHE_FILE = 'image-cache.json';

// Sharp is optional - will fall back to copy-only if not available
let sharp = null;
let sharpAvailable = false;

/**
 * Try to load sharp. If not available, fall back to copy-only mode.
 */
async function ensureSharp() {
  if (sharp !== null) return sharpAvailable;
  
  try {
    const sharpModule = await import('sharp');
    sharp = sharpModule.default;
    sharpAvailable = true;
    return true;
  } catch (e) {
    console.warn('⚠️  sharp not available - images will be copied without preview generation');
    console.warn('   Install sharp for WebP preview generation: npm install sharp');
    sharpAvailable = false;
    return false;
  }
}

/**
 * Load the persistent image cache from the .ursa folder
 * @param {string} sourceDir - Source directory root
 * @returns {Promise<Map<string, {mtime: number, size: number, result: object}>>}
 */
export async function loadImageCache(sourceDir) {
  const cachePath = join(sourceDir, '.ursa', IMAGE_CACHE_FILE);
  try {
    if (existsSync(cachePath)) {
      const data = await readFile(cachePath, 'utf8');
      return new Map(Object.entries(JSON.parse(data)));
    }
  } catch (e) {
    // Ignore errors, just return empty cache
  }
  return new Map();
}

/**
 * Save the persistent image cache to the .ursa folder
 * @param {string} sourceDir - Source directory root
 * @param {Map} cache - Image cache map
 */
export async function saveImageCache(sourceDir, cache) {
  const ursaDir = join(sourceDir, '.ursa');
  const cachePath = join(ursaDir, IMAGE_CACHE_FILE);
  try {
    await mkdir(ursaDir, { recursive: true });
    const obj = Object.fromEntries(cache);
    await writeFile(cachePath, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn('Could not save image cache:', e.message);
  }
}

/**
 * Check if an image needs reprocessing based on mtime and size
 * @param {string} sourcePath - Path to source image
 * @param {Map} imageCache - Persistent image cache
 * @returns {Promise<{needsProcessing: boolean, cachedResult: object|null}>}
 */
async function checkImageCache(sourcePath, imageCache) {
  try {
    const stats = await stat(sourcePath);
    const cached = imageCache.get(sourcePath);
    
    if (cached && cached.mtime === stats.mtimeMs && cached.size === stats.size) {
      return { needsProcessing: false, cachedResult: cached.result };
    }
    
    return { needsProcessing: true, cachedResult: null, stats };
  } catch (e) {
    return { needsProcessing: true, cachedResult: null, stats: null };
  }
}

/**
 * Check if an image is small enough that preview generation would be wasteful
 * @param {string} sourcePath - Path to source image
 * @returns {Promise<boolean>} True if image should skip preview generation
 */
async function isImageSmallEnough(sourcePath) {
  const hasSharp = await ensureSharp();
  if (!hasSharp) return true;
  
  try {
    const metadata = await sharp(sourcePath).metadata();
    // Skip if image is already smaller than preview dimensions
    return (metadata.width <= PREVIEW_MAX_WIDTH && metadata.height <= PREVIEW_MAX_HEIGHT);
  } catch (e) {
    return false; // If we can't read metadata, try to process it anyway
  }
}

/**
 * Generate preview filename from original filename
 * e.g., "photo.jpg" -> "photo.preview.webp"
 * @param {string} filename - Original filename (just the name, not path)
 * @returns {string} Preview filename
 */
export function getPreviewFilename(filename) {
  const parsed = parse(filename);
  return `${parsed.name}.preview.webp`;
}

/**
 * Process a single image file:
 * - Generate a WebP preview at reduced size
 * - Copy the original image
 * 
 * @param {string} sourcePath - Absolute path to source image
 * @param {string} outputDir - Absolute path to output directory
 * @param {string} relativeDir - Relative directory path for URL generation
 * @param {Map} imageCache - Optional persistent image cache for skipping unchanged images
 * @returns {Promise<{original: string, preview: string, skipped?: boolean}|null>} Paths or null if not an image
 */
export async function processImage(sourcePath, outputDir, relativeDir, imageCache = null) {
  const ext = extname(sourcePath).toLowerCase();
  const filename = basename(sourcePath);
  
  // Check if already processed in this run
  const cacheKey = `${sourcePath}:${outputDir}`;
  if (processedImages.has(cacheKey)) {
    return processedImages.get(cacheKey);
  }
  
  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });
  
  const originalOutputPath = join(outputDir, filename);
  // Ensure URL is absolute (starts with /)
  let originalUrl = join(relativeDir, filename).replace(/\\/g, '/');
  if (!originalUrl.startsWith('/')) {
    originalUrl = '/' + originalUrl;
  }
  
  // SVG and ICO: just copy, no preview needed
  if (COPY_ONLY_EXTENSIONS.includes(ext)) {
    await copyFile(sourcePath, originalOutputPath);
    const result = {
      original: originalUrl,
      preview: originalUrl, // Same as original for non-processable images
    };
    processedImages.set(cacheKey, result);
    return result;
  }
  
  // Check if this is a processable image format
  if (!PROCESSABLE_EXTENSIONS.includes(ext)) {
    return null; // Not an image we handle
  }
  
  // Check persistent cache - skip if image hasn't changed
  if (imageCache) {
    const { needsProcessing, cachedResult } = await checkImageCache(sourcePath, imageCache);
    if (!needsProcessing && cachedResult) {
      // Verify that output files exist before using cache
      const previewPath = join(outputDir, getPreviewFilename(filename));
      if (existsSync(originalOutputPath) && 
          (cachedResult.preview === cachedResult.original || existsSync(previewPath))) {
        processedImages.set(cacheKey, cachedResult);
        return { ...cachedResult, skipped: true };
      }
    }
  }
  
  // Always copy the original
  await copyFile(sourcePath, originalOutputPath);
  
  // Try to generate WebP preview
  const hasSharp = await ensureSharp();
  
  if (!hasSharp) {
    // No sharp available - use original as both
    const result = {
      original: originalUrl,
      preview: originalUrl,
    };
    processedImages.set(cacheKey, result);
    await updateImageCache(sourcePath, result, imageCache);
    return result;
  }
  
  // Check if image is small enough to skip preview generation
  const isSmall = await isImageSmallEnough(sourcePath);
  if (isSmall) {
    const result = {
      original: originalUrl,
      preview: originalUrl, // Use original as preview - no point in generating
    };
    processedImages.set(cacheKey, result);
    await updateImageCache(sourcePath, result, imageCache);
    return result;
  }
  
  try {
    const previewFilename = getPreviewFilename(filename);
    const previewOutputPath = join(outputDir, previewFilename);
    // Ensure URL is absolute (starts with /)
    let previewUrl = join(relativeDir, previewFilename).replace(/\\/g, '/');
    if (!previewUrl.startsWith('/')) {
      previewUrl = '/' + previewUrl;
    }
    
    // Generate WebP preview with size limits
    await sharp(sourcePath)
      .resize(PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true, // Don't upscale small images
      })
      .webp({ quality: PREVIEW_QUALITY })
      .toFile(previewOutputPath);
    
    const result = {
      original: originalUrl,
      preview: previewUrl,
    };
    processedImages.set(cacheKey, result);
    await updateImageCache(sourcePath, result, imageCache);
    return result;
  } catch (e) {
    // If preview generation fails, fall back to original
    console.warn(`⚠️  Failed to generate preview for ${filename}: ${e.message}`);
    const result = {
      original: originalUrl,
      preview: originalUrl, // Fall back to original
    };
    processedImages.set(cacheKey, result);
    await updateImageCache(sourcePath, result, imageCache);
    return result;
  }
}

/**
 * Update the persistent image cache with new result
 */
async function updateImageCache(sourcePath, result, imageCache) {
  if (!imageCache) return;
  try {
    const stats = await stat(sourcePath);
    imageCache.set(sourcePath, {
      mtime: stats.mtimeMs,
      size: stats.size,
      result
    });
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Copy a single image file without preview generation (fast copy).
 * Used for deferred image processing mode where HTML is generated first.
 * 
 * @param {string} sourcePath - Absolute path to source image
 * @param {string} outputDir - Absolute path to output directory
 * @param {string} relativeDir - Relative directory path for URL generation
 * @returns {Promise<{original: string, preview: string}|null>} Paths or null if not an image
 */
export async function copyImageFast(sourcePath, outputDir, relativeDir) {
  const ext = extname(sourcePath).toLowerCase();
  const filename = basename(sourcePath);
  
  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });
  
  const originalOutputPath = join(outputDir, filename);
  // Ensure URL is absolute (starts with /)
  let originalUrl = join(relativeDir, filename).replace(/\\/g, '/');
  if (!originalUrl.startsWith('/')) {
    originalUrl = '/' + originalUrl;
  }
  
  // Check if this is an image we handle
  const allImageExtensions = [...COPY_ONLY_EXTENSIONS, ...PROCESSABLE_EXTENSIONS];
  if (!allImageExtensions.includes(ext)) {
    return null;
  }
  
  // Just copy the original (no preview generation)
  await copyFile(sourcePath, originalOutputPath);
  
  return {
    original: originalUrl,
    preview: originalUrl, // Same as original - no preview yet
  };
}

/**
 * Copy all images without processing (fast copy).
 * Used for deferred image processing mode.
 * Uses parallel processing for better performance.
 * 
 * @param {string[]} imageFiles - Array of absolute paths to image files
 * @param {string} sourceDir - Source directory root
 * @param {string} outputDir - Output directory root
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<void>}
 */
export async function copyAllImagesFast(imageFiles, sourceDir, outputDir, progressCallback) {
  // Process in parallel batches (copy is I/O bound, can use larger batches)
  const COPY_BATCH_SIZE = 16;
  
  for (let i = 0; i < imageFiles.length; i += COPY_BATCH_SIZE) {
    const batch = imageFiles.slice(i, i + COPY_BATCH_SIZE);
    
    await Promise.all(batch.map(async (file, batchIndex) => {
      const globalIndex = i + batchIndex;
      const relativePath = file.replace(sourceDir, '');
      const relativeDir = dirname(relativePath);
      const absoluteOutputDir = join(outputDir, relativeDir);
      
      if (progressCallback) {
        progressCallback(globalIndex + 1, imageFiles.length, relativePath);
      }
      
      await copyImageFast(file, absoluteOutputDir, relativeDir);
    }));
  }
}

/**
 * Process images in parallel batches
 * @param {Array} items - Items to process
 * @param {Function} processor - Async function to process each item
 * @param {number} batchSize - Number of items to process in parallel
 */
async function processBatchedParallel(items, processor, batchSize = PARALLEL_BATCH_SIZE) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Build a map of all image paths to their preview/original URLs.
 * This is used to transform img tags in HTML.
 * Uses parallel processing and persistent caching for performance.
 * 
 * @param {string[]} imageFiles - Array of absolute paths to image files
 * @param {string} sourceDir - Source directory root
 * @param {string} outputDir - Output directory root
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<Map<string, {original: string, preview: string}>>} Map of source-relative paths to URLs
 */
export async function processAllImages(imageFiles, sourceDir, outputDir, progressCallback) {
  const imageMap = new Map();
  
  // Load persistent image cache
  const imageCache = await loadImageCache(sourceDir);
  const initialCacheSize = imageCache.size;
  
  // Track statistics
  let processedCount = 0;
  let skippedCount = 0;
  let smallSkippedCount = 0;
  
  // Process in parallel batches
  for (let i = 0; i < imageFiles.length; i += PARALLEL_BATCH_SIZE) {
    const batch = imageFiles.slice(i, i + PARALLEL_BATCH_SIZE);
    
    const batchResults = await Promise.all(batch.map(async (file, batchIndex) => {
      const globalIndex = i + batchIndex;
      const relativePath = file.replace(sourceDir, '');
      const relativeDir = dirname(relativePath);
      const absoluteOutputDir = join(outputDir, relativeDir);
      
      if (progressCallback) {
        progressCallback(globalIndex + 1, imageFiles.length, relativePath);
      }
      
      const result = await processImage(file, absoluteOutputDir, relativeDir, imageCache);
      return { relativePath, result };
    }));
    
    // Collect results
    for (const { relativePath, result } of batchResults) {
      if (result) {
        const lookupPath = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
        imageMap.set(lookupPath, result);
        
        if (result.skipped) {
          skippedCount++;
        } else if (result.preview === result.original) {
          smallSkippedCount++;
        }
        processedCount++;
      }
    }
  }
  
  // Save updated cache
  if (imageCache.size > initialCacheSize) {
    await saveImageCache(sourceDir, imageCache);
  }
  
  // Log cache hit statistics if significant
  if (skippedCount > 0 || smallSkippedCount > 0) {
    console.log(`   📊 Image stats: ${skippedCount} cached, ${smallSkippedCount} small (no preview needed), ${processedCount - skippedCount - smallSkippedCount} processed`);
  }
  
  return imageMap;
}

/**
 * Transform HTML to use preview images and wrap standalone images in anchor tags.
 * - If image is already inside an <a> tag, only update src to preview (if available)
 * - Otherwise, wrap image in <a> tag linking to full-size image (opens in new tab)
 * 
 * @param {string} html - The HTML content
 * @param {Map<string, {original: string, preview: string}>} imageMap - Map of image paths to URLs
 * @param {string} docUrlPath - The URL path of the document (e.g., "/systems/system8/classes/psion.html")
 * @returns {string} Transformed HTML
 */
export function transformImageTags(html, imageMap, docUrlPath = '/') {
  if (!imageMap || imageMap.size === 0) {
    return html;
  }
  
  // Get the directory of the current document for resolving relative paths
  const docDir = docUrlPath.substring(0, docUrlPath.lastIndexOf('/')) || '/';
  
  // Match img tags and extract src, capturing context to detect if inside <a> tag
  return html.replace(
    /<img([^>]*)src=["']([^"']+)["']([^>]*)>/gi,
    (match, before, src, after, offset) => {
      // Check if this img is inside an <a> tag by looking at preceding HTML
      // Find the last unclosed <a> tag before this position
      const precedingHtml = html.substring(Math.max(0, offset - 500), offset);
      const lastAOpen = precedingHtml.lastIndexOf('<a ');
      const lastAClose = precedingHtml.lastIndexOf('</a>');
      const isInsideAnchor = lastAOpen > lastAClose;
      
      // Normalize src path for lookup
      let lookupPath = src;
      // Remove query strings for lookup
      const queryIndex = lookupPath.indexOf('?');
      if (queryIndex !== -1) {
        lookupPath = lookupPath.substring(0, queryIndex);
      }
      
      // Resolve relative paths to absolute paths
      if (!lookupPath.startsWith('/')) {
        // It's a relative path - resolve it against the document's directory
        const parts = docDir.split('/').filter(Boolean);
        const srcParts = lookupPath.split('/');
        
        for (const part of srcParts) {
          if (part === '..') {
            parts.pop();
          } else if (part !== '.') {
            parts.push(part);
          }
        }
        lookupPath = '/' + parts.join('/');
      }
      
      const imageInfo = imageMap.get(lookupPath);
      
      // Determine full-size URL (use original from imageInfo, or fallback to src)
      const fullSizeUrl = imageInfo ? imageInfo.original : src;
      
      // Determine the src to use (preview if available, otherwise original)
      let newSrc = src;
      if (imageInfo && imageInfo.preview !== imageInfo.original) {
        // Preserve any existing query string (like cache busting) on preview
        const querySuffix = queryIndex !== -1 ? src.substring(queryIndex) : '';
        newSrc = imageInfo.preview + querySuffix;
      }
      
      // Build the new img tag
      const imgTag = `<img${before}src="${newSrc}"${after}>`;
      
      // If already inside an anchor tag, just return the updated img tag
      if (isInsideAnchor) {
        return imgTag;
      }
      
      // Wrap in anchor tag linking to full-size image
      return `<a href="${fullSizeUrl}" target="_blank" class="image-link">${imgTag}</a>`;
    }
  );
}

/**
 * Clear the processed images cache
 */
export function clearImageCache() {
  processedImages.clear();
}
