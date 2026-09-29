/**
 * Named menus: `menu-<name>.md` files rendered inline where a document asks
 * for them, or where a folder's config.json injects them.
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
 * A folder can also ask for a menu on every document beneath it without an
 * anchor in each one: `"inject-menu": {"id": "classes", "position": "top"}`
 * in its config.json (see parseInjectMenu / mergeInjectMenus below). The
 * menu resolves by id from the document's folder exactly as an anchor does.
 *
 * Failure is quiet by design: an anchor whose menu is not found, or whose menu
 * file cannot be parsed, is replaced by an HTML comment and reported as a
 * build warning. The page still renders, with nothing visible where the menu
 * would have been, and the surrounding Markdown is untouched.
 */

import { readdirSync, readFileSync } from "./build/tracedFs.js";
import { join, dirname, resolve, basename, posix } from "path";
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

// ---------------------------------------------------------------------------
// Injected menus: config.json `inject-menu`
// ---------------------------------------------------------------------------

export const INJECT_POSITIONS = ["top", "bottom"];

/**
 * Normalise a folder's `inject-menu` value: one object or an array of them,
 * each `{id, position, "replace-ancestor-menus"?}`. `{inherit: true}` alone
 * is accepted and ignored: inheriting is the default since 0.100.0.
 *
 * @param {unknown} value - The raw `inject-menu` value from config.json
 * @returns {{entries: {id: string, position: string, replace: boolean}[], problems: string[]}}
 */
export function parseInjectMenu(value) {
  const out = { entries: [], problems: [] };
  if (value === undefined || value === null) return out;
  const list = Array.isArray(value) ? value : [value];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      out.problems.push(`entry ${JSON.stringify(item)} is not an object`);
      continue;
    }
    if (item.inherit === true && item.id === undefined) continue;
    const id = item.id === undefined || item.id === null ? "" : String(item.id).trim();
    if (!id) {
      out.problems.push(`entry ${JSON.stringify(item)} has no id`);
      continue;
    }
    let position = item.position === undefined ? "top" : String(item.position).trim().toLowerCase();
    if (!INJECT_POSITIONS.includes(position)) {
      out.problems.push(`"${id}": position "${item.position}" is not top or bottom; using top`);
      position = "top";
    }
    const replaceFlag = item["replace-ancestor-menus"];
    if (replaceFlag !== undefined && typeof replaceFlag !== "boolean") {
      out.problems.push(`"${id}": replace-ancestor-menus ${JSON.stringify(replaceFlag)} is not true or false; using false`);
    }
    out.entries.push({ id, position, replace: replaceFlag === true });
  }
  return out;
}

/**
 * The menus a folder injects, from the chain of parsed `inject-menu` values
 * on the way down from the docroot (`levels[0]` is the root, the last is the
 * folder itself; a level with no `inject-menu` is null).
 *
 * Menus accumulate: at each position the least specific folder's menus come
 * first and each deeper folder's are added after them. An entry with
 * `replace-ancestor-menus: true` first drops every menu its ancestors inject
 * at its position; menus at the other position are kept. A level without the
 * key changes nothing. The same id at the same position is injected once, in
 * its first place.
 *
 * @param {(ReturnType<typeof parseInjectMenu>|null)[]} levels
 * @returns {{id: string, position: string}[]}
 */
export function mergeInjectMenus(levels) {
  let effective = [];
  for (const level of levels) {
    if (!level) continue;
    const replaced = new Set(level.entries.filter((e) => e.replace).map((e) => e.position));
    const merged = effective.filter((e) => !replaced.has(e.position));
    for (const { id, position } of level.entries) {
      if (!merged.some((e) => e.id === id && e.position === position)) merged.push({ id, position });
    }
    effective = merged;
  }
  return effective;
}

// ---------------------------------------------------------------------------
// Menu file bodies: item lists and the prose between them
// ---------------------------------------------------------------------------

/** A line the menu parser treats as an item: `- [..](..)`, `* [..](..)`, `* [[..]]`. */
const ITEM_LINE_RE = /^\s*(?:-\s*\[[^\]]*\]\(|\*+\s*\[)/;

/**
 * Split a menu file's body into item lists and the text around them, in
 * order. `menu.md` only ever needed the items — a fixed nav shows nothing
 * else — but a menu rendered into the page can carry a label before its list
 * or a note after it. Text segments are Markdown; item segments are what
 * `parseCustomMenu` reads.
 *
 * @param {string} body
 * @returns {{kind: 'items'|'text', text: string}[]}
 */
export function splitMenuBody(body) {
  const segments = [];
  let current = null;
  for (const line of body.split("\n")) {
    if (!line.trim()) {
      if (current) current.lines.push(line);
      continue;
    }
    const kind = ITEM_LINE_RE.test(line) ? "items" : "text";
    if (!current || current.kind !== kind) {
      current = { kind, lines: [] };
      segments.push(current);
    }
    current.lines.push(line);
  }
  return segments
    .map(({ kind, lines }) => ({ kind, text: lines.join("\n").trim() }))
    .filter((seg) => seg.text);
}

/**
 * A menu's prose is rendered once and inlined into pages in other folders,
 * so its relative links and images must be made root-absolute against the
 * menu file's own folder before that happens.
 *
 * @param {string} html - Rendered text segment
 * @param {string} menuUrlDir - The menu file's folder as a URL path, e.g. "/character/feats"
 */
export function rebaseMenuHtml(html, menuUrlDir) {
  const base = menuUrlDir.endsWith("/") ? menuUrlDir : menuUrlDir + "/";
  return html.replace(/(<(?:a|img|source|video|audio)\b[^>]*?\s(?:href|src)=["'])([^"']+)(["'])/gi, (m, before, url, quote) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i.test(url)) return m;
    const [pathPart, rest = ""] = url.split(/(?=[?#])/, 2);
    let resolved = posix.normalize(base + pathPart);
    resolved = resolved.replace(/\.(md|mdx|txt)$/i, ".html");
    return `${before}${resolved}${rest}${quote}`;
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
 * @param {Array} content - Either items as `parseCustomMenu` produces them
 *   ({label, href, children}), or segments: `{kind: 'items', items}` and
 *   `{kind: 'text', html}` in document order
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} [opts.appearance="horizontal"]
 * @param {string|null} [opts.currentUrl] - The page's root-absolute `.html` URL, to mark the current
 *   item (`ursa-menu-current`), items above it in the menu (`ursa-menu-active`) and items whose
 *   folder the page is in without being that page (`ursa-menu-path`)
 * @returns {string}
 */
export function renderInlineMenuHtml(content, { id, appearance = DEFAULT_APPEARANCE, currentUrl = null }) {
  const current = currentUrl ? normalizeUrl(currentUrl) : null;
  const segments = Array.isArray(content) && content.length > 0 && content[0]?.kind
    ? content
    : [{ kind: "items", items: content || [] }];
  const inner = segments.map((seg) =>
    seg.kind === "text"
      ? `<div class="ursa-menu-text">${seg.html}</div>`
      : renderLevel(seg.items || [], current, 0)
  ).join("");
  return `<nav class="ursa-menu ursa-menu-${appearance}" data-menu-id="${escapeHtml(id)}" aria-label="${escapeHtml(id)}">${inner}</nav>`;
}

function renderLevel(items, current, depth) {
  if (!items || items.length === 0) return "";
  const lis = items.map((item) => {
    const children = item.children || [];
    const isCurrent = current !== null && item.href && normalizeUrl(item.href) === current;
    const hasCurrentBelow = !isCurrent && containsCurrent(children, current);
    const isOnPath = !isCurrent && !hasCurrentBelow && item.href && coversPath(normalizeUrl(item.href), current);
    const classes = ["ursa-menu-item"];
    if (children.length > 0) classes.push("ursa-menu-has-children");
    if (isCurrent) classes.push("ursa-menu-current");
    if (hasCurrentBelow) classes.push("ursa-menu-active");
    if (isOnPath) classes.push("ursa-menu-path");
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

/**
 * Whether an item's page is a folder above the current page: `/character/ancestry`
 * (the folder's index) covers `/character/ancestry/dragon`. The docroot covers
 * everything, so it covers nothing here.
 */
function coversPath(itemKey, current) {
  if (current === null || itemKey === "/" || itemKey === "") return false;
  return current.startsWith(itemKey + "/");
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
