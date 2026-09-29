/**
 * Heading slugs, shared by every renderer (Markdown, wikitext, MDX) so a
 * heading gets the same id whichever format its document is written in, and
 * so ids exist in the server HTML (and the JSON's bodyHtml) rather than being
 * assigned by a client script.
 *
 * CommonJS so the Markdown worker (parseWorker.cjs → markdownHelper.cjs) can
 * require it; ES modules import it as usual.
 */

/**
 * Slug for one heading's text: lowercase, letters and digits kept (any
 * script), everything else collapsed to single hyphens.
 * @param {string} text - Heading text (tags already stripped)
 * @returns {string}
 */
function slugify(text) {
  const slug = String(text ?? "")
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/g, " ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/**
 * A slugger for one document: repeated slugs get `-2`, `-3`, … in document
 * order, skipping any id already taken.
 * @returns {(text: string) => string}
 */
function createSlugger() {
  const used = new Set();
  return function slug(text) {
    const base = slugify(text);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
}

module.exports = { slugify, createSlugger };
