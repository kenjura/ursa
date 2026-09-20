/**
 * Named menus: `menu-<name>.md` files rendered inline where a document asks
 * for them.
 *
 * `menu.md` defines a folder's navigation menu and replaces the site's nav for
 * the folder and everything below it. A menu file whose frontmatter carries an
 * `id` is different: it renders nowhere on its own. Instead any document in
 * the folder (or below it) places it with an anchor on a line of its own:
 *
 *     {menu:classes}
 *
 * The anchor becomes a static `<nav class="ursa-menu">` at that point in the
 * body — part of the document, not a fixed element — with the menu's items
 * as a horizontal strip (the default) or a vertical list (`appearance:
 * vertical`). The item whose href is the current page is marked.
 *
 * Failure is quiet by design: an anchor whose menu is not found, or whose menu
 * file cannot be parsed, is replaced by an HTML comment and reported as a
 * build warning. The page still renders, with nothing visible where the menu
 * would have been, and the surrounding Markdown is untouched.
 */

import { readdirSync, readFileSync } from "./build/tracedFs.js";
import { join, dirname, resolve, basename } from "path";
import { extractMenuFrontmatter, isMenuFile } from "./customMenu.js";

/** An anchor: `{menu:<id>}`. Ids are letters, digits, `_`, `-` and `.`. */
const ANCHOR_ID = "[A-Za-z0-9_][A-Za-z0-9_.-]*";
const ANCHOR_RE = new RegExp(`\\{menu:(${ANCHOR_ID})\\}`, "g");
/** The anchor alone on a line (leading/trailing blanks allowed). */
const ANCHOR_LINE_RE = new RegExp(`^[ \\t]*\\{menu:(${ANCHOR_ID})\\}[ \\t]*$`, "gm");
/** The element form of the anchor, which is what the MDX pipeline sees. */
const ANCHOR_ELEMENT_RE = /<div\s+data-ursa-menu="([^"]+)"\s*(?:\/>|>\s*<\/div>)/g;

export const APPEARANCES = ["horizontal", "vertical"];
const DEFAULT_APPEARANCE = "horizontal";

/**
 * Normalise a menu file's frontmatter into the fields named menus use.
 * `id` is required for a named menu; without it the file is a folder menu
 * (menu.md) or invalid (menu-x.md), which the caller decides.
 * @param {object} frontmatter
 * @returns {{id: string|null, appearance: string, appearanceInvalid: string|null}}
 */
export function namedMenuOptions(frontmatter) {
  const rawId = frontmatter?.id;
  const id = rawId === undefined || rawId === null || rawId === "" ? null : String(rawId).trim();
  const rawAppearance = frontmatter?.appearance;
  let appearance = DEFAULT_APPEARANCE;
  let appearanceInvalid = null;
  if (rawAppearance !== undefined && rawAppearance !== "") {
    const a = String(rawAppearance).trim().toLowerCase();
    if (APPEARANCES.includes(a)) appearance = a;
    else appearanceInvalid = String(rawAppearance);
  }
  return { id, appearance, appearanceInvalid };
}

/**
 * Menu files in one directory, sorted. Reads the listing through tracedFs so
 * a file appearing later is an observed change.
 * @param {string} dirPath - Absolute directory
 * @returns {string[]} - Absolute paths
 */
export function menuFilesIn(dirPath) {
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && isMenuFile(e.name))
    .map((e) => join(dirPath, e.name))
    .sort();
}

/**
 * Find the nearest menu file with the given id, walking up from `dirPath` to
 * the source root. A deeper file with the same id shadows a shallower one.
 * @param {string} dirPath - Absolute directory to start from
 * @param {string} sourceRoot - Absolute docroot; the walk stops here
 * @param {string} id - The menu id an anchor named
 * @returns {{path: string, menuDir: string, content: string, frontmatter: object, body: string} | null}
 */
export function findNamedMenu(dirPath, sourceRoot, id) {
  const root = resolve(sourceRoot);
  let current = resolve(dirPath);
  while (current.startsWith(root)) {
    for (const menuPath of menuFilesIn(current)) {
      let content;
      try {
        content = readFileSync(menuPath, "utf8");
      } catch {
        continue;
      }
      const { frontmatter, body } = extractMenuFrontmatter(content);
      if (namedMenuOptions(frontmatter).id === id) {
        return { path: menuPath, menuDir: current, content, frontmatter, body };
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Every menu id a rendered body anchors, in both forms, in order of first
 * appearance. Used to demand the menus before substituting them.
 * @param {string} html
 * @returns {string[]}
 */
export function collectMenuAnchorIds(html) {
  const ids = [];
  const seen = new Set();
  const add = (id) => {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const m of html.matchAll(ANCHOR_ELEMENT_RE)) add(m[1]);
  for (const m of html.matchAll(ANCHOR_RE)) add(m[1]);
  return ids;
}

/**
 * MDX reads `{menu:x}` as a JavaScript expression and fails to compile it.
 * Before compiling, an anchor alone on a line becomes the element form, which
 * is JSX the compiler passes through and `resolveMenuAnchors` recognises.
 * @param {string} source - Raw .mdx source
 * @returns {string}
 */
export function prepareMdxMenuAnchors(source) {
  if (!source.includes("{menu:")) return source;
  return source.replace(ANCHOR_LINE_RE, (_, id) => `\n<div data-ursa-menu="${id}"></div>\n`);
}

/**
 * Replace every anchor in rendered HTML with what `render(id)` returns.
 *
 * Handles the element form anywhere, and the `{menu:x}` form inside a
 * paragraph: a paragraph that is only the anchor is replaced whole, and a
 * paragraph with text around the anchor is split so the `<nav>` never sits
 * inside a `<p>`. Anchors inside `<code>` are left alone — they are being
 * talked about, not used.
 *
 * @param {string} html - Rendered body
 * @param {(id: string) => string} render - Markup for one id (never throws; see `menuNotFoundComment`)
 * @returns {string}
 */
export function resolveMenuAnchors(html, render) {
  if (!html || (!html.includes("{menu:") && !html.includes("data-ursa-menu"))) return html;

  html = html.replace(ANCHOR_ELEMENT_RE, (_, id) => render(id));

  if (!html.includes("{menu:")) return html;
  return html.replace(/<p>([\s\S]*?)<\/p>/g, (paragraph, inner) => {
    if (!inner.includes("{menu:")) return paragraph;
    // Anchors quoted in code spans stay as written
    const codeSpans = [];
    const masked = inner.replace(/<code[\s>][\s\S]*?<\/code>/g, (span) => {
      codeSpans.push(span);
      return `\u0000${codeSpans.length - 1}\u0000`;
    });
    const unmask = (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
    const parts = masked.split(new RegExp(`\\{menu:(${ANCHOR_ID})\\}`));
    if (parts.length === 1) return paragraph;
    let out = "";
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        out += render(parts[i]);
      } else {
        const text = unmask(parts[i]).trim();
        if (text) out += `<p>${text}</p>\n`;
      }
    }
    return out;
  });
}

/** What an anchor becomes when its menu cannot be rendered. */
export function menuNotFoundComment(id, reason = "not found") {
  return `<!-- ursa: menu "${escapeHtml(id)}" ${escapeHtml(reason)} -->`;
}

/**
 * True when a rendered body begins with inline menus (after optional
 * whitespace), so the default-title injection can place its `<h1>` after them
 * rather than pushing a top-of-page menu below the title.
 * @param {string} html
 * @returns {number} - Index just past the leading menus (0 when there are none)
 */
export function leadingMenusEnd(html) {
  let i = 0;
  const re = /^\s*(<nav class="ursa-menu[^"]*"[^>]*>[\s\S]*?<\/nav>|<!-- ursa: menu [^>]*-->)/;
  for (;;) {
    const m = re.exec(html.slice(i));
    if (!m) return i;
    i += m[0].length;
  }
}

/**
 * Static markup for a named menu.
 *
 * @param {Array} menuData - Items as `parseCustomMenu` produces them ({label, href, children})
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} [opts.appearance="horizontal"]
 * @param {string|null} [opts.currentUrl] - The page's root-absolute `.html` URL, to mark the current item
 * @returns {string}
 */
export function renderInlineMenuHtml(menuData, { id, appearance = DEFAULT_APPEARANCE, currentUrl = null }) {
  const current = currentUrl ? normalizeUrl(currentUrl) : null;
  const list = renderLevel(menuData || [], current, 0);
  return `<nav class="ursa-menu ursa-menu-${appearance}" data-menu-id="${escapeHtml(id)}" aria-label="${escapeHtml(id)}">${list}</nav>`;
}

function renderLevel(items, current, depth) {
  if (!items || items.length === 0) return "";
  const lis = items.map((item) => {
    const children = item.children || [];
    const isCurrent = current !== null && item.href && normalizeUrl(item.href) === current;
    const hasCurrentBelow = !isCurrent && containsCurrent(children, current);
    const classes = ["ursa-menu-item"];
    if (children.length > 0) classes.push("ursa-menu-has-children");
    if (isCurrent) classes.push("ursa-menu-current");
    if (hasCurrentBelow) classes.push("ursa-menu-active");
    const label = escapeHtml(item.label ?? "");
    const link = item.href
      ? `<a href="${escapeHtml(item.href)}"${isCurrent ? ' aria-current="page"' : ""}>${label}</a>`
      : `<span>${label}</span>`;
    return `<li class="${classes.join(" ")}">${link}${renderLevel(children, current, depth + 1)}</li>`;
  });
  return `<ul class="ursa-menu-level" data-depth="${depth}">${lis.join("")}</ul>`;
}

function containsCurrent(items, current) {
  if (current === null) return false;
  for (const item of items || []) {
    if (item.href && normalizeUrl(item.href) === current) return true;
    if (containsCurrent(item.children, current)) return true;
  }
  return false;
}

/** `/a/b/index.html`, `/a/b/`, `/a/b` and `/a/b.html` compare by the same key. */
function normalizeUrl(url) {
  let u = String(url).split("#")[0].split("?")[0];
  try {
    u = decodeURIComponent(u);
  } catch {
    // leave as written
  }
  u = u.replace(/\/index\.html$/i, "/").replace(/\.html$/i, "");
  if (u.length > 1) u = u.replace(/\/$/, "");
  return u.toLowerCase();
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The menu id a `menu-<id>.md` filename suggests; for messages only. */
export function menuFileSuffix(path) {
  const m = basename(path).match(/^_?menu-(.+)\.(md|txt)$/i);
  return m ? m[1] : null;
}
