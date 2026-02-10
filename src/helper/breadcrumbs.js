import { toTitleCase } from "./build/titleCase.js";

/**
 * Generate breadcrumb navigation HTML from a document's path.
 *
 * @param {string} dir  - Directory relative to source root, e.g. "settings/eberron/" or "/"
 * @param {string} base - Filename without extension, e.g. "index" or "places"
 * @param {object} [fileMeta] - Parsed frontmatter (used for current-page label override)
 * @returns {string} Breadcrumb HTML string, or empty string if not applicable
 */
export function generateBreadcrumbs(dir, base, fileMeta) {
  const segments = dir.split('/').filter(Boolean);
  const isIndexFile = (base === 'index' || base === 'home');

  // All path segments leading to the current page
  const allSegments = isIndexFile ? segments : [...segments, base];

  // No breadcrumbs for root-level pages (need at least 2 segments for a meaningful trail)
  if (allSegments.length < 2) return '';

  const parts = [];
  let href = '/';

  for (let i = 0; i < allSegments.length; i++) {
    const seg = allSegments[i];
    const isLast = i === allSegments.length - 1;

    // Current page can use frontmatter title; others use title-cased folder name
    const label = isLast && fileMeta?.title
      ? fileMeta.title
      : toTitleCase(seg);

    if (isLast) {
      parts.push(`<span class="breadcrumb-current" aria-current="page">${label}</span>`);
    } else {
      href += seg + '/';
      parts.push(`<a class="breadcrumb-link" href="${href}">${label}</a>`);
    }
  }

  return `<nav class="breadcrumbs" aria-label="Breadcrumbs">${parts.join('<span class="breadcrumb-sep" aria-hidden="true">/</span>')}</nav>\n`;
}
