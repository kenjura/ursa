import { recurse } from "../helper/recursive-readdir.js";

import { copyFile, mkdir, readdir, readFile, stat } from "fs/promises";

// Concurrency limiter for batch processing to avoid memory exhaustion
const BATCH_SIZE = parseInt(process.env.URSA_BATCH_SIZE || '50', 10);

/**
 * Cache for watch mode - stores expensive data that doesn't change often
 * This allows single-file regeneration to skip re-building menu, templates, etc.
 */
const watchModeCache = {
  templates: null,
  menu: null,
  footer: null,
  validPaths: null,
  source: null,
  meta: null,
  output: null,
  hashCache: null,
  lastFullBuild: 0,
  isInitialized: false,
};

/**
 * Clear the watch mode cache (call when templates/meta/config change)
 */
export function clearWatchCache() {
  watchModeCache.templates = null;
  watchModeCache.menu = null;
  watchModeCache.footer = null;
  watchModeCache.validPaths = null;
  watchModeCache.hashCache = null;
  watchModeCache.isInitialized = false;
  cssPathCache.clear(); // Also clear CSS path cache
  console.log('Watch cache cleared');
}

/**
 * Progress reporter that updates lines in place (like pnpm)
 */
class ProgressReporter {
  constructor() {
    this.lines = {};
    this.isTTY = process.stdout.isTTY;
  }
  
  // Update a named status line in place
  status(name, message) {
    if (this.isTTY) {
      // Save cursor, move to line, clear it, write, restore cursor
      const line = `${name}: ${message}`;
      this.lines[name] = line;
      // Clear line and write
      process.stdout.write(`\r\x1b[K${line}`);
    }
  }
  
  // Complete a status line (print final state and newline)
  done(name, message) {
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[K${name}: ${message}\n`);
    } else {
      console.log(`${name}: ${message}`);
    }
    delete this.lines[name];
  }
  
  // Regular log that doesn't get overwritten
  log(message) {
    if (this.isTTY) {
      // Clear current line first, print message, then newline
      process.stdout.write(`\r\x1b[K${message}\n`);
    } else {
      console.log(message);
    }
  }
  
  // Clear all status lines
  clear() {
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[K`);
    }
  }
}

const progress = new ProgressReporter();

/**
 * Process items in batches to limit memory usage
 * @param {Array} items - Items to process
 * @param {Function} processor - Async function to process each item
 * @param {number} batchSize - Max concurrent operations
 */
async function processBatched(items, processor, batchSize = BATCH_SIZE) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
    // Allow GC to run between batches
    if (global.gc) global.gc();
  }
  return results;
}
import { getAutomenu } from "../helper/automenu.js";
import { filterAsync } from "../helper/filterAsync.js";
import { isDirectory } from "../helper/isDirectory.js";
import { isFolderHidden, clearConfigCache } from "../helper/folderConfig.js";
import {
  extractMetadata,
  extractRawMetadata,
} from "../helper/metadataExtractor.js";
import {
  hashContent,
  loadHashCache,
  saveHashCache,
  needsRegeneration,
  updateHash,
} from "../helper/contentHash.js";
import {
  buildValidPaths,
  markInactiveLinks,
} from "../helper/linkValidator.js";
import { getAndIncrementBuildId } from "../helper/ursaConfig.js";
import { extractSections } from "../helper/sectionExtractor.js";

// Helper function to build search index from processed files
function buildSearchIndex(jsonCache, source, output) {
  const searchIndex = [];
  
  for (const [filePath, jsonObject] of jsonCache.entries()) {
    // Generate URL path relative to output
    const relativePath = filePath.replace(source, '').replace(/\.(md|txt|yml)$/, '.html');
    const url = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
    
    // Extract text content from body (strip HTML tags for search)
    const textContent = jsonObject.bodyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const excerpt = textContent.substring(0, 200); // First 200 chars for preview
    
    searchIndex.push({
      title: toTitleCase(jsonObject.name),
      path: relativePath,
      url: url,
      content: excerpt
    });
  }
  
  return searchIndex;
}

// Helper function to convert filename to title case
function toTitleCase(filename) {
  return filename
    .split(/[-_\s]+/) // Split on hyphens, underscores, and spaces
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
import { renderFile } from "../helper/fileRenderer.js";
import { findStyleCss } from "../helper/findStyleCss.js";
import { copy as copyDir, emptyDir, outputFile } from "fs-extra";
import { basename, dirname, extname, join, parse, resolve } from "path";
import { URL } from "url";
import o2x from "object-to-xml";
import { existsSync } from "fs";
import { fileExists } from "../helper/fileExists.js";

import { createWhitelistFilter } from "../helper/whitelistFilter.js";

const DEFAULT_TEMPLATE_NAME =
  process.env.DEFAULT_TEMPLATE_NAME ?? "default-template";

// Cache for CSS path lookups to avoid repeated filesystem walks
const cssPathCache = new Map();

/**
 * Parse exclude option - can be comma-separated paths or a file path
 * @param {string} excludeOption - The exclude option value
 * @param {string} source - Source directory path
 * @returns {Promise<Set<string>>} Set of excluded folder paths (normalized)
 */
async function parseExcludeOption(excludeOption, source) {
  const excludedPaths = new Set();
  
  if (!excludeOption) return excludedPaths;
  
  // Check if it's a file path (exists as a file)
  const isFile = existsSync(excludeOption) && (await stat(excludeOption)).isFile();
  
  let patterns;
  if (isFile) {
    // Read patterns from file (one per line)
    const content = await readFile(excludeOption, 'utf8');
    patterns = content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')); // Skip empty lines and comments
  } else {
    // Treat as comma-separated list
    patterns = excludeOption.split(',').map(p => p.trim()).filter(Boolean);
  }
  
  // Normalize patterns to absolute paths
  for (const pattern of patterns) {
    // Remove leading/trailing slashes and normalize
    const normalized = pattern.replace(/^\/+|\/+$/g, '');
    // Store as relative path for easier matching
    excludedPaths.add(normalized);
  }
  
  return excludedPaths;
}

/**
 * Create a filter function that excludes files in specified folders
 * @param {Set<string>} excludedPaths - Set of excluded folder paths
 * @param {string} source - Source directory path
 * @returns {Function} Filter function
 */
function createExcludeFilter(excludedPaths, source) {
  if (excludedPaths.size === 0) {
    return () => true; // No exclusions, allow all
  }
  
  return (filePath) => {
    // Get path relative to source
    const relativePath = filePath.replace(source, '').replace(/^\/+/, '');
    
    // Check if file is in any excluded folder
    for (const excluded of excludedPaths) {
      if (relativePath === excluded || 
          relativePath.startsWith(excluded + '/') ||
          relativePath.startsWith(excluded + '\\')) {
        return false; // Exclude this file
      }
    }
    return true; // Include this file
  };
}

export async function generate({
  _source = join(process.cwd(), "."),
  _meta = join(process.cwd(), "meta"),
  _output = join(process.cwd(), "build"),
  _whitelist = null,
  _exclude = null,
  _incremental = false,  // Legacy flag, now ignored (always incremental)
  _clean = false,  // When true, ignore cache and regenerate all files
} = {}) {
  console.log({ _source, _meta, _output, _whitelist, _exclude, _clean });
  const source = resolve(_source) + "/";
  const meta = resolve(_meta);
  const output = resolve(_output) + "/";
  console.log({ source, meta, output });

  // Clear output directory when --clean is specified
  if (_clean) {
    progress.log(`Clean build: clearing output directory ${output}`);
    await emptyDir(output);
  }

  const allSourceFilenamesUnfiltered = await recurse(source, [() => false]);
  
  // Apply include filter (existing functionality)
  const includeFilter = process.env.INCLUDE_FILTER
    ? (fileName) => fileName.match(process.env.INCLUDE_FILTER)
    : Boolean;
  let allSourceFilenames = allSourceFilenamesUnfiltered.filter(includeFilter);
  
  // Apply exclude filter if specified
  if (_exclude) {
    const excludedPaths = await parseExcludeOption(_exclude, source);
    const excludeFilter = createExcludeFilter(excludedPaths, source);
    const beforeCount = allSourceFilenames.length;
    allSourceFilenames = allSourceFilenames.filter(excludeFilter);
    progress.log(`Exclude filter applied: ${beforeCount - allSourceFilenames.length} files excluded`);
  }
  
  // Apply whitelist filter if specified
  if (_whitelist) {
    const whitelistFilter = await createWhitelistFilter(_whitelist, source);
    allSourceFilenames = allSourceFilenames.filter(whitelistFilter);
    console.log(`Whitelist applied: ${allSourceFilenames.length} files after filtering`);
  }
  // console.log(allSourceFilenames);

  // if (source.substr(-1) !== "/") source += "/"; // warning: might not work in windows
  // if (output.substr(-1) !== "/") output += "/";

  const templates = await getTemplates(meta); // todo: error if no default template
  // console.log({ templates });

  // Clear config cache at start of generation to pick up any changes
  clearConfigCache();

  // Helper to check if a path is inside a config-hidden folder
  const isInHiddenFolder = (filePath) => {
    const dir = dirname(filePath);
    return isFolderHidden(dir, source);
  };

  // read all articles, process them, copy them to build
  const articleExtensions = /\.(md|txt|yml)/;
  const hiddenOrSystemDirs = /[\/\\]\.(?!\.)|[\/\\]node_modules[\/\\]/;  // Matches hidden folders (starting with .) or node_modules
  const allSourceFilenamesThatAreArticles = allSourceFilenames.filter(
    (filename) => filename.match(articleExtensions) && !filename.match(hiddenOrSystemDirs) && !isInHiddenFolder(filename)
  );
  const allSourceFilenamesThatAreDirectories = (await filterAsync(
    allSourceFilenames,
    (filename) => isDirectory(filename)
  )).filter((filename) => !filename.match(hiddenOrSystemDirs) && !isFolderHidden(filename, source));

  // Build set of valid internal paths for link validation (must be before menu)
  // Pass directories to ensure folder links are valid (auto-index generates index.html for all folders)
  const validPaths = buildValidPaths(allSourceFilenamesThatAreArticles, source, allSourceFilenamesThatAreDirectories);
  progress.log(`Built ${validPaths.size} valid paths for link validation`);

  const menu = await getMenu(allSourceFilenames, source, validPaths);

  // Get and increment build ID from .ursa.json
  const buildId = getAndIncrementBuildId(resolve(_source));
  progress.log(`Build #${buildId}`);

  // Generate footer content
  const footer = await getFooter(source, _source, buildId);

  // Load content hash cache from .ursa folder in source directory
  let hashCache = new Map();
  if (!_clean) {
    hashCache = await loadHashCache(source);
    progress.log(`Loaded ${hashCache.size} cached content hashes from .ursa folder`);
  } else {
    progress.log(`Clean build: ignoring cached hashes`);
  }

  // create public folder
  const pub = join(output, "public");
  await mkdir(pub, { recursive: true });
  await copyDir(meta, pub);

  // Track errors for error report
  const errors = [];

  // Search index: built incrementally during article processing (lighter memory footprint)
  const searchIndex = [];
  // Directory index cache: only stores minimal data needed for directory indices
  // Uses WeakRef-style approach - store only what's needed, clear as we go
  const dirIndexCache = new Map();
  
  // Track CSS files that have been copied to avoid duplicates
  const copiedCssFiles = new Set();

  // Track files that were regenerated (for incremental mode stats)
  let regeneratedCount = 0;
  let skippedCount = 0;
  let processedCount = 0;
  const totalArticles = allSourceFilenamesThatAreArticles.length;

  progress.log(`Processing ${totalArticles} articles in batches of ${BATCH_SIZE}...`);

  // Single pass: process all articles with batched concurrency to limit memory usage
  await processBatched(allSourceFilenamesThatAreArticles, async (file) => {
    try {
      processedCount++;
      const shortFile = file.replace(source, '');
      progress.status('Articles', `${processedCount}/${totalArticles} ${shortFile}`);
      
      const rawBody = await readFile(file, "utf8");
      const type = parse(file).ext;
      const ext = extname(file);
      const base = basename(file, ext);
      const dir = addTrailingSlash(dirname(file)).replace(source, "");
      
      // Calculate output paths for this file
      const outputFilename = file
        .replace(source, output)
        .replace(parse(file).ext, ".html");
      const url = '/' + outputFilename.replace(output, '');
      
      // Generate URL path relative to output (for search index)
      const relativePath = file.replace(source, '').replace(/\.(md|txt|yml)$/, '.html');
      const searchUrl = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
      
      // Generate title from filename (in title case)
      const title = toTitleCase(base);
      
      // Always add to search index (lightweight: title + path only, content added lazily)
      searchIndex.push({
        title: title,
        path: relativePath,
        url: searchUrl,
        content: '' // Content excerpts built lazily to save memory
      });
      
      // Check if file needs regeneration
      const needsRegen = _clean || needsRegeneration(file, rawBody, hashCache);
      
      if (!needsRegen) {
        skippedCount++;
        // For directory indices, store minimal data (not full bodyHtml)
        dirIndexCache.set(file, {
          name: base,
          url,
          // Don't store contents or bodyHtml - saves significant memory
        });
        return; // Skip regenerating this file
      }
      
      regeneratedCount++;

      const fileMeta = extractMetadata(rawBody);
      const rawMeta = extractRawMetadata(rawBody);
      const transformedMetadata = await getTransformedMetadata(
        dirname(file),
        fileMeta
      );
      
      // Calculate the document's URL path (e.g., "/character/index.html")
      const docUrlPath = '/' + dir + base + '.html';

      const body = renderFile({
        fileContents: rawBody,
        type,
        dirname: dir,
        basename: base,
      });

      // Find nearest style.css or _style.css up the tree and copy to output
      // Use cache to avoid repeated filesystem walks for same directory
      let styleLink = "";
      try {
        const dirKey = resolve(_source, dir);
        let cssPath = cssPathCache.get(dirKey);
        if (cssPath === undefined) {
          cssPath = await findStyleCss(dirKey);
          cssPathCache.set(dirKey, cssPath); // Cache null results too
        }
        if (cssPath) {
          // Calculate output path for the CSS file (mirrors source structure)
          const cssOutputPath = cssPath.replace(source, output);
          const cssUrlPath = '/' + cssPath.replace(source, '');
          
          // Copy CSS file if not already copied
          if (!copiedCssFiles.has(cssPath)) {
            const cssContent = await readFile(cssPath, 'utf8');
            await outputFile(cssOutputPath, cssContent);
            copiedCssFiles.add(cssPath);
          }
          
          // Generate link tag
          styleLink = `<link rel="stylesheet" href="${cssUrlPath}" />`;
        }
      } catch (e) {
        // ignore
        console.error(e);
      }

      const requestedTemplateName = fileMeta && fileMeta.template;
      const template =
        templates[requestedTemplateName] || templates[DEFAULT_TEMPLATE_NAME];

      if (!template) {
        throw new Error(`Template not found. Requested: "${requestedTemplateName || DEFAULT_TEMPLATE_NAME}". Available templates: ${Object.keys(templates).join(', ') || 'none'}`);
      }

      // Build final HTML with all replacements in a single regex pass
      // This avoids creating 8 intermediate strings
      const replacements = {
        "${title}": title,
        "${menu}": menu,
        "${meta}": JSON.stringify(fileMeta),
        "${transformedMetadata}": transformedMetadata,
        "${body}": body,
        "${styleLink}": styleLink,
        "${searchIndex}": "[]", // Placeholder - search index written separately as JSON file
        "${footer}": footer
      };
      // Single-pass replacement using regex alternation
      const pattern = /\$\{(title|menu|meta|transformedMetadata|body|styleLink|searchIndex|footer)\}/g;
      let finalHtml = template.replace(pattern, (match) => replacements[match] ?? match);

      // Resolve links and mark broken internal links as inactive
      finalHtml = markInactiveLinks(finalHtml, validPaths, docUrlPath, false);

      await outputFile(outputFilename, finalHtml);
      
      // Clear finalHtml reference to allow GC
      finalHtml = null;

      // JSON output
      const jsonOutputFilename = outputFilename.replace(".html", ".json");
      
      // Extract sections for markdown files
      const sections = type === '.md' ? extractSections(rawBody) : [];
      
      const jsonObject = {
        name: base,
        url,
        contents: rawBody,
        bodyHtml: body,
        metadata: fileMeta,
        sections,
        transformedMetadata,
      };
      
      // Store minimal data for directory indices
      dirIndexCache.set(file, {
        name: base,
        url,
      });
      
      const json = JSON.stringify(jsonObject);
      await outputFile(jsonOutputFilename, json);

      // XML output
      const xmlOutputFilename = outputFilename.replace(".html", ".xml");
      const xml = `<article>${o2x(jsonObject)}</article>`;
      await outputFile(xmlOutputFilename, xml);
      
      // Update the content hash for this file
      updateHash(file, rawBody, hashCache);
    } catch (e) {
      progress.log(`Error processing ${file}: ${e.message}`);
      errors.push({ file, phase: 'article-generation', error: e });
    }
  });

  // Complete the articles status line
  progress.done('Articles', `${totalArticles} done (${regeneratedCount} regenerated, ${skippedCount} unchanged)`);

  // Write search index as a separate JSON file (not embedded in each page)
  const searchIndexPath = join(output, 'public', 'search-index.json');
  progress.log(`Writing search index with ${searchIndex.length} entries`);
  await outputFile(searchIndexPath, JSON.stringify(searchIndex));

  // Process directory indices with batched concurrency
  const totalDirs = allSourceFilenamesThatAreDirectories.length;
  let processedDirs = 0;
  progress.log(`Processing ${totalDirs} directories...`);
  await processBatched(allSourceFilenamesThatAreDirectories, async (dirPath) => {
    try {
      processedDirs++;
      const shortDir = dirPath.replace(source, '');
      progress.status('Directories', `${processedDirs}/${totalDirs} ${shortDir}`);

      const pathsInThisDirectory = allSourceFilenames.filter((filename) =>
        filename.match(new RegExp(`${dirPath}.+`))
      );

      // Use minimal directory index cache instead of full jsonCache
      const jsonObjects = pathsInThisDirectory
        .map((path) => {
          const object = dirIndexCache.get(path);
          return typeof object === "object" ? object : null;
        })
        .filter((a) => a);

      const json = JSON.stringify(jsonObjects);

      const outputFilename = dirPath.replace(source, output) + ".json";
      await outputFile(outputFilename, json);

      // html
      const htmlOutputFilename = dirPath.replace(source, output) + ".html";
      const indexAlreadyExists = fileExists(htmlOutputFilename);
      if (!indexAlreadyExists) {
        const template = templates["default-template"];
        const indexHtml = `<ul>${pathsInThisDirectory
          .map((path) => {
            const partialPath = path
              .replace(source, "")
              .replace(parse(path).ext, ".html");
            const name = basename(path, parse(path).ext);
            return `<li><a href="${partialPath}">${name}</a></li>`;
          })
          .join("")}</ul>`;
        let finalHtml = template;
        const replacements = {
          "${menu}": menu,
          "${body}": indexHtml,
          "${searchIndex}": "[]", // Search index now in separate file
          "${title}": "Index",
          "${meta}": "{}",
          "${transformedMetadata}": "",
          "${styleLink}": "",
          "${footer}": footer
        };
        for (const [key, value] of Object.entries(replacements)) {
          finalHtml = finalHtml.replace(key, value);
        }
        await outputFile(htmlOutputFilename, finalHtml);
      }
    } catch (e) {
      progress.log(`Error processing directory ${dirPath}: ${e.message}`);
      errors.push({ file: dirPath, phase: 'directory-index', error: e });
    }
  });
  
  progress.done('Directories', `${totalDirs} done`);

  // Clear directory index cache to free memory before processing static files
  dirIndexCache.clear();

  // copy all static files (i.e. images) with batched concurrency
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|ico)/; // static asset extensions
  const allSourceFilenamesThatAreImages = allSourceFilenames.filter(
    (filename) => filename.match(imageExtensions)
  );
  const totalStatic = allSourceFilenamesThatAreImages.length;
  let processedStatic = 0;
  let copiedStatic = 0;
  progress.log(`Processing ${totalStatic} static files...`);
  await processBatched(allSourceFilenamesThatAreImages, async (file) => {
    try {
      processedStatic++;
      const shortFile = file.replace(source, '');
      progress.status('Static files', `${processedStatic}/${totalStatic} ${shortFile}`);
      
      // Check if file has changed using file stat as a quick check
      const fileStat = await stat(file);
      const statKey = `${file}:stat`;
      const newStatHash = `${fileStat.size}:${fileStat.mtimeMs}`;
      if (hashCache.get(statKey) === newStatHash) {
        return; // Skip unchanged static file
      }
      hashCache.set(statKey, newStatHash);
      copiedStatic++;

      const outputFilename = file.replace(source, output);

      await mkdir(dirname(outputFilename), { recursive: true });
      return await copyFile(file, outputFilename);
    } catch (e) {
      progress.log(`Error processing static file ${file}: ${e.message}`);
      errors.push({ file, phase: 'static-file', error: e });
    }
  });
  
  progress.done('Static files', `${totalStatic} done (${copiedStatic} copied)`);

  // Automatic index generation for folders without index.html
  progress.log(`Checking for missing index files...`);
  await generateAutoIndices(output, allSourceFilenamesThatAreDirectories, source, templates, menu, footer, allSourceFilenamesThatAreArticles, copiedCssFiles);

  // Save the hash cache to .ursa folder in source directory
  if (hashCache.size > 0) {
    await saveHashCache(source, hashCache);
  }

  // Populate watch mode cache for fast single-file regeneration
  watchModeCache.templates = templates;
  watchModeCache.menu = menu;
  watchModeCache.footer = footer;
  watchModeCache.validPaths = validPaths;
  watchModeCache.source = source;
  watchModeCache.meta = meta;
  watchModeCache.output = output;
  watchModeCache.hashCache = hashCache;
  watchModeCache.lastFullBuild = Date.now();
  watchModeCache.isInitialized = true;
  progress.log(`Watch cache initialized for fast single-file regeneration`);

  // Write error report if there were any errors
  if (errors.length > 0) {
    const errorReportPath = join(output, '_errors.log');
    const failedFiles = errors.map(e => e.file);
    
    let report = `URSA GENERATION ERROR REPORT\n`;
    report += `Generated: ${new Date().toISOString()}\n`;
    report += `Total errors: ${errors.length}\n\n`;
    report += `${'='.repeat(60)}\n`;
    report += `FAILED FILES:\n`;
    report += `${'='.repeat(60)}\n\n`;
    failedFiles.forEach(f => {
      report += `  - ${f}\n`;
    });
    report += `\n${'='.repeat(60)}\n`;
    report += `ERROR DETAILS:\n`;
    report += `${'='.repeat(60)}\n\n`;
    
    errors.forEach(({ file, phase, error }) => {
      report += `${'─'.repeat(60)}\n`;
      report += `File: ${file}\n`;
      report += `Phase: ${phase}\n`;
      report += `Error: ${error.message}\n`;
      if (error.stack) {
        report += `Stack:\n${error.stack}\n`;
      }
      report += `\n`;
    });
    
    await outputFile(errorReportPath, report);
    progress.log(`\n⚠️  ${errors.length} error(s) occurred during generation.`);
    progress.log(`   Error report written to: ${errorReportPath}\n`);
  } else {
    progress.log(`\n✅ Generation complete with no errors.\n`);
  }
}

/**
 * Generate automatic index.html files for folders that don't have one
 * @param {string} output - Output directory path
 * @param {string[]} directories - List of source directories
 * @param {string} source - Source directory path
 * @param {object} templates - Template map
 * @param {string} menu - Rendered menu HTML
 * @param {string} footer - Footer HTML
 * @param {string[]} generatedArticles - List of source article paths that were generated
 * @param {Set<string>} copiedCssFiles - Set of CSS files already copied to output
 */
async function generateAutoIndices(output, directories, source, templates, menu, footer, generatedArticles, copiedCssFiles) {
  // Alternate index file names to look for (in priority order)
  const INDEX_ALTERNATES = ['_index.html', 'home.html', '_home.html'];
  
  // Normalize paths (remove trailing slashes for consistent replacement)
  const sourceNorm = source.replace(/\/+$/, '');
  const outputNorm = output.replace(/\/+$/, '');
  
  // Build set of directories that already have an index.html from a source index.md/txt/yml
  const dirsWithSourceIndex = new Set();
  for (const articlePath of generatedArticles) {
    const base = basename(articlePath, extname(articlePath));
    if (base === 'index') {
      const dir = dirname(articlePath);
      const outputDir = dir.replace(sourceNorm, outputNorm);
      dirsWithSourceIndex.add(outputDir);
    }
  }
  
  // Get all output directories (including root)
  const outputDirs = new Set([outputNorm]);
  for (const dir of directories) {
    // Handle both with and without trailing slash in source
    const outputDir = dir.replace(sourceNorm, outputNorm);
    outputDirs.add(outputDir);
  }
  
  let generatedCount = 0;
  let renamedCount = 0;
  
  for (const dir of outputDirs) {
    const indexPath = join(dir, 'index.html');
    
    // Skip if this directory had a source index.md/txt/yml that was already processed
    if (dirsWithSourceIndex.has(dir)) {
      continue;
    }
    
    // Skip if index.html already exists (e.g., created by previous run)
    if (existsSync(indexPath)) {
      continue;
    }
    
    // Get folder name for (foldername).html check
    const folderName = basename(dir);
    const folderNameAlternate = `${folderName}.html`;
    
    // Check for alternate index files
    let foundAlternate = null;
    for (const alt of [...INDEX_ALTERNATES, folderNameAlternate]) {
      const altPath = join(dir, alt);
      if (existsSync(altPath)) {
        foundAlternate = altPath;
        break;
      }
    }
    
    if (foundAlternate) {
      // Rename/copy alternate to index.html
      try {
        const content = await readFile(foundAlternate, 'utf8');
        await outputFile(indexPath, content);
        renamedCount++;
        progress.status('Auto-index', `Promoted ${basename(foundAlternate)} → index.html in ${dir.replace(outputNorm, '') || '/'}`);
      } catch (e) {
        progress.log(`Error promoting ${foundAlternate} to index.html: ${e.message}`);
      }
    } else {
      // Generate a simple index listing direct children
      try {
        const children = await readdir(dir, { withFileTypes: true });
        
        // Filter to only include relevant files and folders
        const items = children
          .filter(child => {
            // Skip hidden files and index alternates we just checked
            if (child.name.startsWith('.')) return false;
            if (child.name === 'index.html') return false;
            // Include directories and html files
            return child.isDirectory() || child.name.endsWith('.html');
          })
          .map(child => {
            const isDir = child.isDirectory();
            const name = isDir ? child.name : child.name.replace('.html', '');
            const href = isDir ? `${child.name}/` : child.name;
            const displayName = toTitleCase(name);
            const icon = isDir ? '📁' : '📄';
            return `<li>${icon} <a href="${href}">${displayName}</a></li>`;
          });
        
        if (items.length === 0) {
          // Empty folder, skip generating index
          continue;
        }
        
        const folderDisplayName = dir === outputNorm ? 'Home' : toTitleCase(folderName);
        const indexHtml = `<h1>${folderDisplayName}</h1>\n<ul class="auto-index">\n${items.join('\n')}\n</ul>`;
        
        const template = templates["default-template"];
        if (!template) {
          progress.log(`Warning: No default template for auto-index in ${dir}`);
          continue;
        }
        
        // Find nearest style.css for this directory
        let styleLink = "";
        try {
          // Map output dir back to source dir to find style.css
          const sourceDir = dir.replace(outputNorm, sourceNorm);
          const cssPath = await findStyleCss(sourceDir);
          if (cssPath) {
            // Calculate output path for the CSS file (mirrors source structure)
            const cssOutputPath = cssPath.replace(sourceNorm, outputNorm);
            const cssUrlPath = '/' + cssPath.replace(sourceNorm, '');
            
            // Copy CSS file if not already copied
            if (!copiedCssFiles.has(cssPath)) {
              const cssContent = await readFile(cssPath, 'utf8');
              await outputFile(cssOutputPath, cssContent);
              copiedCssFiles.add(cssPath);
            }
            
            // Generate link tag
            styleLink = `<link rel="stylesheet" href="${cssUrlPath}" />`;
          }
        } catch (e) {
          // ignore CSS lookup errors
        }
        
        let finalHtml = template;
        const replacements = {
          "${menu}": menu,
          "${body}": indexHtml,
          "${searchIndex}": "[]",
          "${title}": folderDisplayName,
          "${meta}": "{}",
          "${transformedMetadata}": "",
          "${styleLink}": styleLink,
          "${footer}": footer
        };
        for (const [key, value] of Object.entries(replacements)) {
          finalHtml = finalHtml.replace(key, value);
        }
        
        await outputFile(indexPath, finalHtml);
        generatedCount++;
        progress.status('Auto-index', `Generated index.html for ${dir.replace(outputNorm, '') || '/'}`);
      } catch (e) {
        progress.log(`Error generating auto-index for ${dir}: ${e.message}`);
      }
    }
  }
  
  if (generatedCount > 0 || renamedCount > 0) {
    progress.done('Auto-index', `${generatedCount} generated, ${renamedCount} promoted`);
  } else {
    progress.log(`Auto-index: All folders already have index.html`);
  }
}

/**
 * Regenerate a single file without scanning the entire source directory.
 * This is much faster for watch mode - only regenerate what changed.
 * 
 * @param {string} changedFile - Absolute path to the file that changed
 * @param {Object} options - Same options as generate()
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function regenerateSingleFile(changedFile, {
  _source,
  _meta,
  _output,
} = {}) {
  const startTime = Date.now();
  const source = resolve(_source) + "/";
  const meta = resolve(_meta);
  const output = resolve(_output) + "/";
  
  // Check if this is an article file we can regenerate
  const articleExtensions = /\.(md|txt|yml)$/;
  if (!changedFile.match(articleExtensions)) {
    return { success: false, message: `Not an article file: ${changedFile}` };
  }
  
  // Check if cache is initialized
  if (!watchModeCache.isInitialized) {
    return { success: false, message: 'Cache not initialized - need full build first' };
  }
  
  // Verify paths match cached paths
  if (watchModeCache.source !== source || watchModeCache.output !== output) {
    return { success: false, message: 'Paths changed - need full rebuild' };
  }
  
  try {
    const { templates, menu, footer, validPaths, hashCache } = watchModeCache;
    
    const rawBody = await readFile(changedFile, "utf8");
    const type = parse(changedFile).ext;
    const ext = extname(changedFile);
    const base = basename(changedFile, ext);
    const dir = addTrailingSlash(dirname(changedFile)).replace(source, "");
    
    // Calculate output paths
    const outputFilename = changedFile
      .replace(source, output)
      .replace(parse(changedFile).ext, ".html");
    const url = '/' + outputFilename.replace(output, '');
    
    // Title from filename
    const title = toTitleCase(base);
    
    // Extract metadata
    const fileMeta = extractMetadata(rawBody);
    const transformedMetadata = await getTransformedMetadata(
      dirname(changedFile),
      fileMeta
    );
    
    // Calculate the document's URL path
    const docUrlPath = '/' + dir + base + '.html';
    
    // Render body
    const body = renderFile({
      fileContents: rawBody,
      type,
      dirname: dir,
      basename: base,
    });
    
    // Find CSS and copy to output
    let styleLink = "";
    try {
      const cssPath = await findStyleCss(resolve(_source, dir));
      if (cssPath) {
        // Calculate output path for the CSS file
        const cssOutputPath = cssPath.replace(source, output);
        const cssUrlPath = '/' + cssPath.replace(source, '');
        
        // Copy CSS file (always copy in single-file mode to ensure it's up to date)
        const cssContent = await readFile(cssPath, 'utf8');
        await outputFile(cssOutputPath, cssContent);
        
        // Generate link tag
        styleLink = `<link rel="stylesheet" href="${cssUrlPath}" />`;
      }
    } catch (e) {
      // ignore
    }
    
    // Get template
    const requestedTemplateName = fileMeta && fileMeta.template;
    const template =
      templates[requestedTemplateName] || templates[DEFAULT_TEMPLATE_NAME];
    
    if (!template) {
      return { success: false, message: `Template not found: ${requestedTemplateName || DEFAULT_TEMPLATE_NAME}` };
    }
    
    // Build final HTML
    let finalHtml = template;
    const replacements = {
      "${title}": title,
      "${menu}": menu,
      "${meta}": JSON.stringify(fileMeta),
      "${transformedMetadata}": transformedMetadata,
      "${body}": body,
      "${styleLink}": styleLink,
      "${searchIndex}": "[]",
      "${footer}": footer
    };
    for (const [key, value] of Object.entries(replacements)) {
      finalHtml = finalHtml.replace(key, value);
    }
    
    // Mark broken links
    finalHtml = markInactiveLinks(finalHtml, validPaths, docUrlPath, false);
    
    await outputFile(outputFilename, finalHtml);
    
    // JSON output
    const jsonOutputFilename = outputFilename.replace(".html", ".json");
    const sections = type === '.md' ? extractSections(rawBody) : [];
    const jsonObject = {
      name: base,
      url,
      contents: rawBody,
      bodyHtml: body,
      metadata: fileMeta,
      sections,
      transformedMetadata,
    };
    const json = JSON.stringify(jsonObject);
    await outputFile(jsonOutputFilename, json);
    
    // XML output
    const xmlOutputFilename = outputFilename.replace(".html", ".xml");
    const xml = `<article>${o2x(jsonObject)}</article>`;
    await outputFile(xmlOutputFilename, xml);
    
    // Update hash cache
    updateHash(changedFile, rawBody, hashCache);
    
    const elapsed = Date.now() - startTime;
    const shortFile = changedFile.replace(source, '');
    return { success: true, message: `Regenerated ${shortFile} in ${elapsed}ms` };
  } catch (e) {
    return { success: false, message: `Error: ${e.message}` };
  }
}

/**
 * gets { [templateName:String]:[templateBody:String] }
 * meta: full path to meta files (default-template.html, etc)
 */
async function getTemplates(meta) {
  const allMetaFilenames = await recurse(meta);
  const allHtmlFilenames = allMetaFilenames.filter((filename) =>
    filename.match(/\.html/)
  );

  let templates = {};
  const templatesArray = await Promise.all(
    allHtmlFilenames.map(async (filename) => {
      const { name } = parse(filename);
      const fileContent = await readFile(filename, "utf8");
      return [name, fileContent];
    })
  );
  templatesArray.forEach(
    ([templateName, templateText]) => (templates[templateName] = templateText)
  );

  return templates;
}

async function getMenu(allSourceFilenames, source, validPaths) {
  // todo: handle various incarnations of menu filename

  const rawMenu = await getAutomenu(source, validPaths);
  const menuBody = renderFile({ fileContents: rawMenu, type: ".md" });
  return menuBody;

  // const allMenus = allSourceFilenames.filter((filename) =>
  //   filename.match(/_?menu\.(html|yml|md|txt)/)
  // );
  // console.log({ allMenus });
  // if (allMenus.length === 0) return "";

  // // pick best menu...TODO: actually apply logic here
  // const bestMenu = allMenus[0];
  // const rawBody = await readFile(bestMenu, "utf8");
  // const type = parse(bestMenu).ext;
  // const menuBody = renderFile({ fileContents: rawBody, type });

  // return menuBody;
}

async function getTransformedMetadata(dirname, metadata) {
  // console.log("getTransformedMetadata > ", { dirname });
  // custom transform? else, use default
  const customTransformFnFilename = join(dirname, "transformMetadata.js");
  let transformFn = defaultTransformFn;
  try {
    const customTransformFn = (await import(customTransformFnFilename)).default;
    if (typeof customTransformFn === "function")
      transformFn = customTransformFn;
  } catch (e) {
    // console.error(e);
  }
  try {
    return transformFn(metadata);
  } catch (e) {
    return "error transforming metadata";
  }

  function defaultTransformFn(metadata) {
    return "default transform";
  }
}

function addTrailingSlash(somePath) {
  if (typeof somePath !== "string") return somePath;
  if (somePath.length < 1) return somePath;
  if (somePath[somePath.length - 1] == "/") return somePath;
  return `${somePath}/`;
}

/**
 * Generate footer HTML from footer.md and package.json
 * @param {string} source - resolved source path with trailing slash
 * @param {string} _source - original source path
 * @param {number} buildId - the current build ID
 */
async function getFooter(source, _source, buildId) {
  const footerParts = [];
  
  // Try to read footer.md from source root
  const footerPath = join(source, 'footer.md');
  try {
    if (existsSync(footerPath)) {
      const footerMd = await readFile(footerPath, 'utf8');
      const footerHtml = renderFile({ fileContents: footerMd, type: '.md' });
      footerParts.push(`<div class="footer-content">${footerHtml}</div>`);
    }
  } catch (e) {
    console.error(`Error reading footer.md: ${e.message}`);
  }
  
  // Try to read package.json from doc repo (check both source dir and parent)
  let docPackage = null;
  const sourceDir = resolve(_source);
  const packagePaths = [
    join(sourceDir, 'package.json'),           // In source dir itself
    join(sourceDir, '..', 'package.json'),     // One level up (if docs is a subfolder)
  ];
  
  for (const packagePath of packagePaths) {
    try {
      if (existsSync(packagePath)) {
        const packageJson = await readFile(packagePath, 'utf8');
        docPackage = JSON.parse(packageJson);
        console.log(`Found doc package.json at ${packagePath}`);
        break;
      }
    } catch (e) {
      // Continue to next path
    }
  }
  
  // Get ursa version from ursa's own package.json
  // Use import.meta.url to find the package.json relative to this file
  let ursaVersion = 'unknown';
  try {
    // From src/jobs/generate.js, go up to package root
    const currentFileUrl = new URL(import.meta.url);
    const currentDir = dirname(currentFileUrl.pathname);
    const ursaPackagePath = resolve(currentDir, '..', '..', 'package.json');
    
    if (existsSync(ursaPackagePath)) {
      const ursaPackageJson = await readFile(ursaPackagePath, 'utf8');
      const ursaPackage = JSON.parse(ursaPackageJson);
      ursaVersion = ursaPackage.version;
      console.log(`Found ursa package.json at ${ursaPackagePath}, version: ${ursaVersion}`);
    }
  } catch (e) {
    console.error(`Error reading ursa package.json: ${e.message}`);
  }
  
  // Build meta line: version, build id, timestamp, "generated by ursa"
  const metaParts = [];
  if (docPackage?.version) {
    metaParts.push(`v${docPackage.version}`);
  }
  metaParts.push(`build ${buildId}`);
  
  // Full date/time in a readable format
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  metaParts.push(timestamp);
  
  metaParts.push(`Generated by <a href="https://www.npmjs.com/package/@kenjura/ursa">ursa</a> v${ursaVersion}`);
  
  footerParts.push(`<div class="footer-meta">${metaParts.join(' • ')}</div>`);
  
  // Copyright line from doc package.json
  if (docPackage?.copyright) {
    footerParts.push(`<div class="footer-copyright">${docPackage.copyright}</div>`);
  } else if (docPackage?.author) {
    const year = new Date().getFullYear();
    const author = typeof docPackage.author === 'string' ? docPackage.author : docPackage.author.name;
    if (author) {
      footerParts.push(`<div class="footer-copyright">© ${year} ${author}</div>`);
    }
  }
  
  // Try to get git short hash of doc repo (as HTML comment)
  try {
    const { execSync } = await import('child_process');
    const gitHash = execSync('git rev-parse --short HEAD', {
      cwd: resolve(_source),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (gitHash) {
      footerParts.push(`<!-- git: ${gitHash} -->`);
    }
  } catch (e) {
    // Not a git repo or git not available - silently skip
  }
  
  return footerParts.join('\n');
}