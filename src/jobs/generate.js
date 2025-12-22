import { recurse } from "../helper/recursive-readdir.js";
import { copyFile, mkdir, readdir, readFile, stat } from "fs/promises";
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
import { renderFile } from "../helper/fileRenderer.js";
import { findStyleCss } from "../helper/findStyleCss.js";
import { copy as copyDir, emptyDir, outputFile } from "fs-extra";
import { basename, dirname, extname, join, parse, resolve } from "path";
import { URL } from "url";
import o2x from "object-to-xml";
import { existsSync } from "fs";
import { fileExists } from "../helper/fileExists.js";
import { createWhitelistFilter } from "../helper/whitelistFilter.js";

// Import build helpers from organized modules
import {
  generateCacheBustTimestamp,
  addTimestampToCssUrls,
  addTimestampToHtmlStaticRefs,
  processBatched,
  ProgressReporter,
  watchModeCache,
  clearWatchCache as clearWatchCacheBase,
  toTitleCase,
  parseExcludeOption,
  createExcludeFilter,
  addTrailingSlash,
  getTemplates,
  getMenu,
  findAllCustomMenus,
  getCustomMenuForFile,
  getTransformedMetadata,
  getFooter,
  generateAutoIndices,
} from "../helper/build/index.js";

// Concurrency limiter for batch processing to avoid memory exhaustion
const BATCH_SIZE = parseInt(process.env.URSA_BATCH_SIZE || '50', 10);

// Cache for CSS path lookups to avoid repeated filesystem walks
const cssPathCache = new Map();

// Wrapper for clearWatchCache that passes cssPathCache
export function clearWatchCache() {
  clearWatchCacheBase(cssPathCache);
}

const progress = new ProgressReporter();

const DEFAULT_TEMPLATE_NAME =
  process.env.DEFAULT_TEMPLATE_NAME ?? "default-template";

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

  // Generate cache-busting timestamp for this build
  const cacheBustTimestamp = generateCacheBustTimestamp();
  progress.log(`Cache-bust timestamp: ${cacheBustTimestamp}`);

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

  // Build set of existing HTML files in source directory (these should not be overwritten)
  const htmlExtensions = /\.html$/;
  const existingHtmlFiles = new Set(
    allSourceFilenames
      .filter(f => f.match(htmlExtensions) && !f.match(hiddenOrSystemDirs))
      .map(f => f.replace(source, '')) // Store relative paths for easy lookup
  );
  progress.log(`Found ${existingHtmlFiles.size} existing HTML files in source`);

  // Build set of valid internal paths for link validation (must be before menu)
  // Pass directories to ensure folder links are valid (auto-index generates index.html for all folders)
  const validPaths = buildValidPaths(allSourceFilenamesThatAreArticles, source, allSourceFilenamesThatAreDirectories);
  progress.log(`Built ${validPaths.size} valid paths for link validation`);

  const menuResult = await getMenu(allSourceFilenames, source, validPaths);
  const menu = menuResult.html;
  const menuData = menuResult.menuData;

  // Find all custom menus in the source tree
  const customMenus = findAllCustomMenus(allSourceFilenames, source);
  progress.log(`Found ${customMenus.size} custom menu(s)`);

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

  // Process all CSS files in the entire output directory tree for cache-busting
  const allOutputFiles = await recurse(output, [() => false]);
  for (const cssFile of allOutputFiles.filter(f => f.endsWith('.css'))) {
    const cssContent = await readFile(cssFile, 'utf8');
    const processedCss = addTimestampToCssUrls(cssContent, cacheBustTimestamp);
    await outputFile(cssFile, processedCss);
  }

  // Process JS files in output for cache-busting fetch URLs
  for (const jsFile of allOutputFiles.filter(f => f.endsWith('.js'))) {
    let jsContent = await readFile(jsFile, 'utf8');
    jsContent = jsContent.replace(
      /fetch\(['"]([^'"\)]+\.(json))['"](?!\s*\+)/g,
      `fetch('$1?v=${cacheBustTimestamp}'`
    );
    await outputFile(jsFile, jsContent);
  }

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
      
      // Check if a corresponding .html file already exists in source directory
      const outputHtmlRelative = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
      if (existingHtmlFiles.has(outputHtmlRelative)) {
        progress.log(`⚠️  Warning: Skipping ${shortFile} - would overwrite existing ${outputHtmlRelative} in source`);
        skippedCount++;
        return;
      }

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

      // Check if this file has a custom menu
      const customMenuInfo = getCustomMenuForFile(file, source, customMenus);

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

      // If this page has a custom menu, add data attribute to body
      if (customMenuInfo) {
        finalHtml = finalHtml.replace(
          /<body([^>]*)>/,
          `<body$1 data-custom-menu="${customMenuInfo.menuJsonPath}">`
        );
      }

      // Resolve links and mark broken internal links as inactive
      finalHtml = markInactiveLinks(finalHtml, validPaths, docUrlPath, false);

      // Add cache-busting timestamps to static file references
      finalHtml = addTimestampToHtmlStaticRefs(finalHtml, cacheBustTimestamp);

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

  // Write menu data as a separate JSON file (not embedded in each page)
  // This dramatically reduces HTML file sizes for large sites
  const menuDataPath = join(output, 'public', 'menu-data.json');
  const menuDataJson = JSON.stringify(menuData);
  progress.log(`Writing menu data (${(menuDataJson.length / 1024).toFixed(1)} KB)`);
  await outputFile(menuDataPath, menuDataJson);

  // Write custom menu JSON files
  for (const [menuDir, menuInfo] of customMenus) {
    const customMenuPath = join(output, menuInfo.menuJsonPath);
    const customMenuJson = JSON.stringify(menuInfo.menuData);
    progress.log(`Writing custom menu: ${menuInfo.menuJsonPath}`);
    await outputFile(customMenuPath, customMenuJson);
  }

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
        // Add cache-busting timestamps to static file references
        finalHtml = addTimestampToHtmlStaticRefs(finalHtml, cacheBustTimestamp);
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

  // copy all static files (images and existing HTML files) with batched concurrency
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|ico)/; // static asset extensions
  const allSourceFilenamesThatAreImages = allSourceFilenames.filter(
    (filename) => filename.match(imageExtensions)
  );
  
  // Also copy existing HTML files from source to output (they're treated as static)
  const allSourceFilenamesThatAreHtml = allSourceFilenames.filter(
    (filename) => filename.match(/\.html$/) && !filename.match(hiddenOrSystemDirs)
  );
  
  const allStaticFiles = [...allSourceFilenamesThatAreImages, ...allSourceFilenamesThatAreHtml];
  const totalStatic = allStaticFiles.length;
  let processedStatic = 0;
  let copiedStatic = 0;
  progress.log(`Processing ${totalStatic} static files (${allSourceFilenamesThatAreImages.length} images, ${allSourceFilenamesThatAreHtml.length} HTML)...`);
  await processBatched(allStaticFiles, async (file) => {
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

      if (file.endsWith('.css')) {
        // Process CSS for cache busting
        const cssContent = await readFile(file, 'utf8');
        const processedCss = addTimestampToCssUrls(cssContent, cacheBustTimestamp);
        await outputFile(outputFilename, processedCss);
      } else {
        await copyFile(file, outputFilename);
      }
    } catch (e) {
      progress.log(`Error processing static file ${file}: ${e.message}`);
      errors.push({ file, phase: 'static-file', error: e });
    }
  });
  
  progress.done('Static files', `${totalStatic} done (${copiedStatic} copied)`);

  // Automatic index generation for folders without index.html
  progress.log(`Checking for missing index files...`);
  await generateAutoIndices(output, allSourceFilenamesThatAreDirectories, source, templates, menu, footer, allSourceFilenamesThatAreArticles, copiedCssFiles, existingHtmlFiles, cacheBustTimestamp, progress);

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
    const { templates, menu, footer, validPaths, hashCache, cacheBustTimestamp } = watchModeCache;
    
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
    
    // Add cache-busting timestamps to static file references
    finalHtml = addTimestampToHtmlStaticRefs(finalHtml, cacheBustTimestamp);
    
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