import { recurse } from "../helper/recursive-readdir.js";
import { copyFile, mkdir, readdir, readFile, stat } from "fs/promises";
import { getAutomenu } from "../helper/automenu.js";
import { filterAsync } from "../helper/filterAsync.js";
import { isDirectory } from "../helper/isDirectory.js";
import { isFolderHidden, clearConfigCache } from "../helper/folderConfig.js";
import {
  extractMetadata,
  extractRawMetadata,
  isMetadataOnly,
  getAutoIndexConfig,
} from "../helper/metadataExtractor.js";
import { injectFrontmatterTable } from "../helper/frontmatterTable.js";
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
  resolveRelativeUrls,
} from "../helper/linkValidator.js";
import { getAndIncrementBuildId } from "../helper/ursaConfig.js";
import { extractSections } from "../helper/sectionExtractor.js";
import { renderFile } from "../helper/fileRenderer.js";
import { findStyleCss } from "../helper/findStyleCss.js";
import { buildFullTextIndex } from "../helper/fullTextIndex.js";
import { copy as copyDir, emptyDir, outputFile } from "fs-extra";
import { basename, dirname, extname, join, parse, resolve } from "path";
import { URL } from "url";
import o2x from "object-to-xml";
import { existsSync } from "fs";
import { fileExists } from "../helper/fileExists.js";
import { createWhitelistFilter } from "../helper/whitelistFilter.js";
import { processAllImages, transformImageTags, clearImageCache, copyAllImagesFast } from "../helper/imageProcessor.js";
import { extractImageReferences } from "../helper/imageExtractor.js";
import {
  loadNavCache,
  saveNavCache,
  hashFileList,
  hashFileStats,
  isNavCacheValid,
  createNavCacheEntry,
  restoreMap,
} from "../helper/build/navCache.js";

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
  generateAutoIndexHtmlFromSource,
} from "../helper/build/index.js";
import { getProfiler } from "../helper/build/profiler.js";

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
  _deferImages = false,  // When true, copy images without processing, return promise for background processing
} = {}) {
  // Initialize profiler for this build
  const profiler = getProfiler(true);
  
  console.log({ _source, _meta, _output, _whitelist, _exclude, _clean, _deferImages });
  const source = resolve(_source) + "/";
  const meta = resolve(_meta);
  const output = resolve(_output) + "/";
  console.log({ source, meta, output });

  // Generate cache-busting timestamp for this build
  const cacheBustTimestamp = generateCacheBustTimestamp();
  progress.logTimed(`Cache-bust timestamp: ${cacheBustTimestamp}`);

  // Clear output directory when --clean is specified
  if (_clean) {
    progress.startTimer('Clean');
    progress.logTimed(`Clean build: clearing output directory ${output}`);
    await emptyDir(output);
    progress.logTimed(`Clean complete [${progress.stopTimer('Clean')}]`);
  }

  // Phase: Scan source files
  profiler.startPhase('Scan source files');
  progress.startTimer('Scan');
  const allSourceFilenamesUnfiltered = await recurse(source, [() => false]);
  progress.logTimed(`Scanned ${allSourceFilenamesUnfiltered.length} files [${progress.stopTimer('Scan')}]`);
  profiler.endPhase('Scan source files');
  
  // Phase: Filter and classify files
  profiler.startPhase('Filter & classify');
  progress.startTimer('Filter');
  
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
    progress.logTimed(`Exclude filter applied: ${beforeCount - allSourceFilenames.length} files excluded`);
  }
  
  // Apply whitelist filter if specified
  if (_whitelist) {
    const whitelistFilter = await createWhitelistFilter(_whitelist, source);
    allSourceFilenames = allSourceFilenames.filter(whitelistFilter);
    progress.logTimed(`Whitelist applied: ${allSourceFilenames.length} files after filtering`);
  }

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
  
  progress.logTimed(`Classified: ${allSourceFilenamesThatAreArticles.length} articles, ${allSourceFilenamesThatAreDirectories.length} dirs, ${existingHtmlFiles.size} HTML [${progress.stopTimer('Filter')}]`);
  profiler.endPhase('Filter & classify');

  // Phase: Build navigation and metadata
  profiler.startPhase('Build navigation');
  progress.startTimer('Navigation');
  
  // Check if we can use cached navigation
  let validPaths, templates, menu, menuData, customMenus, footer, buildId;
  let navCacheUsed = false;
  
  if (!_clean) {
    const fileListHash = hashFileList(allSourceFilenames);
    const fileStatsHash = await hashFileStats(allSourceFilenames);
    const navCache = await loadNavCache(source);
    
    if (isNavCacheValid(navCache, fileListHash, fileStatsHash)) {
      // Use cached navigation data
      navCacheUsed = true;
      validPaths = restoreMap(navCache.validPaths);
      menuData = navCache.menuData;
      menu = navCache.menuHtml;
      customMenus = restoreMap(navCache.customMenus);
      
      // Templates and footer still need to be loaded (they depend on meta directory)
      templates = await getTemplates(meta);
      buildId = getAndIncrementBuildId(resolve(_source));
      footer = await getFooter(source, _source, buildId);
      
      progress.logTimed(`Navigation loaded from cache: ${validPaths.size} paths, ${customMenus.size} custom menus [${progress.stopTimer('Navigation')}]`);
    } else {
      // Cache miss - build navigation from scratch
      validPaths = buildValidPaths(allSourceFilenamesThatAreArticles, source, allSourceFilenamesThatAreDirectories);
      templates = await getTemplates(meta);
      
      const menuResult = await getMenu(allSourceFilenames, source, validPaths);
      menu = menuResult.html;
      menuData = menuResult.menuData;
      
      customMenus = findAllCustomMenus(allSourceFilenames, source);
      buildId = getAndIncrementBuildId(resolve(_source));
      footer = await getFooter(source, _source, buildId);
      
      // Save to cache for next run
      const cacheEntry = createNavCacheEntry(
        fileListHash,
        fileStatsHash,
        menuData,
        menu,
        Array.from(validPaths.entries()),
        Array.from(customMenus.entries())
      );
      await saveNavCache(source, cacheEntry);
      
      progress.logTimed(`Navigation built: ${validPaths.size} paths, ${customMenus.size} custom menus [${progress.stopTimer('Navigation')}]`);
    }
  } else {
    // Clean build - ignore cache
    validPaths = buildValidPaths(allSourceFilenamesThatAreArticles, source, allSourceFilenamesThatAreDirectories);
    templates = await getTemplates(meta);
    
    const menuResult = await getMenu(allSourceFilenames, source, validPaths);
    menu = menuResult.html;
    menuData = menuResult.menuData;
    
    customMenus = findAllCustomMenus(allSourceFilenames, source);
    buildId = getAndIncrementBuildId(resolve(_source));
    footer = await getFooter(source, _source, buildId);
    
    progress.logTimed(`Navigation built (clean): ${validPaths.size} paths, ${customMenus.size} custom menus [${progress.stopTimer('Navigation')}]`);
  }
  
  profiler.endPhase('Build navigation');

  // Phase: Load cache
  profiler.startPhase('Load cache');
  progress.startTimer('Cache');
  
  // Load content hash cache from .ursa folder in source directory
  let hashCache = new Map();
  if (!_clean) {
    hashCache = await loadHashCache(source);
    progress.logTimed(`Loaded ${hashCache.size} cached hashes [${progress.stopTimer('Cache')}]`);
  } else {
    progress.logTimed(`Clean build: ignoring cached hashes`);
    progress.stopTimer('Cache');
  }
  profiler.endPhase('Load cache');

  // Phase: Copy meta/public files
  profiler.startPhase('Copy meta files');
  progress.startTimer('Meta');
  
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
  
  progress.logTimed(`Meta files copied and processed [${progress.stopTimer('Meta')}]`);
  profiler.endPhase('Copy meta files');

  // Track errors for error report
  const errors = [];

  // Search index: built incrementally during article processing (lighter memory footprint)
  const searchIndex = [];
  // Full-text index: collect documents for word-to-document mapping
  const fullTextDocs = [];
  // Directory index cache: only stores minimal data needed for directory indices
  // Uses WeakRef-style approach - store only what's needed, clear as we go
  const dirIndexCache = new Map();
  
  // Track CSS files that have been copied to avoid duplicates
  const copiedCssFiles = new Set();

  // Identify all image files from the filtered source list
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|ico)/;
  let allSourceFilenamesThatAreImages = allSourceFilenames.filter(
    (filename) => filename.match(imageExtensions) && !filename.match(hiddenOrSystemDirs)
  );
  
  // When using a whitelist, also include images referenced by whitelisted documents
  // This ensures that images used in whitelisted articles are processed even if not explicitly whitelisted
  if (_whitelist) {
    progress.logTimed('Scanning whitelisted articles for image references...');
    const referencedImages = new Set();
    
    for (const articlePath of allSourceFilenamesThatAreArticles) {
      try {
        const content = await readFile(articlePath, 'utf8');
        const imageRefs = extractImageReferences(content, articlePath, source);
        imageRefs.forEach(img => referencedImages.add(img));
      } catch (e) {
        // Ignore read errors - file might not exist or be unreadable
      }
    }
    
    // Get all images from the unfiltered source list that are referenced
    const allImagesUnfiltered = allSourceFilenamesUnfiltered.filter(
      (filename) => filename.match(imageExtensions) && !filename.match(hiddenOrSystemDirs)
    );
    
    // Add referenced images that aren't already in the list
    const additionalImages = allImagesUnfiltered.filter(
      img => referencedImages.has(img) && !allSourceFilenamesThatAreImages.includes(img)
    );
    
    if (additionalImages.length > 0) {
      progress.logTimed(`Found ${additionalImages.length} additional images referenced by whitelisted documents`);
      allSourceFilenamesThatAreImages = [...allSourceFilenamesThatAreImages, ...additionalImages];
    }
  }
  
  // Phase: Process images
  profiler.startPhase('Process images');
  progress.startTimer('Images');
  
  // Handle images based on deferred mode
  let imageMap = new Map();
  let deferredImageProcessingPromise = null;
  
  if (_deferImages) {
    // Fast mode: just copy images without processing, defer preview generation
    progress.logTimed(`Copying ${allSourceFilenamesThatAreImages.length} images (preview generation deferred)...`);
    await copyAllImagesFast(
      allSourceFilenamesThatAreImages,
      source,
      output,
      (current, total, path) => {
        progress.status('Images (copy)', `${current}/${total} ${path}`);
      }
    );
    progress.done('Images (copy)', `${allSourceFilenamesThatAreImages.length} copied (previews deferred)`);
    profiler.endPhase('Process images');
    
    // Create promise for background image processing (will be returned to caller)
    deferredImageProcessingPromise = (async () => {
      progress.logTimed(`\n🖼️  Starting deferred image preview generation...`);
      const startTime = Date.now();
      const processedImageMap = await processAllImages(
        allSourceFilenamesThatAreImages,
        source,
        output,
        (current, total, path) => {
          progress.status('Images (previews)', `${current}/${total} ${path}`);
        }
      );
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      progress.done('Images (previews)', `${allSourceFilenamesThatAreImages.length} done (${processedImageMap.size} with previews) in ${elapsed}s`);
      
      // Update the watch cache with the processed image map
      watchModeCache.imageMap = processedImageMap;
      
      return processedImageMap;
    })();
  } else {
    // Normal mode: process all images FIRST to build the preview image map
    // This is done before articles so we can transform img tags in the HTML
    progress.logTimed(`Processing ${allSourceFilenamesThatAreImages.length} images for preview generation...`);
    imageMap = await processAllImages(
      allSourceFilenamesThatAreImages,
      source,
      output,
      (current, total, path) => {
        progress.status('Images', `${current}/${total} ${path}`);
      }
    );
    progress.done('Images', `${allSourceFilenamesThatAreImages.length} done (${imageMap.size} with previews) [${progress.stopTimer('Images')}]`);
    profiler.endPhase('Process images');
  }

  // Phase: Process articles
  profiler.startPhase('Process articles');
  progress.startTimer('Articles');
  
  // Track files that were regenerated (for incremental mode stats)
  let regeneratedCount = 0;
  let skippedCount = 0;
  let processedCount = 0;
  const totalArticles = allSourceFilenamesThatAreArticles.length;

  progress.logTimed(`Processing ${totalArticles} articles in batches of ${BATCH_SIZE}...`);

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

      // Add document to full-text index (uses raw markdown content)
      fullTextDocs.push({
        path: relativePath,
        title: title,
        content: rawBody
      });
      
      // Check if a corresponding .html file already exists in source directory
      const outputHtmlRelative = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
      if (existingHtmlFiles.has(outputHtmlRelative)) {
        progress.log(`⚠️  Warning: Skipping ${shortFile} - would overwrite existing ${outputHtmlRelative} in source`);
        skippedCount++;
        return;
      }

      // Skip metadata-only index files - they exist only to provide folder metadata
      // The auto-index system will generate the actual index.html for these folders
      if (base === 'index' && type === '.md' && isMetadataOnly(rawBody)) {
        progress.log(`ℹ️  Skipping metadata-only ${shortFile} - auto-index will generate listing`);
        skippedCount++;
        return;
      }

      // Check if file needs regeneration
      const needsRegen = _clean || needsRegeneration(file, rawBody, hashCache);
      
      if (!needsRegen) {
        skippedCount++;
        // For directory indices, store minimal data (not full bodyHtml)
        // But include metadata for directory JSON files
        const skippedMeta = extractMetadata(rawBody);
        dirIndexCache.set(file, {
          name: base,
          url,
          metadata: skippedMeta,
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

      let body = renderFile({
        fileContents: rawBody,
        type,
        dirname: dir,
        basename: base,
      });

      // Inject frontmatter table after first H1 (for markdown files with metadata)
      if (type === '.md' && fileMeta) {
        body = injectFrontmatterTable(body, fileMeta);
      }

      // Handle auto-index generation for index files with generate-auto-index: true
      if (base === 'index' && fileMeta) {
        const autoIndexConfig = getAutoIndexConfig(fileMeta);
        if (autoIndexConfig.enabled) {
          // Generate auto-index HTML for this directory from source
          // Using source avoids race conditions with concurrent file generation
          const sourceDir = dirname(file);
          const autoIndexHtml = await generateAutoIndexHtmlFromSource(sourceDir, autoIndexConfig.depth);
          
          if (autoIndexHtml) {
            if (autoIndexConfig.position === 'bottom') {
              body = body + '\n' + autoIndexHtml;
            } else {
              body = autoIndexHtml + '\n' + body;
            }
          }
        }
      }

      // Find nearest style.css or _style.css up the tree and copy to output
      // Use cache to avoid repeated filesystem walks for same directory
      let styleLink = "";
      try {
        // For root-level files, dir may be "/" which would resolve to filesystem root
        // Use source directory directly in that case
        const dirKey = (dir === "/" || dir === "") ? _source : resolve(_source, dir);
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

      // Resolve relative URLs in raw HTML elements (img src, etc.)
      finalHtml = resolveRelativeUrls(finalHtml, docUrlPath);
      
      // Resolve links and mark broken internal links as inactive
      finalHtml = markInactiveLinks(finalHtml, validPaths, docUrlPath, false);

      // Transform image tags to use preview images with data-fullsrc for originals
      // Skip in deferred mode - images will use original paths until preview generation completes
      if (!_deferImages) {
        finalHtml = transformImageTags(finalHtml, imageMap, docUrlPath);
      }

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
      
      // Store minimal data for directory indices, including metadata
      dirIndexCache.set(file, {
        name: base,
        url,
        metadata: fileMeta,
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
  progress.done('Articles', `${totalArticles} done (${regeneratedCount} regenerated, ${skippedCount} unchanged) [${progress.stopTimer('Articles')}]`);
  profiler.endPhase('Process articles');

  // Phase: Write search index
  profiler.startPhase('Write search index');
  progress.startTimer('Search index');
  // Write search index as a separate JSON file (not embedded in each page)
  const searchIndexPath = join(output, 'public', 'search-index.json');
  progress.log(`Writing search index with ${searchIndex.length} entries`);
  await outputFile(searchIndexPath, JSON.stringify(searchIndex));

  // Build and write full-text index
  progress.log(`Building full-text index from ${fullTextDocs.length} documents...`);
  const fullTextIndex = buildFullTextIndex(fullTextDocs);
  const fullTextIndexPath = join(output, 'public', 'fulltext-index.json');
  const fullTextIndexJson = JSON.stringify(fullTextIndex);
  const wordCount = Object.keys(fullTextIndex).length;
  progress.log(`Writing full-text index (${wordCount} unique words, ${(fullTextIndexJson.length / 1024).toFixed(1)} KB)`);
  await outputFile(fullTextIndexPath, fullTextIndexJson);
  progress.done('Search index', `${searchIndex.length} entries, ${wordCount} words [${progress.stopTimer('Search index')}]`);
  profiler.endPhase('Write search index');

  // Phase: Write menu data
  profiler.startPhase('Write menu data');
  progress.startTimer('Menu data');
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
  progress.done('Menu data', `${customMenus.size + 1} files [${progress.stopTimer('Menu data')}]`);
  profiler.endPhase('Write menu data');

  // Phase: Process directory indices
  profiler.startPhase('Process directories');
  progress.startTimer('Directories');
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
  
  progress.done('Directories', `${totalDirs} done [${progress.stopTimer('Directories')}]`);
  profiler.endPhase('Process directories');

  // Clear directory index cache to free memory before processing static files
  dirIndexCache.clear();

  // Phase: Process static files
  profiler.startPhase('Process static files');
  progress.startTimer('Static files');
  // Copy static HTML files (images were already processed above with preview generation)
  // Note: Images are processed before articles to enable preview transformation in HTML
  
  // Also copy existing HTML files from source to output (they're treated as static)
  const allSourceFilenamesThatAreHtml = allSourceFilenames.filter(
    (filename) => filename.match(/\.html$/) && !filename.match(hiddenOrSystemDirs)
  );
  
  const allStaticFiles = allSourceFilenamesThatAreHtml;
  const totalStatic = allStaticFiles.length;
  let processedStatic = 0;
  let copiedStatic = 0;
  progress.log(`Processing ${totalStatic} static HTML files...`);
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
      } else if (file.endsWith('.html')) {
        // Process HTML files for link resolution
        let htmlContent = await readFile(file, 'utf8');
        // Calculate the document's URL path for relative link resolution
        const docUrlPath = '/' + file.replace(source, '').replace(/^\//, '');
        // Resolve relative URLs in raw HTML elements (img src, etc.)
        htmlContent = resolveRelativeUrls(htmlContent, docUrlPath);
        // Resolve internal links to have proper .html extensions
        htmlContent = markInactiveLinks(htmlContent, validPaths, docUrlPath, false);
        // Transform image tags to use preview images with data-fullsrc for originals
        // Skip in deferred mode - images will use original paths until preview generation completes
        if (!_deferImages) {
          htmlContent = transformImageTags(htmlContent, imageMap, docUrlPath);
        }
        // Add cache-busting timestamps
        htmlContent = addTimestampToHtmlStaticRefs(htmlContent, cacheBustTimestamp);
        await outputFile(outputFilename, htmlContent);
      } else {
        await copyFile(file, outputFilename);
      }
    } catch (e) {
      progress.log(`Error processing static file ${file}: ${e.message}`);
      errors.push({ file, phase: 'static-file', error: e });
    }
  });
  
  progress.done('Static files', `${totalStatic} done (${copiedStatic} copied) [${progress.stopTimer('Static files')}]`);
  profiler.endPhase('Process static files');

  // Phase: Auto-index generation
  profiler.startPhase('Auto-index generation');
  progress.startTimer('Auto-index');
  // Automatic index generation for folders without index.html
  progress.log(`Checking for missing index files...`);
  await generateAutoIndices(output, allSourceFilenamesThatAreDirectories, source, templates, menu, footer, allSourceFilenamesThatAreArticles, copiedCssFiles, existingHtmlFiles, cacheBustTimestamp, progress);
  progress.done('Auto-index', `checked ${allSourceFilenamesThatAreDirectories.length} directories [${progress.stopTimer('Auto-index')}]`);
  profiler.endPhase('Auto-index generation');

  // Phase: Finalization
  profiler.startPhase('Finalization');
  progress.startTimer('Finalization');
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
  watchModeCache.imageMap = imageMap;
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
  
  progress.done('Finalization', `complete [${progress.stopTimer('Finalization')}]`);
  profiler.endPhase('Finalization');
  
  // Print profiler report
  progress.log(profiler.report());
  
  // Return deferred image processing promise if in deferred mode
  // Caller can await this to know when image previews are ready
  return {
    deferredImageProcessing: deferredImageProcessingPromise
  };
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
    const { templates, menu, footer, validPaths, hashCache, cacheBustTimestamp, imageMap } = watchModeCache;
    
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
    let body = renderFile({
      fileContents: rawBody,
      type,
      dirname: dir,
      basename: base,
    });
    
    // Inject frontmatter table for markdown files
    if (type === '.md' && fileMeta) {
      body = injectFrontmatterTable(body, fileMeta);
    }

    // Handle auto-index generation for index files with generate-auto-index: true
    if (base === 'index' && fileMeta) {
      const autoIndexConfig = getAutoIndexConfig(fileMeta);
      if (autoIndexConfig.enabled) {
        // Generate auto-index HTML for this directory from source
        const sourceDir = dirname(changedFile);
        const autoIndexHtml = await generateAutoIndexHtmlFromSource(sourceDir, autoIndexConfig.depth);
        
        if (autoIndexHtml) {
          if (autoIndexConfig.position === 'bottom') {
            body = body + '\n' + autoIndexHtml;
          } else {
            body = autoIndexHtml + '\n' + body;
          }
        }
      }
    }

    // Find CSS and copy to output
    let styleLink = "";
    try {
      // For root-level files, dir may be "/" which would resolve to filesystem root
      const dirKey = (dir === "/" || dir === "") ? _source : resolve(_source, dir);
      const cssPath = await findStyleCss(dirKey);
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
    
    // Resolve relative URLs in raw HTML elements (img src, etc.)
    finalHtml = resolveRelativeUrls(finalHtml, docUrlPath);
    
    // Mark broken links
    finalHtml = markInactiveLinks(finalHtml, validPaths, docUrlPath, false);
    
    // Transform image tags to use preview images with data-fullsrc for originals
    if (imageMap) {
      finalHtml = transformImageTags(finalHtml, imageMap, docUrlPath);
    }
    
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