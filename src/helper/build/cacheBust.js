// Cache busting helpers for build

/**
 * Generate a cache-busting timestamp in ISO format (e.g., 20251221T221700Z)
 * @returns {string} Timestamp string suitable for query params
 */
export function generateCacheBustTimestamp() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Add cache-busting timestamp to url() references in CSS content
 * @param {string} cssContent - The CSS file content
 * @param {string} timestamp - The cache-busting timestamp
 * @returns {string} CSS with timestamped URLs
 */
export function addTimestampToCssUrls(cssContent, timestamp) {
  // Match url(...) in any context, including CSS variables, with optional whitespace and quotes
  // Exclude data: URLs and already-timestamped URLs
  return cssContent.replace(
    /url\(\s*(['"]?)(?!data:)([^'"\)]+?)\1\s*\)/gi,
    (match, quote, url) => {
      // Don't add timestamp if already has query string
      if (url.includes('?')) {
        return match;
      }
      return `url(${quote}${url}?v=${timestamp}${quote})`;
    }
  );
}

/**
 * Add cache-busting timestamp to static file references in HTML
 * @param {string} html - The HTML content
 * @param {string} timestamp - The cache-busting timestamp
 * @returns {string} HTML with timestamped static file references
 */
export function addTimestampToHtmlStaticRefs(html, timestamp) {
  // Add timestamp to CSS links
  html = html.replace(
    /(<link[^>]+href=["'])([^"']+\.css)(["'][^>]*>)/gi,
    `$1$2?v=${timestamp}$3`
  );
  // Add timestamp to JS scripts
  html = html.replace(
    /(<script[^>]+src=["'])([^"']+\.js)(["'][^>]*>)/gi,
    `$1$2?v=${timestamp}$3`
  );
  // Add timestamp to images in img tags
  html = html.replace(
    /(<img[^>]+src=["'])([^"']+\.(jpg|jpeg|png|gif|webp|svg|ico))(["'][^>]*>)/gi,
    `$1$2?v=${timestamp}$4`
  );
  return html;
}

/**
 * Generate a short content-based hash for a file's contents.
 * Used for per-file cache-busting so that only changed files invalidate caches.
 * @param {string} content - File content to hash
 * @returns {string} Short hex hash (8 chars)
 */
export function generateFileHash(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0").substring(0, 8);
}

/**
 * A cache-bust hash map that stores per-file content hashes.
 * When a static file changes, its hash changes, which invalidates
 * any document referencing it via ?v= query parameters.
 */
export class CacheBustHashMap {
  constructor() {
    /** @type {Map<string, string>} relative file path → content hash */
    this.hashes = new Map();
    /** @type {string} fallback timestamp for files not individually tracked */
    this.fallbackTimestamp = generateCacheBustTimestamp();
  }

  /**
   * Update the hash for a file.
   * @param {string} relativePath - File path relative to output dir (e.g., "campaigns/abs/style.css")
   * @param {string} content - File content
   * @returns {string} The new hash
   */
  update(relativePath, content) {
    const hash = generateFileHash(content);
    this.hashes.set(relativePath, hash);
    return hash;
  }

  /**
   * Get the cache-bust version string for a file.
   * Returns the per-file hash if available, otherwise the fallback timestamp.
   * @param {string} relativePath - File path relative to output dir
   * @returns {string} Version string
   */
  getVersion(relativePath) {
    return this.hashes.get(relativePath) || this.fallbackTimestamp;
  }

  /**
   * Check if a file's hash has changed.
   * @param {string} relativePath
   * @param {string} content
   * @returns {boolean} true if the hash differs from the stored value
   */
  hasChanged(relativePath, content) {
    const newHash = generateFileHash(content);
    const oldHash = this.hashes.get(relativePath);
    return newHash !== oldHash;
  }

  /**
   * Refresh the fallback timestamp (e.g., at the start of a new build).
   */
  refreshTimestamp() {
    this.fallbackTimestamp = generateCacheBustTimestamp();
  }

  /**
   * Get the fallback timestamp (for backward compatibility).
   * @returns {string}
   */
  get timestamp() {
    return this.fallbackTimestamp;
  }
}
