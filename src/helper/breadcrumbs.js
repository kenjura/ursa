import { join } from "path";
import { getFolderConfig } from "./folderConfig.js";
import { toDisplayName, getFolderLabel } from "./menuLabels.js";

/**
 * Generate breadcrumb navigation HTML from a document's path.
 *
 * @param {string} dir  - Directory relative to source root, e.g. "settings/eberron/" or "/"
 * @param {string} base - Filename without extension, e.g. "index" or "places"
 * @param {object} [fileMeta] - Parsed frontmatter (used for current-page label override)
 * @param {string|null} [sourceRoot] - Absolute path of the docroot. With it, folder
 *   segments are named the way the menu names them (`menu-label` frontmatter, then
 *   config.json `label`); without it they fall back to the prettified folder name.
 * @returns {string} Breadcrumb HTML string, or empty string if not applicable
 */
export function generateBreadcrumbs(dir, base, fileMeta, sourceRoot = null) {
  const segments = dir.split('/').filter(Boolean);
  const isIndexFile = (base === 'index' || base === 'home');

  // All path segments leading to the current page
  const allSegments = isIndexFile ? segments : [...segments, base];

  // No breadcrumbs for root-level pages (need at least 1 segment beyond root)
  if (allSegments.length < 1) return '';

  const items = [`<li><a href="/">Home</a></li>`];
  let href = '/';

  for (let i = 0; i < allSegments.length; i++) {
    const seg = allSegments[i];
    const isLast = i === allSegments.length - 1;

    // Every segment but the last is a folder, and so is the last one when this
    // is a folder's index page. Those get the menu's label. The last segment of
    // a regular document is the document itself, which keeps its own
    // frontmatter override.
    const isFolderSegment = !isLast || isIndexFile;
    let label;
    if (isLast && !isFolderSegment) {
      label = fileMeta?.['menu-label'] || fileMeta?.title || toDisplayName(seg);
    } else if (sourceRoot) {
      const folderPath = join(sourceRoot, ...allSegments.slice(0, i + 1));
      label = getFolderLabel(folderPath, getFolderConfig(folderPath), seg);
    } else {
      label = toDisplayName(seg);
    }

    href += isFolderSegment ? seg + '/' : seg + '.html';
    const current = isLast ? ' aria-current="page"' : '';
    items.push(`<li><a href="${href}"${current}>${label}</a></li>`);
  }

  // Separators are CSS (li + li::before), so the list reads as a list.
  return `<nav class="ursa-breadcrumbs" aria-label="Breadcrumbs"><ol>${items.join('')}</ol></nav>\n`;
}
