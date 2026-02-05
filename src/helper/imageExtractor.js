import { dirname, join, resolve, normalize } from 'path';

/**
 * Extract image paths referenced in markdown/HTML content
 * Looks for:
 * - Markdown images: ![alt](path)
 * - HTML img tags: <img src="path">
 * - CSS background-image: url('path') in inline styles
 * - Wikitext images: [[File:path]] or [[Image:path]]
 * 
 * @param {string} content - The markdown/HTML content
 * @param {string} documentPath - Absolute path to the document (for resolving relative paths)
 * @param {string} sourceRoot - Root source directory
 * @returns {string[]} Array of absolute paths to referenced images
 */
export function extractImageReferences(content, documentPath, sourceRoot) {
  const images = new Set();
  const documentDir = dirname(documentPath);
  
  // Image file extensions to recognize
  const imageExtPattern = /\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff?)$/i;
  
  // Markdown images: ![alt](path) or ![alt](path "title")
  const markdownImageRegex = /!\[[^\]]*\]\(([^)\s"']+)[^)]*\)/g;
  let match;
  while ((match = markdownImageRegex.exec(content)) !== null) {
    const imagePath = match[1];
    if (imagePath && imageExtPattern.test(imagePath)) {
      const resolved = resolveImagePath(imagePath, documentDir, sourceRoot);
      if (resolved) images.add(resolved);
    }
  }
  
  // HTML img tags: <img src="path"> or <img src='path'>
  const imgTagRegex = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
  while ((match = imgTagRegex.exec(content)) !== null) {
    const imagePath = match[1];
    if (imagePath && imageExtPattern.test(imagePath)) {
      const resolved = resolveImagePath(imagePath, documentDir, sourceRoot);
      if (resolved) images.add(resolved);
    }
  }
  
  // CSS background-image in inline styles: url('path') or url("path") or url(path)
  const styleUrlRegex = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  while ((match = styleUrlRegex.exec(content)) !== null) {
    const imagePath = match[1];
    if (imagePath && imageExtPattern.test(imagePath)) {
      const resolved = resolveImagePath(imagePath, documentDir, sourceRoot);
      if (resolved) images.add(resolved);
    }
  }
  
  // Wikitext images: [[File:path]] or [[Image:path]]
  const wikitextImageRegex = /\[\[(?:File|Image):([^\]|]+)/gi;
  while ((match = wikitextImageRegex.exec(content)) !== null) {
    const imagePath = match[1];
    if (imagePath && imageExtPattern.test(imagePath)) {
      const resolved = resolveImagePath(imagePath, documentDir, sourceRoot);
      if (resolved) images.add(resolved);
    }
  }
  
  return Array.from(images);
}

/**
 * Resolve an image path to an absolute path within the source root
 * @param {string} imagePath - The image path (relative or absolute)
 * @param {string} documentDir - Directory of the document referencing the image
 * @param {string} sourceRoot - Root source directory
 * @returns {string|null} Absolute path to the image, or null if outside source root
 */
function resolveImagePath(imagePath, documentDir, sourceRoot) {
  // Skip external URLs
  if (imagePath.match(/^(https?:)?\/\/|^data:/i)) {
    return null;
  }
  
  let absolutePath;
  
  if (imagePath.startsWith('/')) {
    // Absolute path from source root
    absolutePath = join(sourceRoot, imagePath);
  } else {
    // Relative path from document directory
    absolutePath = resolve(documentDir, imagePath);
  }
  
  // Normalize the path
  absolutePath = normalize(absolutePath);
  
  // Ensure the path is within the source root
  if (!absolutePath.startsWith(sourceRoot)) {
    return null;
  }
  
  return absolutePath;
}
