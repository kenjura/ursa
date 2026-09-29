/**
 * Selectors, custom properties and class names Ursa stopped emitting in
 * 0.101.0 (semantic markup and CSS v2). A site stylesheet or script that still
 * uses them silently stops matching, so the build warns — it never rewrites.
 *
 * The patterns are the leftover check in docs/changes/semantic-css/MIGRATION.md.
 * Remove this module (and its callers) a few releases after 0.101.0.
 */

const LEGACY_IDS = /#(main-content|nav-global|nav-main-top|nav-main|site-footer|global-search|widget-dropdown(?:-left)?|widget-content(?:-[a-z-]+)?|search-results|toc|menu-config|global-nav|ursa-update-indicator)\b/g;

const LEGACY_CLASSES = /\.(sectionOuter\d?|section[12]|sidebarSection|tableContainer|wikiImage(?:_caption)?|wiki-image(?:-container)?|wikiLink|indent[12]|frontmatter-table|auto-index|image-link|inactive|stuck|breadcrumbs?|breadcrumb-(?:link|sep|current)|menu-(?:column[a-z-]*|button|scroll[a-z-]*|item[a-z-]*|label|level|loading|icon|more)|mobile-menu[a-z0-9-]*|top-menu[a-z-]*|dropdown-(?:item|label)|flyout-indicator|widget-[a-z-]+|search-(?:wrapper[a-z-]*|result[a-z-]*|section[a-z-]*|show-more|clear[a-z-]*)|recent-activity[a-z-]*|suggested-[a-z-]+|footer-(?:content|meta|copyright)|nav-(?:left|right)-controls|nav-center|has-(?:children|dropdown|flyout)|current-page|is-index|ursa-menu-[a-z-]+|ursa-image-(?:controls|btn)|ursa-lightbox-(?:btn|backdrop|close|download|open))\b/g;

const LEGACY_PROPERTIES = /--(bg-color|text-color|nav-top-bg|widget-bg|widget-border|link-color|article-width|global-nav-height)\b/g;

/** Class attribute values in raw HTML, for the document scan. */
const LEGACY_HTML_CLASSES = /\bclass=["'][^"']*\b(sectionOuter\d?|section[12]|sidebarSection|tableContainer|wikiImage|wiki-image|wikiLink|indent[12]|frontmatter-table|auto-index|image-link)\b/g;

/**
 * Old names used in a stylesheet or script.
 * @param {string} text - CSS or JS source
 * @returns {string[]} Distinct old names as written (`#main-content`, `.sectionOuter`, `--bg-color`), in first-seen order
 */
export function findLegacySelectors(text) {
  const found = new Set();
  const src = String(text ?? "");
  for (const re of [LEGACY_IDS, LEGACY_CLASSES, LEGACY_PROPERTIES]) {
    for (const m of src.matchAll(re)) found.add(m[0]);
  }
  return [...found];
}

/**
 * Whether a document's source uses Ursa's old class names in its raw HTML.
 * @param {string} source - Document source (Markdown, wikitext, MDX)
 * @returns {boolean}
 */
export function hasLegacyHtml(source) {
  LEGACY_HTML_CLASSES.lastIndex = 0;
  return LEGACY_HTML_CLASSES.test(String(source ?? ""));
}

/**
 * The warning for one site file.
 * @param {string} relPath - The file, relative to the docroot
 * @param {string[]} names - From findLegacySelectors
 * @returns {string}
 */
export function legacySelectorWarning(relPath, names) {
  const shown = names.slice(0, 5).map((n) => `\`${n}\``).join(", ");
  const more = names.length > 5 ? `, … (${names.length} in all)` : "";
  return `⚠️  ${relPath} uses selectors removed in 0.101.0 (${shown}${more}) — see docs/changes/semantic-css/MIGRATION.md`;
}
