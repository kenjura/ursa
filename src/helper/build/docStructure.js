/**
 * The document box's server-side structure (SPEC §2–3): a title section when
 * the document doesn't open with one, and the document header/footer that
 * hold Ursa's furniture around the author's sections.
 */
import { slugify } from "../slug.cjs";
import { stripHtml } from "../stripHtml.js";

/**
 * A document body that starts with an h1 section. When the body has content
 * before its first h1 section (or no h1 at all), that content is wrapped in a
 * new level-1 section headed by `title`; level-2 sections in it nest as they
 * would under a written h1.
 * @param {string} body - Rendered document body
 * @param {string} title - Title for the injected heading
 * @returns {string}
 */
export function ensureTitleSection(body, title) {
  const open = '<section class="ursa-section" data-level="1">';
  const trimmed = body.trimStart();
  if (trimmed.startsWith(open) || trimmed.startsWith("<h1")) return body;
  let firstH1 = body.indexOf(open);
  if (firstH1 < 0) firstH1 = body.length;
  let id = slugify(stripHtml(String(title)));
  for (let n = 2; body.includes(`id="${id}"`); n++) id = `${slugify(stripHtml(String(title)))}-${n}`;
  return `${open}\n<h1 id="${id}">${title}</h1>\n${body.slice(0, firstH1)}</section>\n${body.slice(firstH1)}`;
}

/**
 * A document for the page: the document header (breadcrumbs, menus above the
 * first heading) and footer (bottom-injected menus) around its sections.
 * Each is left out when empty.
 */
export function docWithFurniture({ header = "", body, footer = "" }) {
  const head = header.trim() ? `<header class="ursa-doc-header">\n${header.trim()}\n</header>\n` : "";
  const foot = footer.trim() ? `\n<footer class="ursa-doc-footer">\n${footer.trim()}\n</footer>` : "";
  return head + body + foot;
}
