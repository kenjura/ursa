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
