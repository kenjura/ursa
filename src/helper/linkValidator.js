import { extname, dirname, join, normalize, posix, basename } from "path";

/**
 * Build a set of valid internal paths from the list of source files and directories.
 * Returns a Map where keys are normalized paths (with/without extension) and values
 * are the canonical resolved paths (always with .html extension).
 * @param {string[]} sourceFiles - Array of source file paths
 * @param {string} source - Source directory path
 * @param {string[]} [directories] - Optional array of directory paths (for auto-index support)
 * @returns {Map<string, string>} Map of normalized paths to canonical resolved paths
 */
export function buildValidPaths(sourceFiles, source, directories = []) {
  const validPaths = new Map();
  
  for (const file of sourceFiles) {
    // Get the path relative to source, without extension
    const ext = extname(file);
    let relativePath = file.replace(source, "").replace(ext, "");
    
    // Normalize: ensure leading slash, lowercase for comparison
    if (!relativePath.startsWith("/")) {
      relativePath = "/" + relativePath;
    }
    
    // Decode URI components for paths with special characters (spaces, etc.)
    try {
      relativePath = decodeURIComponent(relativePath);
    } catch (e) {
      // Ignore decode errors
    }
    
    // The canonical resolved path (always .html)
    const resolvedPath = relativePath + ".html";
    
    // Add mappings: extensionless and with .html both resolve to the .html version
    validPaths.set(relativePath.toLowerCase(), resolvedPath);
    validPaths.set(resolvedPath.toLowerCase(), resolvedPath);
    
    // Also add /index.html variant for directory indexes
    if (relativePath.endsWith("/index")) {
      const dirPath = relativePath.replace(/\/index$/, "");
      const dirResolvedPath = dirPath + "/index.html";
      validPaths.set(dirPath.toLowerCase(), dirResolvedPath);
      validPaths.set((dirPath + "/").toLowerCase(), dirResolvedPath);
      validPaths.set(dirResolvedPath.toLowerCase(), dirResolvedPath);
    }
    
    // Handle (foldername).md files - they get promoted to index.html by auto-index
    // e.g., /foo/bar/bar.md becomes /foo/bar/index.html (bar.html promoted to index.html)
    const fileName = basename(relativePath); // e.g., "bar" from "/foo/bar/bar"
    const parentDir = dirname(relativePath); // e.g., "/foo/bar" from "/foo/bar/bar"
    const parentDirName = basename(parentDir); // e.g., "bar" from "/foo/bar"
    
    if (fileName === parentDirName) {
      // This file has same name as its parent folder - it will be promoted to index.html
      const promotedPath = parentDir + "/index.html";
      validPaths.set(parentDir.toLowerCase(), promotedPath);
      validPaths.set((parentDir + "/").toLowerCase(), promotedPath);
      validPaths.set(promotedPath.toLowerCase(), promotedPath);
    }
  }
  
  // Add all directories as valid paths (they get auto-generated index.html)
  for (const dir of directories) {
    let relativePath = dir.replace(source, "");
    
    // Normalize: ensure leading slash
    if (!relativePath.startsWith("/")) {
      relativePath = "/" + relativePath;
    }
    
    // Remove trailing slash for consistency
    if (relativePath.endsWith("/")) {
      relativePath = relativePath.slice(0, -1);
    }
    
    // Decode URI components
    try {
      relativePath = decodeURIComponent(relativePath);
    } catch (e) {
      // Ignore decode errors
    }
    
    // All folders resolve to /folder/index.html
    const resolvedPath = relativePath + "/index.html";
    validPaths.set(relativePath.toLowerCase(), resolvedPath);
    validPaths.set((relativePath + "/").toLowerCase(), resolvedPath);
    validPaths.set(resolvedPath.toLowerCase(), resolvedPath);
  }
  
  // Add root
  validPaths.set("/", "/index.html");
  validPaths.set("/index.html", "/index.html");
  
  return validPaths;
}

/**
 * Check if a link is an internal link (not external)
 * @param {string} href - The href value
 * @returns {boolean}
 */
function isInternalLink(href) {
  if (!href) return false;
  
  // External links start with http://, https://, //, mailto:, tel:, etc.
  if (href.match(/^(https?:)?\/\/|^mailto:|^tel:|^javascript:|^#/i)) {
    return false;
  }
  
  // Data URLs
  if (href.startsWith("data:")) {
    return false;
  }
  
  return true;
}

/**
 * Check if a link is relative (starts with ./ or ../ or doesn't start with /)
 * @param {string} href - The href value
 * @returns {boolean}
 */
function isRelativeLink(href) {
  if (!href) return false;
  return href.startsWith('./') || href.startsWith('../') || !href.startsWith('/');
}

/**
 * Resolve a relative href to an absolute path based on the current document's path
 * @param {string} href - The relative href
 * @param {string} currentDocPath - The current document's URL path (e.g., "/character/index.html")
 * @returns {string} Absolute path
 */
function resolveRelativePath(href, currentDocPath) {
  // Get the directory of the current document
  const currentDir = posix.dirname(currentDocPath);
  
  // Join and normalize
  const resolved = posix.normalize(posix.join(currentDir, href));
  
  return resolved;
}

/**
 * Normalize an href for comparison against valid paths
 * @param {string} href - The href to normalize
 * @param {string} currentDocPath - The current document's URL path (for relative link resolution)
 * @returns {string} Normalized path
 */
function normalizeHref(href, currentDocPath = null) {
  // Remove hash fragments
  let normalized = href.split("#")[0];
  
  // Remove query strings
  normalized = normalized.split("?")[0];
  
  // Resolve relative links if we have the current doc path
  if (currentDocPath && isRelativeLink(normalized)) {
    normalized = resolveRelativePath(normalized, currentDocPath);
  }
  
  // Ensure leading slash for absolute paths
  if (!normalized.startsWith("/")) {
    normalized = "/" + normalized;
  }
  
  // Decode URI components
  try {
    normalized = decodeURIComponent(normalized);
  } catch (e) {
    // Ignore decode errors
  }
  
  return normalized.toLowerCase();
}

/**
 * Resolve an href to a valid path, trying .html and /index.html extensions.
 * Returns { resolvedHref, inactive, debug } where:
 * - resolvedHref is the corrected href (with .html extension)
 * - inactive is true if the link doesn't resolve to a valid path
 * - debug contains information about what was tried
 * 
 * @param {string} href - The original href
 * @param {Map<string, string>} validPaths - Map of normalized paths to canonical resolved paths
 * @param {string} currentDocPath - The current document's URL path (for relative link resolution)
 * @returns {{ resolvedHref: string, inactive: boolean, debug: string }}
 */
function resolveHref(href, validPaths, currentDocPath = null) {
  const debugTries = [];
  
  // Get hash fragment if present (to preserve it)
  const hashIndex = href.indexOf('#');
  const hash = hashIndex >= 0 ? href.substring(hashIndex) : '';
  const hrefWithoutHash = hashIndex >= 0 ? href.substring(0, hashIndex) : href;
  
  // Normalize for checking (resolve relative paths if currentDocPath provided)
  const normalized = normalizeHref(hrefWithoutHash, currentDocPath);
  
  // Calculate the resolved absolute href (for updating the link)
  const isRelative = isRelativeLink(hrefWithoutHash);
  const absoluteHref = isRelative && currentDocPath 
    ? resolveRelativePath(hrefWithoutHash, currentDocPath)
    : hrefWithoutHash;
  
  // Check if path exists in validPaths map - the value is the canonical resolved path
  if (validPaths.has(normalized)) {
    const canonicalPath = validPaths.get(normalized);
    debugTries.push(`${normalized} → ${canonicalPath} ✓`);
    return { resolvedHref: canonicalPath + hash, inactive: false, debug: debugTries.join(' | ') };
  }
  
  // Check if the href already has an extension
  const ext = extname(hrefWithoutHash);
  if (ext) {
    // Special handling for .md/.mdx links - always convert to .html
    // This ensures links work even if the target file is created after serve starts
    if (ext.toLowerCase() === '.md' || ext.toLowerCase() === '.mdx') {
      // Remove source extension and convert to .html
      const pathWithoutExt = normalized.slice(0, -ext.length);
      const htmlPath = pathWithoutExt + '.html';
      
      // Check if .html version exists in validPaths for canonical path
      if (validPaths.has(htmlPath.toLowerCase())) {
        const canonicalPath = validPaths.get(htmlPath.toLowerCase());
        debugTries.push(`${normalized} (${ext} → .html) → ${canonicalPath} ✓`);
        return { resolvedHref: canonicalPath + hash, inactive: false, debug: debugTries.join(' | ') };
      }
      // Also check without extension
      if (validPaths.has(pathWithoutExt.toLowerCase())) {
        const canonicalPath = validPaths.get(pathWithoutExt.toLowerCase());
        debugTries.push(`${normalized} (${ext} → resolved) → ${canonicalPath} ✓`);
        return { resolvedHref: canonicalPath + hash, inactive: false, debug: debugTries.join(' | ') };
      }
      // File doesn't exist yet, but still convert to .html optimistically
      // (the target file may be created later during serve)
      const resolvedHtmlPath = absoluteHref.replace(/\.(md|mdx)$/i, '.html');
      debugTries.push(`${normalized} (${ext} → .html optimistic) → ${resolvedHtmlPath}`);
      return { resolvedHref: resolvedHtmlPath + hash, inactive: false, debug: debugTries.join(' | ') };
    }
    // Has extension but doesn't exist (or is not .md)
    debugTries.push(`${normalized} → ✗`);
    return { resolvedHref: absoluteHref + hash, inactive: true, debug: debugTries.join(' | ') };
  }
  
  // No extension - try .html first
  const htmlPath = normalized + '.html';
  if (validPaths.has(htmlPath.toLowerCase())) {
    const canonicalPath = validPaths.get(htmlPath.toLowerCase());
    debugTries.push(`${htmlPath} → ${canonicalPath} ✓`);
    return { resolvedHref: canonicalPath + hash, inactive: false, debug: debugTries.join(' | ') };
  }
  debugTries.push(`${htmlPath} → ✗`);
  
  // Try /index.html
  const indexPath = normalized.endsWith('/') 
    ? normalized + 'index.html' 
    : normalized + '/index.html';
  if (validPaths.has(indexPath.toLowerCase())) {
    const canonicalPath = validPaths.get(indexPath.toLowerCase());
    debugTries.push(`${indexPath} → ${canonicalPath} ✓`);
    return { resolvedHref: canonicalPath + hash, inactive: false, debug: debugTries.join(' | ') };
  }
  debugTries.push(`${indexPath} → ✗`);
  
  // Neither exists - mark as inactive, keep absolute href
  return { resolvedHref: absoluteHref + hash, inactive: true, debug: debugTries.join(' | ') };
}

/**
 * Process HTML to resolve internal links and add class="inactive" to broken links.
 * This both:
 * 1. Resolves relative links to absolute paths
 * 2. Resolves extensionless links to .html (e.g., /foo/bar -> /foo/bar.html)
 * 3. Marks broken links with the "inactive" class
 * 
 * @param {string} html - The HTML content
 * @param {Map<string, string>} validPaths - Map of normalized paths to canonical resolved paths
 * @param {string} currentDocPath - The current document's URL path (e.g., "/character/index.html")
 * @param {boolean} includeDebug - Whether to include debug info in link text
 * @returns {string} Processed HTML with resolved links and inactive class on broken links
 */
export function markInactiveLinks(html, validPaths, currentDocPath = '/', includeDebug = false) {
  // Match anchor tags with href attribute
  // This regex captures: everything before href, the href value, everything after href, and the link content (including nested HTML)
  // Using [\s\S]*? for content to match anything including newlines, non-greedy
  return html.replace(/<a\s+([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi, (match, before, href, after, content) => {
    // Skip external links
    if (!isInternalLink(href)) {
      return match;
    }
    
    // Resolve the href (passing current doc path for relative link resolution)
    const { resolvedHref, inactive, debug } = resolveHref(href, validPaths, currentDocPath);
    
    // Build the class attribute
    let newBefore = before;
    let newAfter = after;
    
    if (inactive) {
      // Check if class already exists in before or after
      const classInBefore = before.match(/class=["']([^"']*)["']/i);
      const classInAfter = after.match(/class=["']([^"']*)["']/i);
      
      if (classInBefore) {
        const existingClass = classInBefore[1];
        if (!existingClass.includes('inactive')) {
          newBefore = before.replace(classInBefore[0], `class="${existingClass} inactive"`);
        }
      } else if (classInAfter) {
        const existingClass = classInAfter[1];
        if (!existingClass.includes('inactive')) {
          newAfter = after.replace(classInAfter[0], `class="${existingClass} inactive"`);
        }
      } else {
        // Add class attribute
        newBefore = `class="inactive" ${before}`;
      }
    }
    
    // Add debug text if requested (only for plain text content)
    const debugText = includeDebug && !content.includes('<') ? ` [DEBUG: ${debug}]` : '';
    
    return `<a ${newBefore}href="${resolvedHref}"${newAfter}>${content}${debugText}</a>`;
  });
}

/**
 * Resolve relative URLs in raw HTML elements (img src, video src, audio src, source src, etc.)
 * and in inline style url() references (background-image, etc.)
 * This ensures that relative paths in raw HTML embedded in markdown are resolved correctly
 * relative to the document's location.
 * 
 * @param {string} html - The HTML content
 * @param {string} currentDocPath - The current document's URL path (e.g., "/foo/index.html")
 * @returns {string} Processed HTML with resolved relative URLs
 */
export function resolveRelativeUrls(html, currentDocPath = '/') {
  // Attributes that can contain relative URLs
  const urlAttributes = ['src', 'poster', 'data'];
  
  // Process each URL attribute
  for (const attr of urlAttributes) {
    // Match tags with the attribute (case-insensitive)
    const regex = new RegExp(`(<(?:img|video|audio|source|object|embed|iframe)[^>]*?)${attr}=["']([^"']+)["']([^>]*>)`, 'gi');
    
    html = html.replace(regex, (match, before, url, after) => {
      // Skip external URLs, data URLs, and absolute paths
      if (url.match(/^(https?:)?\/\/|^data:|^mailto:|^tel:|^javascript:/i)) {
        return match;
      }
      
      // Skip already-absolute paths (starting with /)
      if (url.startsWith('/')) {
        return match;
      }
      
      // It's a relative path - resolve it against the document's directory
      const resolvedUrl = resolveRelativePath(url, currentDocPath);
      
      return `${before}${attr}="${resolvedUrl}"${after}`;
    });
  }
  
  // Process url() in inline style attributes (for background-image, etc.)
  // Handle double-quoted style attributes (content can contain single quotes)
  html = html.replace(/style="([^"]*)"/gi, (match, styleContent) => {
    const processedStyle = processStyleUrls(styleContent, currentDocPath);
    return `style="${processedStyle}"`;
  });
  
  // Handle single-quoted style attributes (content can contain double quotes)
  html = html.replace(/style='([^']*)'/gi, (match, styleContent) => {
    const processedStyle = processStyleUrls(styleContent, currentDocPath);
    return `style='${processedStyle}'`;
  });
  
  return html;
}

/**
 * Process url() values in a style string, resolving relative paths
 * @param {string} styleContent - The content of a style attribute
 * @param {string} currentDocPath - The current document's URL path
 * @returns {string} Style content with resolved URLs
 */
function processStyleUrls(styleContent, currentDocPath) {
  return styleContent.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (urlMatch, quote, url) => {
    // Skip external URLs, data URLs, and absolute paths
    if (url.match(/^(https?:)?\/\/|^data:/i)) {
      return urlMatch;
    }
    
    // Skip already-absolute paths (starting with /)
    if (url.startsWith('/')) {
      return urlMatch;
    }
    
    // It's a relative path - resolve it against the document's directory
    const resolvedUrl = resolveRelativePath(url, currentDocPath);
    
    // Preserve the original quote style, or use single quotes if none
    const outputQuote = quote || "'";
    return `url(${outputQuote}${resolvedUrl}${outputQuote})`;
  });
}
