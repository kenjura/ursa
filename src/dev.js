/**
 * Dev Mode - On-demand document rendering without pre-processing
 * 
 * This mode starts a server immediately and renders documents on request.
 * Background tasks build caches for search, navigation, styles, etc.
 */

import express from "express";
import compression from "compression";
import watch from "node-watch";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { join, resolve, dirname, basename, parse, extname } from "path";
import { existsSync, promises, readFileSync } from "fs";
import fsExtra from "fs-extra";

const { outputFile, copy: copyDir } = fsExtra;
const { readFile, readdir, stat, mkdir } = promises;

// Import helper modules
import { renderFileAsync } from "./helper/fileRenderer.js";
import { findStyleCss } from "./helper/findStyleCss.js";
import { findScriptJs } from "./helper/findScriptJs.js";
import { extractMetadata, getAutoIndexConfig, isMetadataOnly } from "./helper/metadataExtractor.js";
import { injectFrontmatterTable } from "./helper/frontmatterTable.js";
import { buildValidPaths, markInactiveLinks, resolveRelativeUrls } from "./helper/linkValidator.js";
import { buildFullTextIndex } from "./helper/fullTextIndex.js";
import { getAutomenu } from "./helper/automenu.js";
import { renderFile } from "./helper/fileRenderer.js";
import { processImage } from "./helper/imageProcessor.js";
import { extractImageReferences } from "./helper/imageExtractor.js";
import { recurse } from "./helper/recursive-readdir.js";
import { isFolderHidden, clearConfigCache } from "./helper/folderConfig.js";
import { extractSections } from "./helper/sectionExtractor.js";
import { getTemplates, getMenu, findAllCustomMenus, getCustomMenuForFile, getTransformedMetadata, getFooter, toTitleCase, addTrailingSlash, generateAutoIndexHtmlFromSource } from "./helper/build/index.js";
import { findCustomMenu, extractMenuFrontmatter, parseCustomMenu, combineAutoAndManualMenu } from "./helper/customMenu.js";
import { getAndIncrementBuildId } from "./helper/ursaConfig.js";

// Dev mode state
const devState = {
  // Core paths
  source: null,
  meta: null,
  output: null,
  
  // Background cache status
  cacheReady: false,
  searchReady: false,
  menuReady: false,
  
  // Caches built in background
  templates: null,
  validPaths: null,
  menuHtml: null,
  menuData: null,
  customMenus: null,
  footer: null,
  fullTextIndex: null,
  searchIndex: null,
  
  // Path → nearest menu.md mapping
  menuPathMap: new Map(),
  // Path → nearest style.css mapping  
  stylePathMap: new Map(),
  // Path → nearest script.js mapping
  scriptPathMap: new Map(),
  // Config.json cache
  configCache: new Map(),
  // Image preview cache
  imageCache: new Map(),
  // Rendered document cache (path → html)
  documentCache: new Map(),
  
  // WebSocket clients
  wsClients: new Set(),
  
  // Build ID
  buildId: null,
};

// WebSocket server reference
let wss = null;

/**
 * Broadcast a message to all connected WebSocket clients
 */
function broadcast(type, data = {}) {
  if (!wss) return;
  const message = JSON.stringify({ type, ...data, timestamp: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

/**
 * Get hot reload client script
 */
function getHotReloadScript(wsPort) {
  return `
<!-- Ursa Dev Mode Hot Reload -->
<script>
(function() {
  const wsUrl = 'ws://' + window.location.hostname + ':${wsPort}';
  let ws;
  let reconnectAttempts = 0;
  
  function showStatus(message, type) {
    let statusEl = document.getElementById('ursa-dev-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'ursa-dev-status';
      statusEl.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;border-radius:8px;font-family:system-ui;font-size:14px;z-index:99999;transition:all 0.3s ease;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
      document.body.appendChild(statusEl);
    }
    statusEl.textContent = message;
    if (type === 'ready') {
      statusEl.style.background = '#10b981';
      statusEl.style.color = 'white';
      setTimeout(() => { statusEl.style.opacity = '0'; setTimeout(() => statusEl.remove(), 300); }, 3000);
    } else if (type === 'building') {
      statusEl.style.background = '#f59e0b';
      statusEl.style.color = 'white';
      statusEl.style.opacity = '1';
    } else if (type === 'error') {
      statusEl.style.background = '#ef4444';
      statusEl.style.color = 'white';
      statusEl.style.opacity = '1';
    }
  }
  
  function connect() {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
      console.log('[Ursa Dev] Connected');
      reconnectAttempts = 0;
    };
    
    ws.onmessage = function(event) {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'reload':
            console.log('[Ursa Dev] Reloading page...');
            window.location.reload();
            break;
          case 'search-ready':
            console.log('[Ursa Dev] Search index ready');
            showStatus('Search ready', 'ready');
            // Enable search functionality
            const searchInput = document.getElementById('global-search');
            if (searchInput) {
              searchInput.disabled = false;
              searchInput.placeholder = 'Search...';
            }
            break;
          case 'menu-ready':
            console.log('[Ursa Dev] Menu ready');
            // Menu data is available, could refresh nav
            break;
          case 'cache-ready':
            console.log('[Ursa Dev] Background cache ready');
            showStatus('Cache ready', 'ready');
            break;
          case 'building':
            showStatus(data.message || 'Building...', 'building');
            break;
        }
      } catch (e) {
        console.error('[Ursa Dev] Message error:', e);
      }
    };
    
    ws.onclose = function() {
      if (reconnectAttempts < 10) {
        reconnectAttempts++;
        console.log('[Ursa Dev] Reconnecting... (' + reconnectAttempts + '/10)');
        setTimeout(connect, 1000);
      }
    };
  }
  
  connect();
})();
</script>
`;
}

/**
 * Resolve a URL path to a source file
 * @param {string} urlPath - The requested URL path (e.g., /foo/bar)
 * @returns {Promise<{sourcePath: string, type: string} | null>}
 */
async function resolveSourceFile(urlPath) {
  const { source } = devState;
  
  // Normalize path
  let cleanPath = urlPath.replace(/\.html$/, '');
  if (cleanPath.endsWith('/')) cleanPath += 'index';
  if (cleanPath === '') cleanPath = '/index';
  
  // Remove leading slash for joining
  const relativePath = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
  
  // Try different file extensions and patterns
  const candidates = [
    { path: join(source, relativePath + '.md'), type: '.md' },
    { path: join(source, relativePath + '.mdx'), type: '.mdx' },
    { path: join(source, relativePath + '.txt'), type: '.txt' },
    { path: join(source, relativePath, 'index.md'), type: '.md' },
    { path: join(source, relativePath, 'index.mdx'), type: '.mdx' },
    { path: join(source, relativePath, 'index.txt'), type: '.txt' },
  ];
  
  // Also try folder-named file (e.g., /foo/bar -> /foo/bar/bar.md)
  const folderName = basename(relativePath);
  if (folderName) {
    candidates.push(
      { path: join(source, relativePath, folderName + '.md'), type: '.md' },
      { path: join(source, relativePath, folderName + '.mdx'), type: '.mdx' },
      { path: join(source, relativePath, folderName + '.txt'), type: '.txt' }
    );
  }
  
  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return { sourcePath: candidate.path, type: candidate.type };
    }
  }
  
  return null;
}

/**
 * Find the nearest menu.md in the path tree
 */
function findNearestMenu(dirPath) {
  const { source, menuPathMap } = devState;
  
  // Check cache first
  if (menuPathMap.has(dirPath)) {
    return menuPathMap.get(dirPath);
  }
  
  let currentDir = dirPath;
  while (currentDir.startsWith(source) || currentDir === source) {
    const menuFiles = ['menu.md', 'menu.txt', '_menu.md', '_menu.txt'];
    for (const menuFile of menuFiles) {
      const menuPath = join(currentDir, menuFile);
      if (existsSync(menuPath)) {
        menuPathMap.set(dirPath, menuPath);
        return menuPath;
      }
    }
    
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  
  menuPathMap.set(dirPath, null);
  return null;
}

/**
 * Find the nearest style.css
 */
async function findNearestStyle(dirPath) {
  const { stylePathMap } = devState;
  
  // Check cache first
  if (stylePathMap.has(dirPath)) {
    return stylePathMap.get(dirPath);
  }
  
  const stylePath = await findStyleCss(dirPath);
  stylePathMap.set(dirPath, stylePath);
  return stylePath;
}

/**
 * Find the nearest script.js
 */
async function findNearestScript(dirPath) {
  const { scriptPathMap } = devState;
  
  // Check cache first
  if (scriptPathMap.has(dirPath)) {
    return scriptPathMap.get(dirPath);
  }
  
  const scriptPath = await findScriptJs(dirPath);
  scriptPathMap.set(dirPath, scriptPath);
  return scriptPath;
}

/**
 * Process images in a document and generate previews if needed
 */
async function processDocumentImages(htmlContent, sourcePath) {
  const { source, output, imageCache } = devState;
  
  // Extract image references
  const imageRefs = extractImageReferences(htmlContent, sourcePath, source);
  
  for (const imagePath of imageRefs) {
    // Skip if already processed
    if (imageCache.has(imagePath)) continue;
    
    if (existsSync(imagePath)) {
      try {
        const relativeDir = dirname(imagePath.replace(source, ''));
        const outputDir = join(output, relativeDir);
        const result = await processImage(imagePath, outputDir, relativeDir);
        if (result) {
          imageCache.set(imagePath, result);
        }
      } catch (e) {
        console.error(`Error processing image ${imagePath}:`, e.message);
      }
    }
  }
  
  return htmlContent;
}

/**
 * Render a single document on demand
 */
async function renderDocument(urlPath) {
  const { source, meta, output, templates, validPaths, menuHtml, footer, documentCache, imageCache } = devState;
  
  // Check document cache
  // For now, we won't cache in dev mode to always show latest changes
  // if (documentCache.has(urlPath)) {
  //   return documentCache.get(urlPath);
  // }
  
  // Resolve source file
  const resolved = await resolveSourceFile(urlPath);
  if (!resolved) {
    return null;
  }
  
  const { sourcePath, type } = resolved;
  const ext = type;
  const base = basename(sourcePath, ext);
  const dir = addTrailingSlash(dirname(sourcePath)).replace(source, "");
  
  // Read and render content
  const rawBody = await readFile(sourcePath, "utf8");
  
  // Check if this is a metadata-only file
  if (base === 'index' && type === '.md' && isMetadataOnly(rawBody)) {
    // Generate auto-index for this directory
    const sourceDir = dirname(sourcePath);
    const autoIndexHtml = await generateAutoIndexHtmlFromSource(sourceDir, 2);
    if (autoIndexHtml) {
      // Wrap in template and return
      return await wrapInTemplate(autoIndexHtml, 'Index', null, urlPath, sourcePath);
    }
  }
  
  // Render body
  let body = await renderFileAsync({
    fileContents: rawBody,
    type,
    dirname: dir,
    basename: base,
    filePath: sourcePath,
    sourceRoot: devState.source,
    useWorker: false // Use main thread for faster single-file processing
  });
  
  const fileMeta = extractMetadata(rawBody);
  
  // Inject frontmatter table for markdown/mdx files
  if ((type === '.md' || type === '.mdx') && fileMeta) {
    body = injectFrontmatterTable(body, fileMeta);
  }
  
  // Handle auto-index generation for index files
  if (base === 'index' && fileMeta) {
    const autoIndexConfig = getAutoIndexConfig(fileMeta);
    if (autoIndexConfig.enabled) {
      const sourceDir = dirname(sourcePath);
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
  
  // Process images in this document
  body = await processDocumentImages(body, sourcePath);
  
  const title = toTitleCase(base);
  const html = await wrapInTemplate(body, title, fileMeta, urlPath, sourcePath);
  
  // Cache rendered document
  // documentCache.set(urlPath, html);
  
  return html;
}

/**
 * Wrap body in template
 */
async function wrapInTemplate(body, title, fileMeta, urlPath, sourcePath) {
  const { source, output, templates, menuHtml, footer, validPaths, customMenus } = devState;
  
  // Get template
  const requestedTemplateName = fileMeta?.template;
  const template = templates[requestedTemplateName] || templates['default-template'];
  
  if (!template) {
    throw new Error(`Template not found: ${requestedTemplateName || 'default-template'}`);
  }
  
  // Find nearest style.css
  let styleLink = "";
  try {
    const styleDir = sourcePath ? dirname(sourcePath) : source;
    const cssPath = await findNearestStyle(styleDir);
    if (cssPath) {
      const cssUrlPath = '/' + cssPath.replace(source, '');
      styleLink = `<link rel="stylesheet" href="${cssUrlPath}" />`;
      
      // Copy CSS file to output
      const cssOutputPath = cssPath.replace(source, output);
      const cssContent = await readFile(cssPath, 'utf8');
      await outputFile(cssOutputPath, cssContent);
    }
  } catch (e) {
    // Ignore CSS errors
  }
  
  // Find nearest script.js and inline its contents
  let customScript = "";
  try {
    const scriptDir = sourcePath ? dirname(sourcePath) : source;
    const scriptPath = await findNearestScript(scriptDir);
    if (scriptPath) {
      const scriptContent = await readFile(scriptPath, 'utf8');
      customScript = `<script>\n${scriptContent}\n</script>`;
    }
  } catch (e) {
    // Ignore script errors
  }
  
  // Use auto-menu if background menu not ready yet
  const menu = menuHtml || '<nav id="nav-global"><p>Loading menu...</p></nav>';
  
  // Calculate document URL path
  const docUrlPath = urlPath.endsWith('.html') ? urlPath : urlPath + '.html';
  
  // Build replacements
  const replacements = {
    "${title}": title,
    "${menu}": menu,
    "${meta}": JSON.stringify(fileMeta || {}),
    "${transformedMetadata}": "",
    "${body}": body,
    "${styleLink}": styleLink,
    "${customScript}": customScript,
    "${searchIndex}": "[]",
    "${footer}": footer || ""
  };
  
  // Single-pass replacement
  const pattern = /\$\{(title|menu|meta|transformedMetadata|body|styleLink|customScript|searchIndex|footer)\}/g;
  let finalHtml = template.replace(pattern, (match) => replacements[match] ?? match);
  
  // Check for custom menu
  if (sourcePath && customMenus) {
    const customMenuInfo = getCustomMenuForFile(sourcePath, source, customMenus);
    if (customMenuInfo) {
      const menuPosition = customMenuInfo.menuPosition || 'side';
      finalHtml = finalHtml.replace(
        /<body([^>]*)>/,
        `<body$1 data-custom-menu="${customMenuInfo.menuJsonPath}" data-menu-position="${menuPosition}">`
      );
    }
  }
  
  // Resolve relative URLs
  finalHtml = resolveRelativeUrls(finalHtml, docUrlPath);
  
  // Mark inactive links (only if validPaths is ready)
  if (validPaths) {
    finalHtml = markInactiveLinks(finalHtml, validPaths, docUrlPath, false);
  }
  
  return finalHtml;
}

/**
 * Build background caches
 */
async function buildBackgroundCaches() {
  const { source, output, meta } = devState;
  
  console.log('🔄 Building background caches...');
  broadcast('building', { message: 'Building caches...' });
  
  try {
    // 1. Scan source tree
    console.log('   📂 Scanning docroot tree...');
    const allSourceFiles = await recurse(source, [() => false]);
    
    // Filter hidden folders
    const hiddenOrSystemDirs = /[\/\\]\.(?!\.)|[\/\\]node_modules[\/\\]/;
    const articleExtensions = /\.(md|mdx|txt|yml)/;
    
    const allArticles = allSourceFiles.filter(f => 
      f.match(articleExtensions) && !f.match(hiddenOrSystemDirs) && !isFolderHidden(dirname(f), source)
    );
    
    const allDirectories = [];
    const seenDirs = new Set();
    for (const f of allSourceFiles) {
      try {
        const s = await stat(f);
        if (s.isDirectory() && !f.match(hiddenOrSystemDirs) && !isFolderHidden(f, source)) {
          if (!seenDirs.has(f)) {
            seenDirs.add(f);
            allDirectories.push(f);
          }
        }
      } catch (e) {}
    }
    
    // Also add all parent directories of articles
    for (const article of allArticles) {
      let dir = dirname(article);
      while (dir.startsWith(source) && !seenDirs.has(dir)) {
        seenDirs.add(dir);
        if (!dir.match(hiddenOrSystemDirs)) {
          allDirectories.push(dir);
        }
        dir = dirname(dir);
      }
    }
    
    // 2. Build valid paths for link validation
    console.log('   🔗 Building valid paths...');
    devState.validPaths = buildValidPaths(allArticles, source, allDirectories);
    
    // 3. Build menu
    console.log('   📋 Building navigation menu...');
    const menuResult = await getMenu(allSourceFiles, source, devState.validPaths);
    devState.menuHtml = renderFile({ fileContents: menuResult.html, type: ".md" });
    devState.menuData = menuResult.menuData;
    
    // 4. Find custom menus
    console.log('   📑 Finding custom menus...');
    devState.customMenus = findAllCustomMenus(allSourceFiles, source);
    
    // Write custom menu JSON files
    for (const [menuDir, menuInfo] of devState.customMenus) {
      const customMenuPath = join(output, menuInfo.menuJsonPath);
      const customMenuJson = JSON.stringify({
        menuData: menuInfo.menuData,
        menuPosition: menuInfo.menuPosition || 'side',
      });
      await outputFile(customMenuPath, customMenuJson);
    }
    
    // 5. Build menu path mapping
    console.log('   🗺️ Building menu path mapping...');
    for (const file of allSourceFiles) {
      const dir = dirname(file);
      findNearestMenu(dir);
    }
    
    // 6. Build style path mapping
    console.log('   🎨 Mapping stylesheets...');
    for (const file of allArticles) {
      const dir = dirname(file);
      await findNearestStyle(dir);
    }
    
    // 7. Pre-load templates
    console.log('   📄 Pre-loading templates...');
    devState.templates = await getTemplates(meta);
    
    // 8. Build footer
    console.log('   📝 Building footer...');
    devState.buildId = getAndIncrementBuildId(resolve(source));
    devState.footer = await getFooter(source, source, devState.buildId);
    
    devState.cacheReady = true;
    devState.menuReady = true;
    console.log('✅ Background caches ready');
    broadcast('cache-ready');
    broadcast('menu-ready');
    
    // 9. Build search index in background
    console.log('🔍 Building search index...');
    broadcast('building', { message: 'Building search index...' });
    
    const searchIndex = [];
    const fullTextDocs = [];
    
    for (const article of allArticles) {
      try {
        const content = await readFile(article, 'utf8');
        const ext = extname(article);
        const base = basename(article, ext);
        const relativePath = article.replace(source, '').replace(/\.(md|txt|yml)$/, '.html');
        const title = toTitleCase(base);
        
        searchIndex.push({
          title,
          path: relativePath,
          url: relativePath.startsWith('/') ? relativePath : '/' + relativePath,
          content: ''
        });
        
        fullTextDocs.push({
          path: relativePath,
          title,
          content
        });
      } catch (e) {}
    }
    
    // Build full-text index
    devState.fullTextIndex = buildFullTextIndex(fullTextDocs);
    devState.searchIndex = searchIndex;
    
    // Write search index files
    const publicDir = join(output, 'public');
    await mkdir(publicDir, { recursive: true });
    
    await outputFile(join(publicDir, 'search-index.json'), JSON.stringify(searchIndex));
    await outputFile(join(publicDir, 'fulltext-index.json'), JSON.stringify(devState.fullTextIndex));
    await outputFile(join(publicDir, 'menu-data.json'), JSON.stringify(devState.menuData));
    
    devState.searchReady = true;
    console.log('✅ Search index ready');
    broadcast('search-ready');
    
  } catch (error) {
    console.error('Error building background caches:', error);
  }
}

/**
 * Start the dev server
 */
export async function dev({
  _source,
  _meta,
  _output,
  port = 8080,
} = {}) {
  const sourceDir = resolve(_source);
  const metaDir = resolve(_meta);
  const outputDir = resolve(_output);
  
  // Initialize state
  devState.source = sourceDir + '/';
  devState.meta = metaDir;
  devState.output = outputDir + '/';
  
  console.log('🚀 Ursa Dev Mode');
  console.log('━'.repeat(50));
  console.log(`📁 Source: ${sourceDir}`);
  console.log(`🎨 Meta: ${metaDir}`);
  console.log(`📤 Output: ${outputDir}`);
  console.log('━'.repeat(50));
  
  // Create output directory and copy meta files
  await mkdir(outputDir, { recursive: true });
  const publicDir = join(outputDir, 'public');
  await mkdir(publicDir, { recursive: true });
  await copyDir(metaDir, publicDir);
  
  // Pre-load templates for immediate use
  devState.templates = await getTemplates(metaDir);
  
  // Start server immediately
  const app = express();
  const httpServer = createServer(app);
  const wsPort = port + 1;
  
  // WebSocket server
  wss = new WebSocketServer({ port: wsPort });
  wss.on('connection', (ws) => {
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) ws.ping();
    }, 30000);
    ws.on('close', () => clearInterval(pingInterval));
  });
  
  // Enable compression
  app.use(compression({
    threshold: 1024,
    level: 6
  }));
  
  // Dev mode document handler
  app.use(async (req, res, next) => {
    const url = req.url;
    
    // Handle search index requests
    if (url === '/public/search-index.json' || url === '/public/fulltext-index.json') {
      if (!devState.searchReady) {
        res.setHeader('Content-Type', 'application/json');
        return res.send(JSON.stringify({ ready: false, message: 'Search index is being built...' }));
      }
    }
    
    // Handle menu data requests
    if (url === '/public/menu-data.json') {
      if (!devState.menuReady) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.send(JSON.stringify({ ready: false, message: 'Menu is being built...' }));
      }
    }
    
    // Handle custom menu JSON requests - regenerate fresh on each request in dev mode
    if (url.startsWith('/public/custom-menu-') && url.endsWith('.json')) {
      // Find the menuDir from the cached customMenus by matching the JSON path
      let menuDir = null;
      let menuPosition = 'side';
      
      if (devState.customMenus) {
        for (const [dir, menuInfo] of devState.customMenus) {
          if (menuInfo.menuJsonPath === url) {
            menuDir = dir;
            menuPosition = menuInfo.menuPosition || 'side';
            break;
          }
        }
      }
      
      if (menuDir) {
        // Regenerate menu fresh from disk
        const menuInfo = findCustomMenu(menuDir, sourceDir);
        if (menuInfo) {
          const { frontmatter, body } = extractMenuFrontmatter(menuInfo.content);
          const autoGenerate = frontmatter['auto-generate-menu'] === true || frontmatter['auto-generate-menu'] === 'true';
          const depth = parseInt(frontmatter['menu-depth'], 10) || 2;
          menuPosition = frontmatter['menu-position'] || menuPosition;
          
          let menuData;
          if (autoGenerate) {
            menuData = combineAutoAndManualMenu(body, menuInfo.menuDir, sourceDir, depth);
          } else {
            menuData = parseCustomMenu(body, menuInfo.menuDir, sourceDir);
          }
          
          // Update the cached customMenus with fresh data
          if (devState.customMenus) {
            const cachedInfo = devState.customMenus.get(menuDir);
            if (cachedInfo) {
              cachedInfo.menuData = menuData;
              cachedInfo.menuPosition = menuPosition;
            }
          }
          
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          return res.send(JSON.stringify({
            menuData,
            menuPosition,
          }));
        }
      }
      
      // Fallback to cached file if regeneration failed
      const jsonPath = join(outputDir, url);
      if (existsSync(jsonPath)) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        const content = readFileSync(jsonPath, 'utf8');
        return res.send(content);
      }
    }
    
    // Check if this is a document request
    const isHtmlRequest = url.endsWith('.html') || 
                          url.endsWith('/') || 
                          !url.includes('.') ||
                          url === '/';
    
    if (!isHtmlRequest) {
      // Check if it's a static file in source or output
      const sourceStatic = join(sourceDir, url);
      const outputStatic = join(outputDir, url);
      
      if (existsSync(sourceStatic)) {
        return res.sendFile(sourceStatic);
      }
      if (existsSync(outputStatic)) {
        return res.sendFile(outputStatic);
      }
      
      return next();
    }
    
    // Render document on demand
    try {
      let requestPath = url === '/' ? '/index' : url.replace(/\.html$/, '').replace(/\/$/, '');
      if (!requestPath) requestPath = '/index';
      
      const html = await renderDocument(requestPath);
      
      if (!html) {
        return next();
      }
      
      // Inject hot reload script
      let finalHtml = html;
      const hotReloadScript = getHotReloadScript(wsPort);
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', hotReloadScript + '</body>');
      } else {
        finalHtml += hotReloadScript;
      }
      
      // Add search not ready notice if applicable
      if (!devState.searchReady) {
        finalHtml = finalHtml.replace(
          /<input[^>]*id=["']global-search["'][^>]*>/i,
          '<input id="global-search" type="text" placeholder="Building search index..." disabled>'
        );
      }
      
      res.setHeader('Content-Type', 'text/html');
      res.send(finalHtml);
    } catch (error) {
      console.error('Error rendering document:', error);
      res.status(500).send(`<h1>Error rendering document</h1><pre>${error.message}</pre>`);
    }
  });
  
  // Static file fallback - disable caching for dev mode
  const staticOptions = { 
    extensions: ["html"], 
    index: "index.html",
    setHeaders: (res, path) => {
      // Disable caching for JSON and HTML files in dev mode
      if (path.endsWith('.json') || path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    }
  };
  app.use(express.static(outputDir, staticOptions));
  app.use(express.static(sourceDir, staticOptions));
  
  // Start listening
  httpServer.listen(port, () => {
    console.log(`\n🌐 Server running at http://localhost:${port}`);
    console.log(`🔥 Hot reload WebSocket on port ${wsPort}`);
    console.log('\n⏳ Building caches in background...\n');
  });
  
  // Start background cache building
  setTimeout(() => buildBackgroundCaches(), 100);
  
  // Watch for file changes
  watch(sourceDir, { 
    recursive: true, 
    filter: (f, skip) => {
      if (/[\/\\]\.ursa[\/\\]?/.test(f)) return skip;
      if (/[\/\\]node_modules[\/\\]/.test(f)) return skip;
      return /\.(md|mdx|txt|yml|yaml|json|css|html|jpg|jpeg|png|gif|webp|svg|js|jsx|ts|tsx)$/i.test(f);
    }
  }, async (evt, name) => {
    console.log(`📝 File changed: ${name}`);
    
    // Clear caches for this file
    devState.documentCache.delete(name);
    
    // Check if it's a menu or config change
    const isMenuChange = name && (name.includes('menu.') || name.includes('_menu'));
    const isConfigChange = name && name.endsWith('config.json');
    const isCssChange = name && name.endsWith('.css');
    const isScriptChange = name && (name.endsWith('script.js') || name.endsWith('_script.js'));
    const isComponentChange = name && /\.(tsx|jsx|ts)$/.test(name) && !name.endsWith('.d.ts');
    
    if (isMenuChange || isConfigChange) {
      // Clear path mapping caches
      devState.menuPathMap.clear();
      devState.stylePathMap.clear();
      devState.scriptPathMap.clear();
      devState.configCache.clear();
      clearConfigCache();
      
      // Rebuild full caches
      devState.cacheReady = false;
      devState.menuReady = false;
      await buildBackgroundCaches();
    } else if (isCssChange) {
      // Copy CSS to output
      try {
        const relativePath = name.replace(sourceDir, '');
        const outputPath = join(outputDir, relativePath);
        const content = await readFile(name, 'utf8');
        await outputFile(outputPath, content);
        console.log(`✅ Copied ${relativePath}`);
      } catch (e) {
        console.error(`Error copying CSS: ${e.message}`);
      }
    } else if (isScriptChange) {
      // Clear script cache so next render picks up changes
      devState.scriptPathMap.clear();
      console.log(`✅ Script cache cleared for ${name}`);
    } else if (isComponentChange) {
      // Component files (.tsx, .jsx, .ts) may be imported by MDX files
      // Clear all MDX document caches so they re-compile with the updated component
      for (const key of devState.documentCache.keys()) {
        if (key.endsWith('.mdx')) {
          devState.documentCache.delete(key);
        }
      }
      console.log(`✅ MDX caches cleared for component change: ${name}`);
    }
    
    // Broadcast reload
    broadcast('reload', { file: name });
  });
  
  // Watch meta directory for template changes
  watch(metaDir, { recursive: true }, async (evt, name) => {
    console.log(`🎨 Meta changed: ${name}`);
    devState.templates = await getTemplates(metaDir);
    broadcast('reload', { file: name });
  });
  
  console.log('\n👀 Watching for changes...');
  console.log('Press Ctrl+C to stop the server\n');
}
