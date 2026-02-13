/**
 * Asset bundler for Ursa static site generator.
 *
 * Handles two categories of bundling:
 *
 * 1. **Meta template assets**: Bundles all CSS and JS referenced by a template
 *    into a single CSS file and a single JS file per template.
 *
 * 2. **Document assets**: Bundles inherited style.css and script.js files.
 *    - In generate mode: produces a single bundle per folder path.
 *    - In serve mode: returns separate tags for each level (for easy invalidation).
 */

import * as esbuild from "esbuild";
import { join, dirname, basename, relative, resolve } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { outputFile } from "fs-extra";

// Cache for meta bundles so we don't rebuild them per-document
const metaBundleCache = new Map();

/**
 * Parse a template HTML string to extract local CSS and JS asset references.
 * Only extracts assets served from /public/ (meta assets). Ignores CDN URLs,
 * inline scripts, and placeholder variables like ${styleLink}.
 *
 * @param {string} templateHtml - Raw template HTML content
 * @returns {{ cssFiles: string[], jsFiles: string[], cdnCss: string[], cdnJs: string[] }}
 */
export function parseTemplateAssets(templateHtml) {
  const cssFiles = [];
  const jsFiles = [];
  const cdnCss = [];
  const cdnJs = [];

  // Match <link rel="stylesheet" href="..."> tags
  const cssPattern = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*\/?>/gi;
  let match;
  while ((match = cssPattern.exec(templateHtml)) !== null) {
    const href = match[1];
    if (href.startsWith("http://") || href.startsWith("https://")) {
      cdnCss.push(match[0]); // Keep full tag for CDN resources
    } else if (href.startsWith("/public/")) {
      cssFiles.push(href);
    }
    // Skip template variables like ${styleLink}
  }

  // Match <script src="..."> tags
  const jsPattern = /<script\s+src=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  while ((match = jsPattern.exec(templateHtml)) !== null) {
    const src = match[1];
    if (src.startsWith("http://") || src.startsWith("https://")) {
      cdnJs.push(match[0]); // Keep full tag for CDN resources
    } else if (src.startsWith("/public/")) {
      jsFiles.push(src);
    }
  }

  return { cssFiles, jsFiles, cdnCss, cdnJs };
}

/**
 * Rewrite a template to replace individual CSS/JS asset tags with bundled references.
 * Preserves CDN links, inline scripts, and template placeholders.
 *
 * @param {string} templateHtml - Original template HTML
 * @param {string} templateName - Template name (used for bundle filename)
 * @param {{ cssFiles: string[], jsFiles: string[], cdnCss: string[], cdnJs: string[] }} assets - Parsed assets
 * @returns {string} Rewritten template HTML
 */
export function rewriteTemplateWithBundles(templateHtml, templateName, assets) {
  let html = templateHtml;

  // Replace individual CSS <link> tags with a single bundle reference
  if (assets.cssFiles.length > 0) {
    // Remove all individual public CSS <link> tags
    for (const href of assets.cssFiles) {
      // Escape special regex characters in href
      const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(
        `\\s*<link[^>]+href=["']${escaped}["'][^>]*\\/?>\\s*`,
        "gi"
      );
      html = html.replace(pattern, "\n");
    }
    // Insert single bundle link where the first CSS link was (in <head>)
    const bundleCssTag = `    <link rel="stylesheet" href="/public/${templateName}.bundle.css" />`;
    // Insert after the last CDN CSS or at the position of the first removed tag
    // Best heuristic: insert right before ${styleLink} or before </head>
    if (html.includes("${styleLink}")) {
      html = html.replace("${styleLink}", bundleCssTag + "\n    ${styleLink}");
    } else {
      html = html.replace("</head>", bundleCssTag + "\n</head>");
    }
  }

  // Replace individual JS <script src="/public/..."> tags with a single bundle reference
  if (assets.jsFiles.length > 0) {
    for (const src of assets.jsFiles) {
      const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(
        `\\s*<script\\s+src=["']${escaped}["'][^>]*>\\s*<\\/script>\\s*`,
        "gi"
      );
      html = html.replace(pattern, "\n");
    }
    // Insert single bundle script before ${customScript} or before </body>
    const bundleJsTag = `    <script src="/public/${templateName}.bundle.js"></script>`;
    if (html.includes("${customScript}")) {
      html = html.replace("${customScript}", bundleJsTag + "\n    ${customScript}");
    } else {
      html = html.replace("</body>", bundleJsTag + "\n</body>");
    }
  }

  // Clean up any runs of multiple blank lines
  html = html.replace(/\n{3,}/g, "\n\n");

  return html;
}

/**
 * Separate @import rules from other CSS content.
 * CSS spec requires @import rules to appear before any other rules.
 *
 * @param {string} css - CSS content
 * @returns {{ importRules: string[], otherContent: string }}
 */
function separateImports(css) {
  const importRules = [];
  // Match @import url(...) and @import "..." rules (possibly multiline with media queries)
  const importPattern = /^@import\s+(?:url\([^)]*\)|["'][^"']*["'])[^;]*;/gm;
  const otherContent = css.replace(importPattern, (match) => {
    importRules.push(match.trim());
    return "";
  });
  return { importRules, otherContent: otherContent.trim() };
}

/**
 * Rewrite relative url() references in CSS to be root-relative (site-absolute).
 * Preserves absolute URLs, data URIs, protocol-relative URLs, and already-root-relative URLs.
 *
 * @param {string} css - CSS content
 * @param {string} cssFileDir - Absolute directory of the CSS file
 * @param {string} sourceDir - Absolute source/docroot directory
 * @returns {string} CSS with rebased url() references
 */
function rebaseCssUrls(css, cssFileDir, sourceDir) {
  // Normalize sourceDir (strip trailing slash for consistent path math)
  const normalizedSource = resolve(sourceDir);
  // Compute the CSS file's site-relative directory, e.g. "campaigns/abs"
  const relDir = relative(normalizedSource, resolve(cssFileDir));
  // Site-absolute prefix, e.g. "/campaigns/abs/"
  const sitePrefix = relDir ? "/" + relDir.replace(/\\/g, "/") + "/" : "/";

  // Replace url() values that are relative paths
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, url) => {
    // Skip absolute URLs, data URIs, protocol-relative, and already root-relative
    if (
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("data:") ||
      url.startsWith("//") ||
      url.startsWith("/") ||
      url.startsWith("#")
    ) {
      return match;
    }
    // Resolve the relative URL against the CSS file's site directory
    // Use URL API for proper relative path resolution (handles ../ etc.)
    try {
      const resolved = new URL(url, "http://x" + sitePrefix).pathname;
      return `url(${quote}${resolved}${quote})`;
    } catch {
      return match; // If URL parsing fails, leave it unchanged
    }
  });
}

/**
 * Bundle CSS files together. Reads and concatenates all files, then minifies
 * with esbuild's transform API. Falls back to unminified concatenation on failure.
 *
 * @param {string[]} filePaths - Absolute paths to CSS files to bundle
 * @param {string} outputPath - Where to write the bundle
 * @param {{ minify: boolean, rebaseUrls: boolean, sourceDir: string }} options
 *   - rebaseUrls: if true, rewrite relative url() refs to root-relative paths
 *   - sourceDir: required when rebaseUrls is true; the source/docroot directory
 */
export async function bundleCss(filePaths, outputPath, { minify = true, rebaseUrls = false, sourceDir = "" } = {}) {
  if (filePaths.length === 0) return;

  const allImports = [];
  const allRules = [];

  for (const f of filePaths) {
    let css = await readFile(f, "utf8");

    // Rebase relative url() paths so they work from the bundle's output location
    if (rebaseUrls && sourceDir) {
      css = rebaseCssUrls(css, dirname(f), sourceDir);
    }

    // Extract @import rules (must be at top of final bundle per CSS spec)
    const { importRules, otherContent } = separateImports(css);
    allImports.push(...importRules);
    if (otherContent) {
      allRules.push(otherContent);
    }
  }

  // Deduplicate @import rules (same import from multiple files)
  const uniqueImports = [...new Set(allImports)];
  const combined =
    (uniqueImports.length > 0 ? uniqueImports.join("\n") + "\n\n" : "") +
    allRules.join("\n\n");

  if (minify) {
    try {
      const result = await esbuild.transform(combined, {
        loader: "css",
        minify: true,
      });
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, result.code);
      return;
    } catch (e) {
      console.warn(`⚠️  CSS minification failed, using unminified bundle: ${e.message}`);
    }
  }

  // Fallback: write raw concatenated CSS
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, combined);
}

/**
 * Bundle JS files together. Concatenates all files and optionally minifies.
 * Uses esbuild's transform API for minification (doesn't require valid module syntax).
 * Falls back to raw concatenation if minification fails (e.g., non-standard syntax).
 * If the concatenated code has syntax errors, returns { success: false } so callers
 * can fall back to individual <script> tags.
 *
 * @param {string[]} filePaths - Absolute paths to JS files to bundle
 * @param {string} outputPath - Where to write the bundle
 * @param {{ minify: boolean, minifySyntax: boolean }} options
 * @returns {Promise<{ success: boolean }>}
 */
export async function bundleJs(filePaths, outputPath, { minify = true, minifySyntax = true } = {}) {
  if (filePaths.length === 0) return { success: false };

  // Concatenate all JS files with separators
  const contents = [];
  for (const f of filePaths) {
    const code = await readFile(f, "utf8");
    contents.push(`// --- ${basename(f)} ---\n${code}`);
  }
  const combined = contents.join("\n\n");

  if (minify) {
    try {
      // Use transform API (not build) — it minifies the code without trying to resolve imports
      const result = await esbuild.transform(combined, {
        loader: "js",
        minify: true,
        minifySyntax,
      });
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, result.code);
      return { success: true };
    } catch (e) {
      // If minification fails (e.g., non-standard syntax), fall back to raw concatenation
      console.warn(`⚠️  JS minification failed, trying unminified bundle: ${e.message}`);
    }
  }

  // Validate that the concatenated code has no syntax errors before writing.
  // A syntax error in any one file (e.g., toc.js) would prevent ALL scripts from
  // executing when loaded as a single bundle, so it's better to keep individual tags.
  try {
    await esbuild.transform(combined, { loader: "js" });
  } catch (e) {
    console.warn(`⚠️  JS bundle has syntax errors, keeping individual script tags: ${e.message}`);
    return { success: false };
  }

  // Write raw concatenated code (syntax-valid but unminified)
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, combined);
  return { success: true };
}

/**
 * Bundle all meta template assets. For each template, parse its CSS/JS references,
 * bundle them into single files, and rewrite the template to use the bundles.
 *
 * @param {Object} templates - Map of templateName → { html, dir } or templateHtml (legacy)
 * @param {string} metaDir - Absolute path to the meta directory
 * @param {string} outputPublicDir - Absolute path to output/public
 * @param {{ minify: boolean, sourcemap: boolean }} options
 * @returns {Promise<Object>} Rewritten templates map (same format as input)
 */
export async function bundleMetaTemplateAssets(templates, metaDir, outputPublicDir, { minify = true, sourcemap = false } = {}) {
  const rewrittenTemplates = {};

  for (const [templateName, templateData] of Object.entries(templates)) {
    // Support both new { html, dir } format and legacy string format
    const templateHtml = typeof templateData === 'string' ? templateData : templateData.html;
    const templateDir = typeof templateData === 'string' ? metaDir : (templateData.dir || metaDir);
    
    const assets = parseTemplateAssets(templateHtml);

    // If the template has no bundleable assets, keep it as-is
    if (assets.cssFiles.length === 0 && assets.jsFiles.length === 0) {
      rewrittenTemplates[templateName] = templateHtml;
      continue;
    }

    // Check cache
    const cacheKey = `${templateName}:${assets.cssFiles.join(",")}:${assets.jsFiles.join(",")}`;
    if (metaBundleCache.has(cacheKey)) {
      rewrittenTemplates[templateName] = metaBundleCache.get(cacheKey);
      continue;
    }

    // Resolve /public/foo.js → templateDir/foo.js (assets are in template folder)
    // Falls back to metaDir for shared assets
    const resolvePublicPath = (publicPath) => {
      // /public/foo.js → foo.js
      const relativePath = publicPath.replace(/^\/public\//, "");
      // First try template-specific path
      const templatePath = resolve(templateDir, relativePath);
      if (existsSync(templatePath)) {
        return templatePath;
      }
      // Fall back to shared folder
      const sharedPath = resolve(metaDir, 'shared', relativePath);
      if (existsSync(sharedPath)) {
        return sharedPath;
      }
      // Legacy fallback: direct meta path
      return resolve(metaDir, relativePath);
    };

    // Bundle CSS
    if (assets.cssFiles.length > 0) {
      const cssPaths = assets.cssFiles.map(resolvePublicPath).filter(existsSync);
      if (cssPaths.length > 0) {
        const cssOutputPath = join(outputPublicDir, `${templateName}.bundle.css`);
        await bundleCss(cssPaths, cssOutputPath, { minify });
      }
    }

    // Bundle JS
    let jsBundleSuccess = false;
    if (assets.jsFiles.length > 0) {
      const jsPaths = assets.jsFiles.map(resolvePublicPath).filter(existsSync);
      if (jsPaths.length > 0) {
        const jsOutputPath = join(outputPublicDir, `${templateName}.bundle.js`);
        const result = await bundleJs(jsPaths, jsOutputPath, { minify, minifySyntax: minify });
        jsBundleSuccess = result.success;
      }
    }

    // Rewrite template to reference bundles (only rewrite JS if bundling succeeded;
    // if it failed due to syntax errors, keep individual script tags so each script
    // loads independently and a syntax error in one doesn't break all of them)
    const assetsToRewrite = jsBundleSuccess
      ? assets
      : { ...assets, jsFiles: [] }; // empty jsFiles = don't rewrite JS tags
    const rewritten = rewriteTemplateWithBundles(templateHtml, templateName, assetsToRewrite);
    rewrittenTemplates[templateName] = rewritten;
    metaBundleCache.set(cacheKey, rewritten);
  }

  return rewrittenTemplates;
}

/**
 * Bundle document-level CSS files for a given folder path into a single bundle.
 * Used in generate mode.
 *
 * @param {string[]} cssPaths - Absolute paths to CSS files (ordered shallowest to deepest)
 * @param {string} outputDir - Output directory root
 * @param {string} sourceDir - Source directory root
 * @param {string} folderKey - Folder identifier for naming the bundle (e.g. "campaigns/abs")
 * @param {{ minify: boolean }} options
 * @returns {Promise<string>} URL path to the bundled CSS file
 */
export async function bundleDocumentCss(cssPaths, outputDir, sourceDir, folderKey, { minify = true } = {}) {
  if (cssPaths.length === 0) return "";

  // Create a deterministic bundle filename from the folder path
  const safeName = folderKey.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "root";
  const bundleFilename = `${safeName}.bundle.css`;
  const bundleOutputPath = join(outputDir, "public", bundleFilename);

  // Rebase relative url() paths because the bundle lives in /public/
  // while the original CSS files may be in nested directories
  await bundleCss(cssPaths, bundleOutputPath, { minify, rebaseUrls: true, sourceDir });

  return `/public/${bundleFilename}`;
}

/**
 * Bundle document-level JS files for a given folder path into a single bundle.
 * Used in generate mode.
 *
 * @param {string[]} jsPaths - Absolute paths to JS files (ordered shallowest to deepest)
 * @param {string} outputDir - Output directory root
 * @param {string} sourceDir - Source directory root
 * @param {string} folderKey - Folder identifier for naming the bundle
 * @param {{ minify: boolean }} options
 * @returns {Promise<string>} URL path to the bundled JS file
 */
export async function bundleDocumentJs(jsPaths, outputDir, sourceDir, folderKey, { minify = true } = {}) {
  if (jsPaths.length === 0) return "";

  const safeName = folderKey.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "root";
  const bundleFilename = `${safeName}.bundle.js`;
  const bundleOutputPath = join(outputDir, "public", bundleFilename);

  const result = await bundleJs(jsPaths, bundleOutputPath, { minify, minifySyntax: minify });
  if (!result.success) return ""; // Caller should fall back to individual script tags

  return `/public/${bundleFilename}`;
}

/**
 * Generate separate <link> tags for each document-level CSS file.
 * Used in serve mode where individual file invalidation is important.
 *
 * @param {string[]} cssPaths - Absolute paths to CSS files (ordered shallowest to deepest)
 * @param {string} sourceDir - Source directory root (with trailing slash)
 * @returns {string} HTML string with one <link> tag per CSS file
 */
export function generateSeparateCssTags(cssPaths, sourceDir) {
  return cssPaths
    .map((cssPath) => {
      const cssUrlPath = "/" + cssPath.replace(sourceDir, "");
      return `<link rel="stylesheet" href="${cssUrlPath}" />`;
    })
    .join("\n    ");
}

/**
 * Generate separate <script> tags for each document-level JS file (external, not inlined).
 * Used in serve mode where individual file invalidation is important.
 *
 * @param {string[]} jsPaths - Absolute paths to JS files (ordered shallowest to deepest)
 * @param {string} sourceDir - Source directory root (with trailing slash)
 * @returns {string} HTML string with one <script> tag per JS file
 */
export function generateSeparateJsTags(jsPaths, sourceDir) {
  return jsPaths
    .map((jsPath) => {
      const jsUrlPath = "/" + jsPath.replace(sourceDir, "");
      return `<script src="${jsUrlPath}"></script>`;
    })
    .join("\n    ");
}

/**
 * Clear the meta bundle cache. Should be called when meta files change.
 */
export function clearMetaBundleCache() {
  metaBundleCache.clear();
}
