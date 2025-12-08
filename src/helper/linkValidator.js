import { extname, dirname, join, normalize, posix } from "path";

/**
 * Build a set of valid internal paths from the list of source files
 * @param {string[]} sourceFiles - Array of source file paths
 * @param {string} source - Source directory path
 * @returns {Set<string>} Set of valid internal paths (without extension, lowercased)
 */
export function buildValidPaths(sourceFiles, source) {
  const validPaths = new Set();
  
  for (const file of sourceFiles) {
    // Get the path relative to source, without extension
    const ext = extname(file);
    let relativePath = file.replace(source, "").replace(ext, "");
    
    // Normalize: ensure leading slash, lowercase for comparison
    if (!relativePath.startsWith("/")) {
      relativePath = "/" + relativePath;
    }
    
    // Add both with and without trailing slash for directories
    validPaths.add(relativePath.toLowerCase());
    validPaths.add((relativePath + ".html").toLowerCase());
    
    // Also add /index.html variant for directory indexes
    if (relativePath.endsWith("/index")) {
      const dirPath = relativePath.replace(/\/index$/, "");
      validPaths.add(dirPath.toLowerCase());
      validPaths.add((dirPath + "/").toLowerCase());
      validPaths.add((dirPath + "/index.html").toLowerCase());
    }
  }
  
  // Add root
  validPaths.add("/");
  validPaths.add("/index.html");
  
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
 * - resolvedHref is the corrected href (with .html extension if needed)
 * - inactive is true if the link doesn't resolve to a valid path
 * - debug contains information about what was tried
 * 
 * @param {string} href - The original href
 * @param {Set<string>} validPaths - Set of valid internal paths (lowercased)
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
  
  // If exact match exists, return resolved absolute path
  if (validPaths.has(normalized)) {
    debugTries.push(`${normalized} → ✓ (exact)`);
    return { resolvedHref: absoluteHref + hash, inactive: false, debug: debugTries.join(' | ') };
  }
  
  // Check if the href already has an extension
  const ext = extname(hrefWithoutHash);
  if (ext) {
    // Has extension but doesn't exist
    debugTries.push(`${normalized} → ✗`);
    return { resolvedHref: absoluteHref + hash, inactive: true, debug: debugTries.join(' | ') };
  }
  
  // No extension - try .html first
  const htmlPath = normalized + '.html';
  debugTries.push(`${htmlPath} → ${validPaths.has(htmlPath) ? '✓' : '✗'}`);
  if (validPaths.has(htmlPath)) {
    // Construct the resolved href as absolute path with .html
    const resolvedHref = absoluteHref + '.html' + hash;
    return { resolvedHref, inactive: false, debug: debugTries.join(' | ') };
  }
  
  // Try /index.html
  const indexPath = normalized.endsWith('/') 
    ? normalized + 'index.html' 
    : normalized + '/index.html';
  debugTries.push(`${indexPath} → ${validPaths.has(indexPath) ? '✓' : '✗'}`);
  if (validPaths.has(indexPath)) {
    // Construct the resolved href as absolute path with /index.html
    const resolvedHref = (absoluteHref.endsWith('/') 
      ? absoluteHref + 'index.html' 
      : absoluteHref + '/index.html') + hash;
    return { resolvedHref, inactive: false, debug: debugTries.join(' | ') };
  }
  
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
 * @param {Set<string>} validPaths - Set of valid internal paths
 * @param {string} currentDocPath - The current document's URL path (e.g., "/character/index.html")
 * @param {boolean} includeDebug - Whether to include debug info in link text
 * @returns {string} Processed HTML with resolved links and inactive class on broken links
 */
export function markInactiveLinks(html, validPaths, currentDocPath = '/', includeDebug = false) {
  // Match anchor tags with href attribute
  // This regex captures: everything before href, the href value, everything after, and the link text
  return html.replace(/<a\s+([^>]*?)href=["']([^"']+)["']([^>]*)>([^<]*)<\/a>/gi, (match, before, href, after, text) => {
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
    
    // Add debug text if requested
    const debugText = includeDebug ? ` [DEBUG: ${debug}]` : '';
    
    return `<a ${newBefore}href="${resolvedHref}"${newAfter}>${text}${debugText}</a>`;
  });
}
