import { extname } from "path";

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
 * Normalize an href for comparison against valid paths
 * @param {string} href - The href to normalize
 * @returns {string} Normalized path
 */
function normalizeHref(href) {
  // Remove hash fragments
  let normalized = href.split("#")[0];
  
  // Remove query strings
  normalized = normalized.split("?")[0];
  
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
 * Process HTML to add class="inactive" to broken internal links
 * @param {string} html - The HTML content
 * @param {Set<string>} validPaths - Set of valid internal paths
 * @returns {string} Processed HTML with inactive class on broken links
 */
export function markInactiveLinks(html, validPaths) {
  // Match anchor tags with href attribute
  // Handles: <a href="..."> and <a class="existing" href="..."> etc.
  return html.replace(/<a\s+([^>]*href=["']([^"']+)["'][^>]*)>/gi, (match, attrs, href) => {
    // Skip external links
    if (!isInternalLink(href)) {
      return match;
    }
    
    // Normalize and check if path exists
    const normalizedHref = normalizeHref(href);
    
    if (!validPaths.has(normalizedHref)) {
      // Link is broken - add inactive class
      if (attrs.includes('class="') || attrs.includes("class='")) {
        // Append to existing class
        return match.replace(/class=["']([^"']*)["']/, 'class="$1 inactive"');
      } else {
        // Add new class attribute
        return `<a class="inactive" ${attrs}>`;
      }
    }
    
    return match;
  });
}
