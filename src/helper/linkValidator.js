import { extname, dirname, join, normalize, posix, basename } from "path";

/**
 * Build the canonical-URL map used for link resolution: normalized (lowercased,
 * extensionless or .html) paths → the `.html` output they name.
 *
 * Rules (docs/PATH_LOGIC.md, README "Link logic", docs/SERVE.md §8.3):
 *  - `/foo` names `foo.html` when a document `foo.*` exists — the file wins over
 *    a folder of the same name. With no such document it names the folder's
 *    index, `foo/index.html`.
 *  - `/foo/` and `/foo/index.html` name the folder's index page, which exists
 *    (as a document, a promoted alternate or the auto-index) for every folder
 *    that has documents somewhere beneath it.
 *
 * Which source owns an output is decided elsewhere (`outputOwner`); the map
 * only says which output a URL means.
 *
 * @param {string[]} sourceFiles - Article source paths (absolute, or relative when `source` is "")
 * @param {string} source - Source directory path (prefix stripped from every path)
 * @param {string[]} [directories] - Directory paths in the same form
 * @param {{dirsWithDocuments?: Set<string>}} [opts] - Relative dir paths (no leading slash)
 *   that hold documents; when omitted every directory is assumed to.
 * @returns {Map<string, string>} Map of normalized paths to canonical resolved paths
 */
export function buildValidPaths(sourceFiles, source, directories = [], { dirsWithDocuments = null } = {}) {
  const validPaths = new Map();

  const toRelative = (path) => {
    let rel = source ? path.replace(source, "") : path;
    if (!rel.startsWith("/")) rel = "/" + rel;
    try {
      rel = decodeURIComponent(rel);
    } catch (e) {
      // Ignore decode errors
    }
    return rel;
  };

  // Documents: the direct mapping is authoritative
  for (const file of sourceFiles) {
    const ext = extname(file);
    const relativePath = toRelative(file.slice(0, file.length - ext.length));
    const resolvedPath = relativePath + ".html";
    validPaths.set(relativePath.toLowerCase(), resolvedPath);
    validPaths.set(resolvedPath.toLowerCase(), resolvedPath);
  }

  // Folders
  for (const dir of directories) {
    let relativePath = toRelative(dir);
    if (relativePath.endsWith("/")) relativePath = relativePath.slice(0, -1);
    if (relativePath === "") continue; // the root is handled below
    const key = relativePath.toLowerCase();
    const hasDocs = !dirsWithDocuments || dirsWithDocuments.has(relativePath.replace(/^\//, ""));
    if (hasDocs) {
      const indexPath = relativePath + "/index.html";
      // `/foo` → the folder index, unless a document foo.* already claimed it
      if (!validPaths.has(key)) validPaths.set(key, indexPath);
      validPaths.set(key + "/", indexPath);
      validPaths.set(indexPath.toLowerCase(), indexPath);
    }
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
export function normalizeHref(href, currentDocPath = null) {
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
  const lookup = toLookup(validPaths);
  
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
  
  const canonicalPath = lookup(normalized);
  if (canonicalPath) {
    debugTries.push(`${normalized} → ${canonicalPath} ✓`);
    return { resolvedHref: canonicalPath + hash, inactive: false, debug: debugTries.join(' | ') };
  }

  // A .md/.mdx link to a document that does not exist (yet) is still
  // converted to .html optimistically: the target may be created later.
  const ext = extname(hrefWithoutHash);
  if (ext && (ext.toLowerCase() === '.md' || ext.toLowerCase() === '.mdx')) {
    const resolvedHtmlPath = absoluteHref.replace(/\.(md|mdx)$/i, '.html');
    debugTries.push(`${normalized} (${ext} → .html optimistic) → ${resolvedHtmlPath}`);
    return { resolvedHref: resolvedHtmlPath + hash, inactive: false, debug: debugTries.join(' | ') };
  }

  // Nothing owns it - mark as inactive, keep absolute href
  debugTries.push(`${normalized} → ✗`);
  return { resolvedHref: absoluteHref + hash, inactive: true, debug: debugTries.join(' | ') };
}

/**
 * Resolve one normalized href (lowercased, absolute, no hash or query — see
 * `normalizeHref`) to the canonical `.html` output it names, or null.
 *
 * This is the whole of link resolution's dependence on the site's path set,
 * isolated so the build graph can hold one `linkResolution` node per distinct
 * href: adding a document then rewrites only the pages whose links resolve
 * differently, not every page.
 *
 * @param {string} normalized
 * @param {Map<string, string>} validPaths
 * @returns {string|null}
 */
export function resolveNormalizedHref(normalized, validPaths) {
  if (validPaths.has(normalized)) return validPaths.get(normalized);

  const ext = extname(normalized);
  if (ext) {
    if (ext === '.md' || ext === '.mdx') {
      const pathWithoutExt = normalized.slice(0, -ext.length);
      const htmlPath = pathWithoutExt + '.html';
      if (validPaths.has(htmlPath)) return validPaths.get(htmlPath);
      if (validPaths.has(pathWithoutExt)) return validPaths.get(pathWithoutExt);
    }
    return null;
  }

  // No extension - try .html first, then /index.html
  const htmlPath = normalized + '.html';
  if (validPaths.has(htmlPath)) return validPaths.get(htmlPath);
  const indexPath = normalized.endsWith('/') ? normalized + 'index.html' : normalized + '/index.html';
  if (validPaths.has(indexPath)) return validPaths.get(indexPath);
  return null;
}

/** Accept either a validPaths Map or a `(normalized) => canonical|null` function. */
function toLookup(validPathsOrResolver) {
  if (typeof validPathsOrResolver === 'function') return validPathsOrResolver;
  return (normalized) => resolveNormalizedHref(normalized, validPathsOrResolver);
}

/**
 * Every internal link target in the HTML, normalized the way resolution sees
 * it. Lets a page ask the build graph for each target before rewriting.
 * @param {string} html
 * @param {string} currentDocPath - The current document's URL path
 * @returns {string[]} Distinct normalized hrefs
 */
export function collectInternalHrefs(html, currentDocPath = '/') {
  const out = new Set();
  const re = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!isInternalLink(href)) continue;
    out.add(normalizeHref(href.split('#')[0], currentDocPath));
  }
  return [...out];
}

/**
 * Process HTML to resolve internal links and add class="inactive" to broken links.
 * This both:
 * 1. Resolves relative links to absolute paths
 * 2. Resolves extensionless links to .html (e.g., /foo/bar -> /foo/bar.html)
 * 3. Marks broken links with the "inactive" class
 * 
 * @param {string} html - The HTML content
 * @param {Map<string, string>|((normalized: string) => string|null)} validPaths - Map of
 *   normalized paths to canonical resolved paths, or a resolver over normalized hrefs
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
