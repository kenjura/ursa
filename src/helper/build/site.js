/**
 * The build as a graph of nodes (docs/SERVE.md §4).
 *
 * Every output file the build produces is owned by exactly one node defined
 * here, and every node's compute function reads its inputs through the graph
 * — `ctx.read`, `ctx.exists`, `ctx.listDir`, `ctx.get` — or through helpers
 * whose fs calls are traced (tracedFs.js), so the engine records exactly what
 * each output consumed. Nothing in this file decides what to rebuild; it only
 * says how each thing is built and what it reads. The engine does the rest.
 *
 * `generate` and `serve` run the same nodes (pass.js). Node ids are
 * `kind:key`, where the key is a path relative to the docroot (documents,
 * directories, images), a template name (meta), or empty (site-wide).
 */

import { basename, dirname, extname, join, posix, relative } from "path";
import { mkdir, readFile as fsReadFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import * as esbuild from "esbuild";
import o2x from "object-to-xml";

import { hashBytes, currentRecorder } from "./tracedFs.js";
import {
  ARTICLE_EXTENSIONS,
  AUTO_INDEX,
  INDEX_BASENAMES,
  candidatesForOutput,
  isArticle,
  isHandwrittenHtml,
  isIndexBasename,
  isIndexCandidate,
  outputPathFor,
} from "./precedence.js";
import { getTemplates } from "./templates.js";
import { getFooter } from "./footer.js";
import { getTransformedMetadata } from "./metadata.js";
import { toTitleCase } from "./titleCase.js";
import { parseExcludeOption, createExcludeFilter } from "./excludeFilter.js";
import { generateAutoIndexHtmlFromSource } from "./autoIndex.js";
import { getUrsaVersion } from "../ursaVersion.js";
import { createWhitelistFilter } from "../whitelistFilter.js";
import { isHiddenOrSystemPath } from "../hiddenPaths.js";
import { getFolderConfig, isFolderHidden, isFolderSelfHidden } from "../folderConfig.js";
import { getFolderLabel } from "../menuLabels.js";
import { IMAGE_EXTENSIONS, isMedia } from "../staticAssets.js";
import { extractMetadata, isMetadataOnly, getAutoIndexConfig } from "../metadataExtractor.js";
import { injectFrontmatterTable } from "../frontmatterTable.js";
import { extractSections } from "../sectionExtractor.js";
import { renderFile, renderFileAsync } from "../fileRenderer.js";
import { generateBreadcrumbs } from "../breadcrumbs.js";
import { getAutomenu } from "../automenu.js";
import {
  findCustomMenu,
  extractMenuFrontmatter,
  parseCustomMenu,
  combineAutoAndManualMenu,
} from "../customMenu.js";
import { findAllStyleCss } from "../findStyleCss.js";
import { findAllScriptJs } from "../findScriptJs.js";
import {
  parseTemplateAssets,
  rewriteTemplateWithBundles,
  bundleCssContent,
  bundleJsContent,
  resolveMetaAssetPath,
  versionCssUrls,
  rewriteJsonFetches,
} from "../assetBundler.js";
import {
  buildValidPaths,
  collectInternalHrefs,
  markInactiveLinks,
  resolveNormalizedHref,
  resolveRelativeUrls,
} from "../linkValidator.js";
import { transformImageTags, willHavePreview, renderPreview, getPreviewFilename, isImageExtension } from "../imageProcessor.js";
import { documentWordCounts, mergeWordCounts } from "../fullTextIndex.js";
import { buildSourceTimestampIndex } from "../sourceTimestamps.js";

const DEFAULT_TEMPLATE_NAME = process.env.DEFAULT_TEMPLATE_NAME ?? "default-template";
const MENU_FILE_NAMES = ["menu.md", "menu.txt", "_menu.md", "_menu.txt"];
const REACT_RUNTIME_MARKER = "ursa-react-runtime/2";

export function nodeId(kind, key = "") {
  return `${kind}:${key}`;
}

export function parseNodeId(id) {
  const i = id.indexOf(":");
  return { kind: id.slice(0, i), key: id.slice(i + 1) };
}

/** Node kinds whose key is a document path in the document set. */
export const DOC_KINDS = ["bodyHtml", "pageHtml", "docData", "docWords"];
/** Node kinds whose key is a directory in the document set ("" is the root). */
export const DIR_KINDS = ["dirIndexJson", "dirListingHtml", "autoIndexPage", "dirSet"];
/** Node kinds kept only while something depends on them. */
export const INTERNAL_KINDS = [
  "linkResolution", "outputOwner", "customMenuFor", "cssBundle", "jsBundle",
  "metaAsset", "metaBundle", "imageInfo", "docMeta",
];
/** Site-wide singletons. */
export const SITE_KINDS = [
  "documentSet", "validPaths", "templates", "metaAssets", "menuData", "menuHtml",
  "footer", "reactRuntime", "ursaMetadata", "searchIndex", "fullTextIndex",
  "recentActivity", "customMenus",
];

/**
 * Create the node definitions for one site.
 *
 * @param {object} env
 * @param {string} env.source - Absolute docroot (no trailing slash)
 * @param {string} env.meta - Absolute meta directory
 * @param {string} env.output - Absolute output directory
 * @param {string|null} env.whitelist - Whitelist file path
 * @param {string|null} env.exclude - Exclude option (paths or a file)
 * @param {boolean} env.jsonOnly - Emit only .json data files
 * @param {{buildId: number, now: Date, gitHash: string|null}} env.session - Per-session build metadata (§7)
 * @param {(msg: string) => void} env.log
 * @param {(key: string, msg: string) => void} env.warn - De-duplicated per pass
 * @returns {{resolve: (id: string) => ({fn: Function, fingerprint?: Function}|null)}}
 */
export function createSite(env) {
  const { source, meta, output } = env;
  const log = env.log ?? (() => {});
  const warn = env.warn ?? ((k, m) => console.warn(m));
  const abs = (rel) => (rel ? join(source, rel) : source);
  const outAbs = (rel) => join(output, rel);
  const relOf = (absPath) => relative(source, absPath).split("\\").join("/");
  const urlOf = (rel) => "/" + rel;

  // -------------------------------------------------------------------------
  // Output writing
  // -------------------------------------------------------------------------

  /**
   * Write an output file only when its bytes differ (minimality, §1) and
   * declare ownership of it. Returns the content hash.
   */
  async function writeOutput(ctx, rel, content) {
    const path = outAbs(rel);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const hash = hashBytes(buf);
    let same = false;
    try {
      const existing = await fsReadFile(path);
      same = existing.length === buf.length && hashBytes(existing) === hash;
    } catch {
      same = false;
    }
    if (!same) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buf);
      env.onWrite?.(rel);
    }
    ctx.own(rel);
    return hash;
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  /** Filename-derived title, as the search index and recent activity name a document. */
  function titleOf(rel) {
    const ext = extname(rel);
    const base = basename(rel, ext);
    const dir = dirname(rel);
    const titleBase = base === "index" || base === "home" ? basename(dir === "." ? source : dir) : base;
    return toTitleCase(titleBase || base);
  }

  /** Directory of a document relative to the docroot, with trailing slash ("" at the root). */
  function dirWithSlash(rel) {
    const d = dirname(rel);
    return d === "." ? "" : d + "/";
  }

  function dirRelOf(rel) {
    const d = dirname(rel);
    return d === "." ? "" : d;
  }

  function indexOutputFor(dirRel) {
    return dirRel ? `${dirRel}/index.html` : "index.html";
  }

  /**
   * Pre-load frontmatter for the given documents into the active recorder so
   * label lookups made by the menu/breadcrumb/auto-index helpers hit `docMeta`
   * projections instead of file contents (see menuLabels.readFrontmatterInfo).
   */
  async function preloadFrontmatter(ctx, docs, { nonDocuments = [] } = {}) {
    const rec = currentRecorder();
    if (!rec) return;
    if (!rec.frontmatter) rec.frontmatter = new Map();
    for (const d of docs) {
      if (!isArticle(d)) continue;
      const info = await ctx.get(nodeId("docMeta", d));
      rec.frontmatter.set(abs(d), { meta: info.meta, isMetadataOnly: info.isMetadataOnly });
    }
    // Files that are not documents have no frontmatter worth reading; a
    // stylesheet's or image's content must not become an input of the menu
    const none = { meta: null, isMetadataOnly: false };
    for (const f of nonDocuments) rec.frontmatter.set(abs(f), none);
  }

  /**
   * Documents in a folder (and, one level down, the index documents of its
   * subfolders) whose labels an auto-index listing shows. Read from directory
   * listings only, so a document added elsewhere is not an input.
   */
  async function indexDocsAround(ctx, dirRel) {
    const out = [];
    for (const entry of await ctx.listDir(abs(dirRel))) {
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.kind === "file" && isArticle(entry.name)) out.push(rel);
      if (entry.kind === "dir") {
        for (const child of await ctx.listDir(abs(rel))) {
          if (child.kind === "file" && isArticle(child.name) && isIndexBasename(basename(child.name, extname(child.name)))) {
            out.push(`${rel}/${child.name}`);
          }
        }
      }
    }
    return out;
  }

  /** Every document at or below a folder, to `depth` levels (Infinity for all). */
  async function docsBelow(ctx, dirRel, depth) {
    const out = [];
    const walk = async (rel, level) => {
      for (const entry of await ctx.listDir(abs(rel))) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.kind === "file" && isArticle(entry.name)) out.push(childRel);
        else if (entry.kind === "dir" && level < depth && !isHiddenOrSystemPath(abs(childRel), source)) await walk(childRel, level + 1);
      }
    };
    await walk(dirRel, 1);
    return out;
  }

  /**
   * Ancestors' index documents, for breadcrumb labels: each candidate name is
   * probed (a recorded lookup), so only the folder's own index files are inputs.
   */
  function ancestorIndexDocs(ctx, dirRel) {
    const out = [];
    let cur = dirRel;
    while (cur) {
      for (const base of INDEX_BASENAMES) {
        for (const ext of ARTICLE_EXTENSIONS) {
          const candidate = `${cur}/${base}${ext}`;
          if (ctx.exists(abs(candidate))) out.push(candidate);
        }
      }
      const parent = dirname(cur);
      cur = parent === "." ? "" : parent;
    }
    return out;
  }

  /**
   * Resolve the internal links in HTML through per-href nodes and mark the
   * broken ones inactive.
   */
  async function resolveLinks(ctx, html, docUrlPath) {
    const hrefs = collectInternalHrefs(html, docUrlPath);
    const map = new Map();
    for (const h of hrefs) map.set(h, await ctx.get(nodeId("linkResolution", h)));
    return markInactiveLinks(html, (n) => map.get(n) ?? null, docUrlPath);
  }

  /** Site-absolute lookup path for an image src, the way transformImageTags resolves it. */
  function imageLookupPath(src, docUrlPath) {
    let lookupPath = src.split("?")[0].split("#")[0];
    if (!lookupPath.startsWith("/")) {
      const docDir = docUrlPath.substring(0, docUrlPath.lastIndexOf("/")) || "/";
      const parts = docDir.split("/").filter(Boolean);
      for (const part of lookupPath.split("/")) {
        if (part === "..") parts.pop();
        else if (part !== ".") parts.push(part);
      }
      lookupPath = "/" + parts.join("/");
    }
    try {
      lookupPath = decodeURIComponent(lookupPath);
    } catch {
      // keep as-is
    }
    return lookupPath;
  }

  /**
   * Rewrite <img> tags to previews with lightbox anchors, and version every
   * image, stylesheet and script reference with the content hash of what it
   * points at. Returns the HTML and the images (docroot-relative) it uses.
   */
  async function finishAssets(ctx, html, docUrlPath) {
    // Images referenced by the page: one imageInfo node each
    const imgRe = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
    const imageMap = new Map();
    const hashes = new Map(); // site-absolute URL (no query) → hash
    const images = [];
    let m;
    while ((m = imgRe.exec(html)) !== null) {
      const src = m[1];
      if (/^(https?:)?\/\/|^data:/i.test(src)) continue;
      const lookup = imageLookupPath(src, docUrlPath);
      if (imageMap.has(lookup)) continue;
      const rel = lookup.replace(/^\//, "");
      if (!IMAGE_EXTENSIONS.test(rel)) continue;
      const info = await ctx.get(nodeId("imageInfo", rel));
      if (info) {
        imageMap.set(lookup, { original: info.original, preview: info.preview });
        hashes.set(info.original, info.hash);
        hashes.set(info.preview, info.hash);
        images.push(rel);
      } else {
        imageMap.set(lookup, null);
      }
    }
    for (const [k, v] of [...imageMap]) if (!v) imageMap.delete(k);
    html = transformImageTags(html, imageMap, docUrlPath);

    // Stylesheets and scripts: the react runtime, meta assets, docroot assets
    const refRe = /<(?:link[^>]+href|script[^>]+src)=["']([^"'?]+\.(?:css|js))["']/gi;
    while ((m = refRe.exec(html)) !== null) {
      const url = m[1];
      if (hashes.has(url) || /^(https?:)?\/\//i.test(url)) continue;
      const hash = await assetHash(ctx, url);
      if (hash) hashes.set(url, hash);
    }
    html = versionHtmlRefs(html, (url) => hashes.get(url) ?? null);
    return { html, images };
  }

  /**
   * Content hash of the output file a site-absolute URL names, via the node
   * that owns it; null when nothing ursa builds lives there.
   */
  async function assetHash(ctx, url) {
    if (url === "/public/react-runtime.js") return env.jsonOnly ? null : (await ctx.get(nodeId("reactRuntime"))).hash;
    if (url.startsWith("/public/")) {
      const rel = url.slice("/public/".length);
      const assets = await ctx.get(nodeId("metaAssets"));
      if (assets.byRel[rel]) return (await ctx.get(nodeId("metaAsset", rel))).hash;
      return null;
    }
    if (!url.startsWith("/") || url.startsWith("//")) return null;
    let rel = url.replace(/^\//, "");
    try {
      rel = decodeURIComponent(rel);
    } catch {
      // keep as written
    }
    if (IMAGE_EXTENSIONS.test(rel)) return (await ctx.get(nodeId("imageInfo", rel)))?.hash ?? null;
    if (isMedia(rel)) return (await ctx.get(nodeId("staticAsset", rel)))?.hash ?? null;
    return null;
  }

  /** `?v=<hash>` on <link href>, <script src> and <img src> whose target is known. */
  function versionHtmlRefs(html, lookup) {
    const ver = (before, url, after) => {
      if (url.includes("?")) return before + url + after;
      const hash = lookup(url);
      return hash ? `${before}${url}?v=${hash}${after}` : before + url + after;
    };
    html = html.replace(/(<link[^>]+href=["'])([^"']+\.css)(["'][^>]*>)/gi, (_, b, u, a) => ver(b, u, a));
    html = html.replace(/(<script[^>]+src=["'])([^"']+\.js)(["'][^>]*>)/gi, (_, b, u, a) => ver(b, u, a));
    html = html.replace(/(<img[^>]+src=["'])([^"']+\.(?:jpg|jpeg|png|gif|webp|svg|ico))(["'][^>]*>)/gi, (_, b, u, a) => ver(b, u, a));
    return html;
  }

  /** Fill a template. A function replacer: `$&` in a document body must not be interpreted. */
  function fillTemplate(template, replacements) {
    const pattern = /\$\{(title|menu|meta|transformedMetadata|body|styleLink|customScript|searchIndex|footer)\}/g;
    return template.replace(pattern, (match) => replacements[match] ?? match);
  }

  /** Body attributes: menu position, custom menu path, build id (for JSON fetch cache-busting). */
  function bodyAttributes(html, customMenuInfo) {
    const attrs = [];
    if (customMenuInfo) attrs.push(`data-custom-menu="${customMenuInfo.menuJsonPath}"`);
    attrs.push(`data-menu-position="${customMenuInfo?.menuPosition || "top"}"`);
    attrs.push(`data-build="${env.session.buildId}"`);
    return html.replace(/<body([^>]*)>/, `<body$1 ${attrs.join(" ")}>`);
  }

  /** Assemble a page from a body and write it. Shared by documents, auto-indices and listings. */
  async function assemblePage(ctx, {
    templateName, dirRel, docUrlPath, title, meta, body, transformedMetadata = "",
    hydrationScript = "", useFolderAssets = true,
  }) {
    const templates = await ctx.get(nodeId("templates"));
    if (!templates[templateName]) {
      throw new Error(`Template not found. Requested: "${templateName}". Available templates: ${Object.keys(templates).join(", ") || "none"}`);
    }
    const template = await ctx.get(nodeId("metaBundle", templateName));
    let styleLink = "";
    let customScript = "";
    if (useFolderAssets) {
      const css = await ctx.get(nodeId("cssBundle", dirRel));
      const js = await ctx.get(nodeId("jsBundle", dirRel));
      if (css) styleLink = `<link rel="stylesheet" href="${css.url}" />`;
      if (js) customScript = `<script src="${js.url}"></script>`;
    }
    if (hydrationScript) customScript = customScript ? customScript + "\n" + hydrationScript : hydrationScript;
    const menu = await ctx.get(nodeId("menuHtml"));
    const footer = await ctx.get(nodeId("footer"));
    const customMenuInfo = await ctx.get(nodeId("customMenuFor", dirRel));

    let html = fillTemplate(template, {
      "${title}": title,
      "${menu}": menu,
      "${meta}": meta,
      "${transformedMetadata}": transformedMetadata,
      "${body}": body,
      "${styleLink}": styleLink,
      "${customScript}": customScript,
      "${searchIndex}": "[]", // Placeholder - search index written separately as JSON file
      "${footer}": footer,
    });
    html = bodyAttributes(html, customMenuInfo);
    html = resolveRelativeUrls(html, docUrlPath);
    html = await resolveLinks(ctx, html, docUrlPath);
    return finishAssets(ctx, html, docUrlPath);
  }

  // -------------------------------------------------------------------------
  // Node families
  // -------------------------------------------------------------------------

  const families = {
    // ----- Site-wide -------------------------------------------------------

    /**
     * What participates in the build: a projection of directory listings (plus
     * the whitelist/exclude files and each folder's config.json). Changes only
     * when a name appears, disappears or changes kind.
     */
    documentSet: () => async (ctx) => {
      const outputInside = output.startsWith(source + "/") ? output : null;
      const includeFilter = process.env.INCLUDE_FILTER
        ? (fileName) => fileName.match(process.env.INCLUDE_FILTER)
        : () => true;
      const excludeFilter = env.exclude
        ? createExcludeFilter(await parseExcludeOption(env.exclude, source + "/"), source + "/")
        : () => true;
      const whitelistFilter = env.whitelist ? await createWhitelistFilter(env.whitelist, source) : () => true;

      const files = [];
      const dirs = [];
      const walk = async (dirRel) => {
        const dirAbs = abs(dirRel);
        for (const entry of await ctx.listDir(dirAbs)) {
          const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
          const entryAbs = join(dirAbs, entry.name);
          if (outputInside && entryAbs === outputInside) continue;
          if (isHiddenOrSystemPath(entryAbs, source)) continue;
          if (entry.kind === "dir") {
            if (isFolderSelfHidden(entryAbs)) continue;
            if (!excludeFilter(entryAbs + "/") || !includeFilter(entryAbs)) continue;
            dirs.push(rel);
            await walk(rel);
          } else if (entry.kind === "file") {
            if (!includeFilter(entryAbs) || !excludeFilter(entryAbs) || !whitelistFilter(entryAbs)) continue;
            files.push(rel);
          }
        }
      };
      await walk("");
      files.sort();
      dirs.sort();

      const articles = files.filter((f) => isArticle(f));
      const html = files.filter((f) => isHandwrittenHtml(f));
      const images = files.filter((f) => IMAGE_EXTENSIONS.test(f));
      const media = files.filter((f) => isMedia(f));
      const dirsWithDocuments = new Set();
      for (const f of [...articles, ...html]) {
        let d = dirname(f);
        while (d && d !== ".") {
          dirsWithDocuments.add(d);
          d = dirname(d);
        }
      }
      const value = { files, dirs, articles, html, images, media, dirsWithDocuments: [...dirsWithDocuments].sort() };
      attachSets(value);
      return value;
    },

    /** Canonical-URL map for link resolution. Changes only on add/remove/rename. */
    validPaths: () => async (ctx) => {
      const set = await ctx.get(nodeId("documentSet"));
      const map = buildValidPaths(
        [...set.articles, ...set.html].map((r) => "/" + r),
        "",
        set.dirs.map((r) => "/" + r),
        { dirsWithDocuments: new Set(set.dirsWithDocuments) }
      );
      const value = { entries: [...map.entries()] };
      Object.defineProperty(value, "map", { value: map, enumerable: false });
      return value;
    },

    /** Canonical `.html` path for one normalized href, or null. One node per href seen. */
    linkResolution: (normalized) => async (ctx) => {
      const vp = await ctx.get(nodeId("validPaths"));
      return resolveNormalizedHref(normalized, vp.map);
    },

    templates: () => async () => getTemplates(meta),

    /** Every file under meta/shared and the template folders (minus index.html), by public path. */
    metaAssets: () => async (ctx) => {
      const byRel = {};
      const templatesDir = join(meta, "templates");
      const copyDir = async (dirAbs, prefix, exclude = []) => {
        for (const entry of await ctx.listDir(dirAbs)) {
          if (exclude.includes(entry.name)) continue;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.kind === "dir") await copyDir(join(dirAbs, entry.name), rel);
          else if (entry.kind === "file") byRel[rel] = join(dirAbs, entry.name);
        }
      };
      if (ctx.exists(templatesDir)) {
        await copyDir(join(meta, "shared"), "");
        for (const entry of await ctx.listDir(templatesDir)) {
          if (entry.kind === "dir") await copyDir(join(templatesDir, entry.name), "", ["index.html"]);
        }
        // Files at the meta root are not part of any template
        const orphans = [];
        for (const entry of await ctx.listDir(meta)) {
          if (entry.name === "templates" || entry.name === "shared") continue;
          orphans.push(entry.name);
        }
        if (orphans.length > 0) {
          warn("meta-orphans",
            `⚠️  ${orphans.length} file(s)/folder(s) in the meta directory are not in meta/templates/ or meta/shared/ and won't be included: ${orphans.slice(0, 10).join(", ")}${orphans.length > 10 ? ", …" : ""}`);
        }
      } else {
        // Legacy flat layout: everything but HTML
        const walkLegacy = async (dirAbs, prefix) => {
          for (const entry of await ctx.listDir(dirAbs)) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.kind === "dir") await walkLegacy(join(dirAbs, entry.name), rel);
            else if (entry.kind === "file" && !entry.name.endsWith(".html")) byRel[rel] = join(dirAbs, entry.name);
          }
        };
        await walkLegacy(meta, "");
      }
      const rels = Object.keys(byRel).sort();
      return { rels, byRel };
    },

    /** One copied meta asset in output/public. */
    metaAsset: (rel) => async (ctx) => {
      const assets = await ctx.get(nodeId("metaAssets"));
      const src = assets.byRel[rel];
      if (!src) return null;
      let content = await ctx.read(src, null);
      if (rel.endsWith(".css")) {
        // Version url() targets that are meta assets (fonts, images); never other stylesheets
        const css = content.toString("utf8");
        const urls = collectCssUrls(css);
        const hashes = new Map();
        for (const u of urls) {
          const target = metaUrlToRel(u, dirname(rel));
          if (target && target !== rel && !target.endsWith(".css") && assets.byRel[target]) {
            hashes.set(u, (await ctx.get(nodeId("metaAsset", target))).hash);
          }
        }
        content = versionCssUrls(css, (u) => hashes.get(u) ?? null);
      } else if (rel.endsWith(".js")) {
        content = rewriteJsonFetches(content.toString("utf8"));
      }
      const hash = await writeOutput(ctx, posix.join("public", rel), content);
      return { url: `/public/${rel}`, hash };
    },

    /**
     * A template with its `/public/` CSS and JS references bundled into one
     * file each; owns the bundles. The value is the rewritten template HTML,
     * whose bundle URLs carry `?v=<content hash>` — so it changes exactly when
     * a page using the template must be rewritten.
     */
    metaBundle: (templateName) => async (ctx) => {
      const templates = await ctx.get(nodeId("templates"));
      const t = templates[templateName];
      if (!t) throw new Error(`Template not found: "${templateName}"`);
      const templateHtml = typeof t === "string" ? t : t.html;
      const templateDir = typeof t === "string" ? meta : t.dir || meta;
      const assets = parseTemplateAssets(templateHtml);
      if (assets.cssFiles.length === 0 && assets.jsFiles.length === 0) return templateHtml;

      const metaAssets = await ctx.get(nodeId("metaAssets"));
      const urls = {};
      let cssOk = false;
      if (assets.cssFiles.length > 0) {
        const cssPaths = assets.cssFiles.map((p) => resolveMetaAssetPath(p, templateDir, meta)).filter(Boolean);
        if (cssPaths.length > 0) {
          let css = await bundleCssContent(cssPaths, { minify: true });
          const hashes = new Map();
          for (const u of collectCssUrls(css)) {
            const target = metaUrlToRel(u, "");
            if (target && !target.endsWith(".css") && metaAssets.byRel[target]) {
              hashes.set(u, (await ctx.get(nodeId("metaAsset", target))).hash);
            }
          }
          css = versionCssUrls(css, (u) => hashes.get(u) ?? null);
          const rel = `public/${templateName}.bundle.css`;
          const hash = await writeOutput(ctx, rel, css);
          urls.cssUrl = `/${rel}?v=${hash}`;
          cssOk = true;
        }
      }
      let jsOk = false;
      if (assets.jsFiles.length > 0) {
        const jsPaths = assets.jsFiles.map((p) => resolveMetaAssetPath(p, templateDir, meta)).filter(Boolean);
        if (jsPaths.length > 0) {
          const { success, code } = await bundleJsContent(jsPaths, { minify: true, minifySyntax: true });
          if (success) {
            const rel = `public/${templateName}.bundle.js`;
            const hash = await writeOutput(ctx, rel, rewriteJsonFetches(code));
            urls.jsUrl = `/${rel}?v=${hash}`;
            jsOk = true;
          }
        }
      }
      // Only rewrite the tags whose bundle exists; a JS syntax error keeps the
      // individual <script> tags so one broken file does not break them all
      const toRewrite = { ...assets, cssFiles: cssOk ? assets.cssFiles : [], jsFiles: jsOk ? assets.jsFiles : [] };
      return rewriteTemplateWithBundles(templateHtml, templateName, toRewrite, urls);
    },

    /** React + ReactDOM bundled for MDX hydration; a function of ursa's version only. */
    reactRuntime: () => async (ctx) => {
      ctx.constant("ursa-version");
      const result = await esbuild.build({
        stdin: {
          contents: `
            import React from 'react';
            import * as ReactDOM from 'react-dom';
            import { hydrateRoot, createRoot } from 'react-dom/client';
            import * as _jsx_runtime from 'react/jsx-runtime';
            window.React = React;
            window.ReactDOM = { ...ReactDOM, hydrateRoot, createRoot };
            window._jsx_runtime = _jsx_runtime;
            window.__ursaReactRuntime = ${JSON.stringify(REACT_RUNTIME_MARKER)};
          `,
          resolveDir: dirname(new URL(import.meta.url).pathname),
          loader: "js",
        },
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify: true,
        write: false,
      });
      const code = result.outputFiles[0].text;
      const hash = await writeOutput(ctx, "public/react-runtime.js", code);
      return { hash };
    },

    /**
     * Footer HTML. Build id, timestamp and git hash are fixed for the session
     * (§7) and excluded from the node's fingerprint (see `footerFingerprint`):
     * a new `generate` run must not rewrite every page just to stamp a new
     * build id into pages whose inputs did not change.
     */
    footer: () => async () =>
      getFooter(source + "/", source, env.session.buildId, { now: env.session.now, gitHash: env.session.gitHash }),

    /** Embedded in every JSON output. */
    ursaMetadata: () => async (ctx) => {
      ctx.constant("ursa-version");
      let docVersion = "unknown";
      for (const p of [join(source, "package.json"), join(dirname(source), "package.json")]) {
        if (ctx.exists(p)) {
          try {
            const pkg = JSON.parse(await ctx.read(p));
            if (pkg.version) {
              docVersion = pkg.version;
              break;
            }
          } catch {
            // try the next
          }
        }
      }
      return { ursaVersion: getUrsaVersion(), docVersion };
    },

    /** The auto-menu: full tree (owns menu-data.json) plus the root-level markup. */
    menuData: () => async (ctx) => {
      const set = await ctx.get(nodeId("documentSet"));
      const vp = await ctx.get(nodeId("validPaths"));
      await preloadFrontmatter(ctx, set.articles, { nonDocuments: set.files.filter((f) => !set.articleSet.has(f)) });
      const result = await getAutomenu(source, vp.map);
      if (!env.jsonOnly) await writeOutput(ctx, "public/menu-data.json", JSON.stringify(result.menuData));
      return { html: result.html, menuData: result.menuData };
    },

    /** Root-level menu markup inlined in every page; moves only when the root level changes. */
    menuHtml: () => async (ctx) => {
      const { html } = await ctx.get(nodeId("menuData"));
      return renderFile({ fileContents: html, type: ".md" });
    },

    /** Directories holding a custom menu file. */
    customMenus: () => async (ctx) => {
      const set = await ctx.get(nodeId("documentSet"));
      const dirs = new Set();
      for (const f of set.files) {
        if (MENU_FILE_NAMES.includes(basename(f))) dirs.add(dirRelOf(f));
      }
      return [...dirs].sort();
    },

    /** One custom menu's JSON. */
    customMenu: (menuDirRel) => async (ctx) => {
      const menuDir = abs(menuDirRel);
      const info = findCustomMenu(menuDir, source);
      if (!info || relOf(info.menuDir) !== menuDirRel) return null;
      const below = await ctx.get(nodeId("dirSet", menuDirRel));
      await preloadFrontmatter(ctx, below.articles, { nonDocuments: below.files.filter((f) => !isArticle(f)) });
      const { frontmatter, body } = extractMenuFrontmatter(info.content);
      const autoGenerate = frontmatter["auto-generate-menu"] === true || frontmatter["auto-generate-menu"] === "true";
      const menuPosition = frontmatter["menu-position"] || "top";
      const depth = parseInt(frontmatter["menu-depth"], 10) || 10;
      const menuData = autoGenerate
        ? combineAutoAndManualMenu(body, info.menuDir, source, depth)
        : parseCustomMenu(body, info.menuDir, source);
      const rel = `public/custom-menu-${menuId(menuDirRel)}.json`;
      const hash = env.jsonOnly ? null : await writeOutput(ctx, rel, JSON.stringify({ menuData, menuPosition }));
      return { url: "/" + rel, hash, menuPosition };
    },

    /** The custom menu a folder's pages use: the nearest menu file up the tree, or null. */
    customMenuFor: (dirRel) => async () => {
      const info = findCustomMenu(abs(dirRel), source);
      if (!info) return null;
      const { frontmatter } = extractMenuFrontmatter(info.content);
      const menuDirRel = relOf(info.menuDir);
      return {
        menuJsonPath: `/public/custom-menu-${menuId(menuDirRel)}.json`,
        menuDir: menuDirRel,
        menuPosition: frontmatter["menu-position"] || "top",
      };
    },

    /**
     * The folder's inherited stylesheets bundled into public/<folder>.bundle.css.
     * Value: {url} with `?v=<hash>`, or null when the chain is empty. The chain
     * is a set of recorded lookups, so adding a style.css anywhere above the
     * folder is observed.
     */
    cssBundle: (dirRel) => async (ctx) => {
      const paths = await findAllStyleCss(abs(dirRel), source);
      if (paths.length === 0) return null;
      let css = await bundleCssContent(paths, { minify: true, rebaseUrls: true, sourceDir: source });
      const hashes = new Map();
      for (const u of collectCssUrls(css)) {
        const hash = await assetHash(ctx, u);
        if (hash) hashes.set(u, hash);
      }
      css = versionCssUrls(css, (u) => hashes.get(u) ?? null);
      const rel = `public/${bundleName(dirRel)}.bundle.css`;
      const hash = await writeOutput(ctx, rel, css);
      return { url: `/${rel}?v=${hash}` };
    },

    jsBundle: (dirRel) => async (ctx) => {
      const paths = await findAllScriptJs(abs(dirRel), source);
      if (paths.length === 0) return null;
      const { success, code } = await bundleJsContent(paths, { minify: true, minifySyntax: true });
      if (!success) return null;
      const rel = `public/${bundleName(dirRel)}.bundle.js`;
      const hash = await writeOutput(ctx, rel, rewriteJsonFetches(code));
      return { url: `/${rel}?v=${hash}` };
    },

    /**
     * Cheap facts about an image: content hash, URLs, whether a preview will
     * exist. Null when the file is absent — the miss is recorded, so a dead
     * image link comes alive when the file appears (§8.4).
     */
    imageInfo: (rel) => async (ctx) => {
      const path = abs(rel);
      if (!isImageExtension(extname(rel))) return null;
      if (!ctx.exists(path)) return null;
      if (isFolderHidden(dirname(path), source) || isHiddenOrSystemPath(path, source)) return null;
      const buf = await ctx.read(path, null);
      const hash = hashBytes(buf);
      const preview = await willHavePreview(path);
      const original = urlOf(rel);
      return {
        original,
        preview: preview ? urlOf(posix.join(dirRelOf(rel), getPreviewFilename(basename(rel)))) : original,
        willPreview: preview,
        hash,
      };
    },

    /** The original image copied through. */
    imageCopy: (rel) => async (ctx) => {
      const info = await ctx.get(nodeId("imageInfo", rel));
      if (!info) return null;
      const hash = await writeOutput(ctx, rel, await ctx.read(abs(rel), null));
      return { hash };
    },

    /** The WebP preview (expensive; scheduled after pages). */
    imagePreview: (rel) => async (ctx) => {
      const info = await ctx.get(nodeId("imageInfo", rel));
      if (!info || !info.willPreview) return null;
      const buf = await renderPreview(abs(rel));
      if (!buf) return null;
      const hash = await writeOutput(ctx, info.preview.replace(/^\//, ""), buf);
      return { hash };
    },

    /** Fonts, audio, video, PDFs, archives: copied through. */
    staticAsset: (rel) => async (ctx) => {
      const path = abs(rel);
      if (!ctx.exists(path)) return null;
      if (isFolderHidden(dirname(path), source) || isHiddenOrSystemPath(path, source)) return null;
      const buf = await ctx.read(path, null);
      const hash = await writeOutput(ctx, rel, buf);
      return { url: urlOf(rel), hash };
    },

    // ----- Per document ----------------------------------------------------

    /** Frontmatter projection: a body edit leaves it unchanged. */
    docMeta: (rel) => async (ctx) => {
      const raw = await ctx.read(abs(rel));
      let meta = null;
      try {
        meta = extractMetadata(raw);
      } catch (e) {
        warn(`frontmatter:${rel}`, `⚠️  ${rel}: could not parse frontmatter: ${e.message}`);
      }
      return {
        meta,
        isMetadataOnly: /\.(md|mdx)$/i.test(rel) && isMetadataOnly(raw),
        autoIndex: getAutoIndexConfig(meta),
        template: meta?.template || null,
        hydrate: meta?.hydrate === true,
      };
    },

    /** Rendered body HTML (plus hydration script), before the template. */
    bodyHtml: (rel) => async (ctx) => {
      const path = abs(rel);
      const raw = await ctx.read(path);
      const type = extname(rel);
      const base = basename(rel, type);
      const dir = dirWithSlash(rel);
      let meta = null;
      try {
        meta = extractMetadata(raw);
      } catch {
        meta = null;
      }
      const title = titleOf(rel);
      const shouldHydrate = type === ".mdx" && meta?.hydrate === true;

      const renderResult = await renderFileAsync({
        fileContents: raw,
        type,
        dirname: dir,
        basename: base,
        filePath: path,
        sourceRoot: source,
        useWorker: true,
        hydrate: shouldHydrate,
      });
      let body;
      let hydrationScript = "";
      if (typeof renderResult === "object" && renderResult !== null) {
        body = renderResult.html;
        hydrationScript = renderResult.hydrationScript || "";
        // Every module esbuild loaded is an input of this document
        for (const input of renderResult.inputs ?? []) {
          try {
            await ctx.read(input, null);
          } catch {
            // recorded as missing; a later creation re-renders
          }
        }
        if (renderResult.failed) {
          // Resolution failed somewhere: watch the folders an import could
          // appear in so creating the missing component re-renders this page
          await ctx.listDir(dirname(path));
          for (const d of renderResult.componentDirs ?? []) await ctx.listDir(d);
        }
      } else {
        body = renderResult;
      }

      // Inject default H1 if body doesn't start with one
      if (!body || !body.trimStart().startsWith("<h1")) {
        const h1Title = meta?.title || title;
        body = `<h1>${h1Title}</h1>\n` + (body || "");
      }

      // Breadcrumbs before the H1 (folder labels come from docMeta projections)
      await preloadFrontmatter(ctx, ancestorIndexDocs(ctx, dirRelOf(rel)));
      const breadcrumbs = generateBreadcrumbs(dir, base, meta, source);
      if (breadcrumbs) body = breadcrumbs + body;

      // Frontmatter table after the first H1 (markdown only)
      if ((type === ".md" || type === ".mdx") && meta) {
        body = injectFrontmatterTable(body, meta);
      }

      // `generate-auto-index: true` renders a listing of the folder's source tree
      const autoIndexConfig = getAutoIndexConfig(meta);
      if (base === "index" && meta && autoIndexConfig.enabled) {
        await preloadFrontmatter(ctx, await docsBelow(ctx, dirRelOf(rel), autoIndexConfig.depth + 1));
        const autoIndexHtml = await generateAutoIndexHtmlFromSource(dirname(path), autoIndexConfig.depth);
        if (autoIndexHtml) {
          body = autoIndexConfig.position === "bottom" ? body + "\n" + autoIndexHtml : autoIndexHtml + "\n" + body;
        }
      }

      return { body, hydrationScript, meta, title, type, base, dir };
    },

    /**
     * The page: owns `<path>.html`, and the folder's `index.html` too when this
     * document is the folder's index by promotion (§8.3). Writes nothing when
     * another source owns its output path (§8.2).
     */
    pageHtml: (rel) => async (ctx) => {
      if (env.jsonOnly) return null;
      const outRel = outputPathFor(rel);
      const owner = await ctx.get(nodeId("outputOwner", outRel));
      if (owner !== rel) {
        if (owner && owner !== AUTO_INDEX) {
          warn(`shadow:${outRel}`, `⚠️  ${rel} is not rendered: ${outRel} is produced by ${owner}`);
        }
        return { shadowedBy: owner };
      }
      const rendered = await ctx.get(nodeId("bodyHtml", rel));
      const { body, hydrationScript, meta, title } = rendered;
      const dirRel = dirRelOf(rel);
      const docUrlPath = "/" + outRel;
      const templateName = meta?.template || DEFAULT_TEMPLATE_NAME;

      // Lazy: only load transformMetadata.js when the template uses it
      const templates = await ctx.get(nodeId("templates"));
      const templateHtml = templates[templateName]?.html ?? templates[templateName] ?? "";
      const transformedMetadata = templateHtml.includes("${transformedMetadata}")
        ? await getTransformedMetadata(dirname(abs(rel)), meta)
        : "";

      const { html, images } = await assemblePage(ctx, {
        templateName,
        dirRel,
        docUrlPath,
        title: meta?.title || title,
        meta: JSON.stringify(meta),
        body,
        transformedMetadata,
        hydrationScript,
      });
      const hash = await writeOutput(ctx, outRel, html);

      // Folder-index promotion: also serve as <dir>/index.html when this document owns it
      let promotedTo = null;
      if (isIndexCandidate(rel)) {
        const idxRel = indexOutputFor(dirRel);
        if (idxRel !== outRel && (await ctx.get(nodeId("outputOwner", idxRel))) === rel) {
          await writeOutput(ctx, idxRel, html);
          promotedTo = idxRel;
        }
      }
      return { hash, out: outRel, promotedTo, images, template: templateName };
    },

    /** The document's .json (and .xml) beside its page. */
    docData: (rel) => async (ctx) => {
      const outRel = outputPathFor(rel);
      const owner = await ctx.get(nodeId("outputOwner", outRel));
      if (owner !== rel) return { shadowedBy: owner };
      const raw = await ctx.read(abs(rel));
      const { body, meta, base } = await ctx.get(nodeId("bodyHtml", rel));
      const type = extname(rel);
      const sections = type === ".md" || type === ".mdx" ? extractSections(raw) : [];
      const transformedMetadata = await getTransformedMetadata(dirname(abs(rel)), meta);
      const ursaMetadata = await ctx.get(nodeId("ursaMetadata"));
      const jsonObject = {
        name: base,
        url: "/" + outRel,
        contents: raw,
        bodyHtml: body,
        metadata: meta,
        sections,
        transformedMetadata,
        _ursa_metadata: ursaMetadata,
      };
      const jsonRel = outRel.replace(/\.html$/, ".json");
      const xmlRel = outRel.replace(/\.html$/, ".xml");
      const hash = await writeOutput(ctx, jsonRel, JSON.stringify(jsonObject));
      // The mode is an input: a full build after a JSON-only one must write the XML
      if (ctx.constant("json-only") !== "true") {
        await writeOutput(ctx, xmlRel, `<article>${o2x(jsonObject)}</article>`);
      } else if (existsSync(outAbs(xmlRel))) {
        ctx.own(xmlRel); // a full build's XML is left in place, not orphaned
      }
      return { hash };
    },

    /** Per-document word counts for the full-text index. */
    docWords: (rel) => async (ctx) => {
      const raw = await ctx.read(abs(rel));
      return documentWordCounts({ title: titleOf(rel), content: raw });
    },

    /** A hand-written .html copied through with link processing. */
    htmlPassthrough: (rel) => async (ctx) => {
      if (env.jsonOnly) return null;
      let html = await ctx.read(abs(rel));
      const docUrlPath = "/" + rel;
      html = resolveRelativeUrls(html, docUrlPath);
      html = await resolveLinks(ctx, html, docUrlPath);
      const finished = await finishAssets(ctx, html, docUrlPath);
      const hash = await writeOutput(ctx, rel, finished.html);
      return { hash, images: finished.images };
    },

    // ----- Per directory ---------------------------------------------------

    /**
     * Which source produces an output path, by the precedence list. Returns
     * the winning source (docroot-relative), AUTO_INDEX for a folder index
     * nobody claims, or null.
     */
    outputOwner: (outRel) => async (ctx) => {
      const set = await ctx.get(nodeId("documentSet"));
      for (const candidate of candidatesForOutput(outRel)) {
        if (candidate === AUTO_INDEX) return AUTO_INDEX;
        if (set.htmlSet.has(candidate)) return candidate;
        if (set.articleSet.has(candidate)) {
          // A frontmatter-only index supplies the folder's label; the auto-index is still the page
          if (isIndexBasename(basename(candidate, extname(candidate)))) {
            const info = await ctx.get(nodeId("docMeta", candidate));
            if (info.isMetadataOnly) continue;
          }
          return candidate;
        }
      }
      return null;
    },

    /**
     * The document set restricted to one folder's subtree. A projection: it
     * changes only when something under that folder is added, removed or
     * renamed, so a document added elsewhere does not reach the folder's
     * listings.
     */
    dirSet: (dirRel) => async (ctx) => {
      const set = await ctx.get(nodeId("documentSet"));
      const prefix = dirRel ? dirRel + "/" : "";
      const under = (list) => list.filter((f) => f.startsWith(prefix));
      return { files: under(set.files), articles: under(set.articles), html: under(set.html), dirs: under(set.dirs) };
    },

    /** `<dir>.json`: the folder's records, recursively. */
    dirIndexJson: (dirRel) => async (ctx) => {
      if (!dirRel) return null;
      const below = await ctx.get(nodeId("dirSet", dirRel));
      const records = [];
      for (const d of below.articles) {
        const outRel = outputPathFor(d);
        if ((await ctx.get(nodeId("outputOwner", outRel))) !== d) continue;
        const info = await ctx.get(nodeId("docMeta", d));
        records.push({ name: basename(d, extname(d)), url: "/" + outRel, metadata: info.meta });
      }
      const hash = await writeOutput(ctx, `${dirRel}.json`, JSON.stringify(records));
      return { hash };
    },

    /** `<dir>.html`: a plain listing page, only when no document owns that path. */
    dirListingHtml: (dirRel) => async (ctx) => {
      if (!dirRel || env.jsonOnly) return null;
      const outRel = `${dirRel}.html`;
      const owner = await ctx.get(nodeId("outputOwner", outRel));
      if (owner) return { ownedBy: owner };
      const below = await ctx.get(nodeId("dirSet", dirRel));
      const items = below.files
        .map((f) => {
          const ext = extname(f);
          const href = "/" + (ext ? f.slice(0, -ext.length) : f) + ".html";
          return `<li><a href="${href}">${basename(f, ext)}</a></li>`;
        });
      const body = `<ul>${items.join("")}</ul>`;
      const { html } = await assemblePage(ctx, {
        templateName: DEFAULT_TEMPLATE_NAME,
        dirRel: dirRelOf(dirRel),
        docUrlPath: "/" + outRel,
        title: "Index",
        meta: "{}",
        body,
        useFolderAssets: false,
      });
      const hash = await writeOutput(ctx, outRel, html);
      return { hash };
    },

    /** The generated index.html for a folder no document claims. */
    autoIndexPage: (dirRel) => async (ctx) => {
      if (env.jsonOnly) return null;
      const idxRel = indexOutputFor(dirRel);
      const owner = await ctx.get(nodeId("outputOwner", idxRel));
      if (owner !== AUTO_INDEX) return { ownedBy: owner };
      const dirAbs = abs(dirRel);
      await preloadFrontmatter(ctx, await indexDocsAround(ctx, dirRel));
      const listing = await generateAutoIndexHtmlFromSource(dirAbs, 1);
      if (!listing) return { empty: true };

      const folderName = basename(dirAbs);
      const folderDisplayName = dirRel ? getFolderLabel(dirAbs, getFolderConfig(dirAbs), folderName) : "Home";
      await preloadFrontmatter(ctx, ancestorIndexDocs(ctx, dirRel));
      const breadcrumbHtml = generateBreadcrumbs(dirRel ? dirRel + "/" : "/", "index", null, source);
      const body = `${breadcrumbHtml}<h1>${folderDisplayName}</h1>\n${listing}`;
      const { html } = await assemblePage(ctx, {
        templateName: DEFAULT_TEMPLATE_NAME,
        dirRel,
        docUrlPath: "/" + idxRel,
        title: folderDisplayName,
        meta: "{}",
        body,
      });
      const hash = await writeOutput(ctx, idxRel, html);
      return { hash };
    },

    // ----- Aggregates ------------------------------------------------------

    searchIndex: () => async (ctx) => {
      const set = await ctx.get(nodeId("documentSet"));
      const entries = [];
      for (const d of set.articles) {
        const outRel = outputPathFor(d);
        if ((await ctx.get(nodeId("outputOwner", outRel))) !== d) continue;
        entries.push({ title: titleOf(d), path: outRel, url: "/" + outRel, content: "" });
      }
      const hash = await writeOutput(ctx, "public/search-index.json", JSON.stringify(entries));
      return { hash, entries: entries.length };
    },

    fullTextIndex: () => async (ctx) => {
      const set = await ctx.get(nodeId("documentSet"));
      const docs = [];
      for (const d of set.articles) {
        const outRel = outputPathFor(d);
        if ((await ctx.get(nodeId("outputOwner", outRel))) !== d) continue;
        docs.push({ path: "/" + outRel, counts: await ctx.get(nodeId("docWords", d)) });
      }
      const index = mergeWordCounts(docs);
      const hash = await writeOutput(ctx, "public/fulltext-index.json", JSON.stringify(index));
      return { hash, words: Object.keys(index).length };
    },

    /** Ten most recently edited documents, dated from git (or mtime). */
    recentActivity: () => async (ctx) => {
      const set = await ctx.get(nodeId("documentSet"));
      // Content changes are what move a document's date, so depend on each file
      const docs = [];
      for (const d of set.articles) {
        const outRel = outputPathFor(d);
        if ((await ctx.get(nodeId("outputOwner", outRel))) !== d) continue;
        await ctx.read(abs(d), null);
        docs.push(d);
      }
      const timestamps = await buildSourceTimestampIndex(source, { log: (m) => log(m) });
      const entries = [];
      for (const d of docs) {
        entries.push({ title: titleOf(d), url: "/" + outputPathFor(d), mtime: await timestamps.get(abs(d)) });
      }
      entries.sort((a, b) => b.mtime - a.mtime || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
      const top10 = entries.slice(0, 10);
      const hash = await writeOutput(ctx, "public/recent-activity.json", JSON.stringify(top10));
      return { hash };
    },
  };

  /** Per-family value fingerprints where the default (hash of the value) is wrong. */
  const fingerprints = {
    footer: footerFingerprint,
  };

  return {
    /** Graph resolver: node id → definition. */
    resolve(id) {
      const { kind, key } = parseNodeId(id);
      const family = families[kind];
      if (!family) return null;
      return { fn: family(key), fingerprint: fingerprints[kind] };
    },
    families: Object.keys(families),
  };
}

/**
 * The footer without its per-session build metadata line and git comment.
 * Only the parts that are functions of the source tree (footer.md, the doc
 * package.json) count as a change.
 */
export function footerFingerprint(html) {
  const stable = String(html ?? "")
    .replace(/<div class="footer-meta">[\s\S]*?<\/div>/, "")
    .replace(/<!-- git: [^>]*-->/, "");
  return hashBytes(stable);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Sets for membership tests, attached non-enumerably so they stay out of the fingerprint. */
function attachSets(set) {
  const define = (name, arr) => Object.defineProperty(set, name, { value: new Set(arr), enumerable: false });
  define("articleSet", set.articles);
  define("htmlSet", set.html);
  define("imageSet", set.images);
  define("mediaSet", set.media);
  define("dirSet", set.dirs);
  define("fileSet", set.files);
  return set;
}

function bundleName(dirRel) {
  return dirRel.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "root";
}

function menuId(menuDirRel) {
  if (!menuDirRel) return "root";
  return menuDirRel.replace(/[\/\\]/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
}

/** Every url() target in a stylesheet (raw, as written). */
function collectCssUrls(css) {
  const out = new Set();
  const re = /url\(\s*(['"]?)(?!data:)([^'"\)]+?)\1\s*\)/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    if (!m[2].includes("?") && !m[2].startsWith("#")) out.add(m[2]);
  }
  return [...out];
}

/**
 * A url() written in meta CSS → the public-relative asset it names, or null
 * for anything external. `/public/x` is x; a relative path resolves against
 * the stylesheet's own public-relative directory (bundles live at the root).
 */
function metaUrlToRel(url, cssDirRel) {
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:")) return null;
  if (url.startsWith("/public/")) return url.slice("/public/".length);
  if (url.startsWith("/")) return null;
  return posix.normalize(posix.join(cssDirRel || "", url));
}

