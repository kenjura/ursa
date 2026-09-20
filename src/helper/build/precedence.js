/**
 * The one copy of ursa's path rules.
 *
 * Several sources can claim one output path (`index.md` beside `index.mdx`;
 * `foo.md` beside a hand-written `foo.html`; `home.md` beside a folder-named
 * `foo/foo.md`), and several different lists of who wins used to live in the
 * link validator, the auto-index generator, the menu builder, the dev server
 * and the single-file regenerator — and they disagreed. This module is the
 * list. Link resolution, output ownership (`outputOwner` in site.js), the menu,
 * `dev` and the dev server's URL resolver all read it from here.
 *
 * See docs/SERVE.md §8.2 and §8.3.
 */

import { basename, dirname, extname, posix } from "path";

/**
 * Article extensions in precedence order, highest first. `.mdx` beats `.md`
 * because the migration direction is md → mdx, and during the overlap the
 * author expects the new file to show.
 */
export const ARTICLE_EXTENSIONS = [".mdx", ".md", ".txt", ".yml"];

/** A hand-written `.html` in the source tree outranks any rendered document. */
export const HANDWRITTEN_EXTENSION = ".html";

/** Everything that renders to (or is copied as) a page. */
export const PAGE_SOURCE_EXTENSIONS = [HANDWRITTEN_EXTENSION, ...ARTICLE_EXTENSIONS];

export const ARTICLE_EXT_RE = /\.(mdx|md|txt|yml)$/i;

/**
 * Basenames that can stand in for a folder's `index`, in precedence order.
 * The folder's own name (`foo/foo.md`) comes after all of these; the generated
 * auto-index comes last.
 */
export const INDEX_BASENAMES = ["index", "_index", "home", "_home"];

/** Marker returned by `indexCandidates` after every document candidate. */
export const AUTO_INDEX = Symbol("auto-index");

export function isArticle(path) {
  return ARTICLE_EXT_RE.test(path);
}

export function isHandwrittenHtml(path) {
  return extname(path).toLowerCase() === HANDWRITTEN_EXTENSION;
}

/** True when a basename is one of the folder-index names. */
export function isIndexBasename(base) {
  return INDEX_BASENAMES.includes(base);
}

/**
 * Source paths (relative to the docroot) that could produce the output
 * `<dir>/<base>.html`, highest precedence first. Does not include the
 * folder-index alternates: use `indexCandidates` for `<dir>/index.html`.
 * @param {string} dirRel - Directory relative to the docroot ("" for the root)
 * @param {string} base - Output basename without extension
 * @returns {string[]}
 */
export function pageCandidates(dirRel, base) {
  const prefix = dirRel ? `${dirRel}/` : "";
  return PAGE_SOURCE_EXTENSIONS.map((ext) => `${prefix}${base}${ext}`);
}

/**
 * Everything that could own `<dirRel>/index.html`, highest precedence first,
 * ending with the AUTO_INDEX marker:
 *   1. index.html (hand-written)
 *   2. index.mdx, index.md, index.txt, index.yml
 *   3. _index.* in the same extension order
 *   4. home.*, then _home.*
 *   5. <foldername>.* (folder-named promotion)
 *   6. the generated auto-index
 * @param {string} dirRel - Directory relative to the docroot ("" for the root)
 * @returns {(string|symbol)[]}
 */
export function indexCandidates(dirRel) {
  const out = [];
  for (const base of INDEX_BASENAMES) out.push(...pageCandidates(dirRel, base));
  const folderName = dirRel ? basename(dirRel) : null;
  if (folderName && !isIndexBasename(folderName)) {
    out.push(...pageCandidates(dirRel, folderName));
  }
  out.push(AUTO_INDEX);
  return out;
}

/**
 * Candidates for any output path relative to the output directory.
 * `foo/index.html` → indexCandidates("foo"); `foo/bar.html` → pageCandidates("foo", "bar").
 * @param {string} outputRel - e.g. "foo/bar.html"
 * @returns {(string|symbol)[]}
 */
export function candidatesForOutput(outputRel) {
  const ext = extname(outputRel);
  const base = basename(outputRel, ext);
  const dir = dirname(outputRel);
  const dirRel = dir === "." ? "" : dir;
  if (base === "index" && ext === ".html") return indexCandidates(dirRel);
  return pageCandidates(dirRel, base);
}

/**
 * The output path (relative to the output directory) a source document
 * renders to on its own account: `foo/bar.md` → `foo/bar.html`.
 * Folder-index promotion (`foo/foo.md` → `foo/index.html`) is a second
 * output decided by ownership, not by this function.
 */
export function outputPathFor(sourceRel) {
  return sourceRel.replace(/\.[^./]+$/, ".html");
}

/**
 * True when a document named like this could be promoted to its folder's
 * index (it is an index alternate or is named after its folder).
 */
export function isIndexCandidate(sourceRel) {
  const ext = extname(sourceRel);
  const base = basename(sourceRel, ext);
  if (isIndexBasename(base)) return true;
  const dir = dirname(sourceRel);
  return dir !== "." && basename(dir) === base;
}

/**
 * Resolve a request URL path to the output file it names, relative to the
 * output directory. Shared by the dev server's middleware and its reload
 * logic so they cannot disagree.
 *
 *   /foo/      → foo/index.html
 *   /foo.html  → foo.html
 *   /foo       → foo.html if that output exists, else foo/index.html (the file wins)
 *
 * @param {string} urlPath - Path component of the request URL (no query)
 * @param {(outputRel: string) => boolean} outputExists - Whether an output file exists
 * @returns {string} Output path relative to the output directory
 */
export function resolveUrlToOutput(urlPath, outputExists) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    p = urlPath;
  }
  if (!p.startsWith("/")) p = "/" + p;
  p = posix.normalize(p);
  if (p === "/" || p.endsWith("/")) return posix.join(p, "index.html").replace(/^\//, "");
  const rel = p.replace(/^\//, "");
  if (extname(rel)) return rel;
  if (outputExists(rel + ".html")) return rel + ".html";
  return posix.join(rel, "index.html");
}

/**
 * Normalize a client-reported URL for comparison with output paths.
 * Both `/foo/` and `/foo/index.html` name the same output.
 */
export function urlToOutputCandidates(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    p = urlPath;
  }
  if (!p.startsWith("/")) p = "/" + p;
  p = posix.normalize(p);
  const rel = p.replace(/^\//, "");
  if (p === "/" || p.endsWith("/")) return [posix.join(rel, "index.html")];
  if (extname(rel)) return [rel];
  return [rel + ".html", posix.join(rel, "index.html")];
}
