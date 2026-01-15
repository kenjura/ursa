import express from "express";
import compression from "compression";
import watch from "node-watch";
import { generate, regenerateSingleFile, clearWatchCache } from "./jobs/generate.js";
import { join, resolve, dirname, basename } from "path";
import fs from "fs";
import { promises } from "fs";
import { outputFile } from "fs-extra";
import { processImage } from "./helper/imageProcessor.js";
const { readdir, mkdir, readFile, copyFile } = promises;

// Debounce timer and lock for preventing concurrent regenerations
let debounceTimer = null;
let isRegenerating = false;
const DEBOUNCE_MS = 100; // Wait 100ms after last change before regenerating

/**
 * Copy a single CSS file to the output directory
 * @param {string} cssPath - Absolute path to the CSS file
 * @param {string} sourceDir - Source directory root
 * @param {string} outputDir - Output directory root
 */
async function copyCssFile(cssPath, sourceDir, outputDir) {
  const startTime = Date.now();
  const relativePath = cssPath.replace(sourceDir, '');
  const outputPath = join(outputDir, relativePath);
  
  try {
    const content = await readFile(cssPath, 'utf8');
    await outputFile(outputPath, content);
    const elapsed = Date.now() - startTime;
    return { success: true, message: `Copied ${relativePath} in ${elapsed}ms` };
  } catch (e) {
    return { success: false, message: `Error copying CSS: ${e.message}` };
  }
}

// Static file extensions that should be copied (images, fonts, etc.)
const STATIC_FILE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|eot|pdf|mp3|mp4|webm|ogg)$/i;
// Image extensions that get preview processing
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i;

/**
 * Copy a single static file to the output directory
 * For images, also generates a preview version
 * @param {string} filePath - Absolute path to the static file
 * @param {string} sourceDir - Source directory root
 * @param {string} outputDir - Output directory root
 */
async function copyStaticFile(filePath, sourceDir, outputDir) {
  const startTime = Date.now();
  const relativePath = filePath.replace(sourceDir, '');
  const relativeDir = dirname(relativePath);
  const absoluteOutputDir = join(outputDir, relativeDir);
  
  try {
    // Check if this is an image that needs preview processing
    if (IMAGE_EXTENSIONS.test(filePath)) {
      const result = await processImage(filePath, absoluteOutputDir, relativeDir);
      const elapsed = Date.now() - startTime;
      if (result && result.preview !== result.original) {
        return { success: true, message: `Processed ${relativePath} with preview in ${elapsed}ms` };
      }
      return { success: true, message: `Copied ${relativePath} in ${elapsed}ms` };
    }
    
    // For non-image files, just copy
    const outputPath = join(outputDir, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(filePath, outputPath);
    const elapsed = Date.now() - startTime;
    return { success: true, message: `Copied ${relativePath} in ${elapsed}ms` };
  } catch (e) {
    return { success: false, message: `Error copying static file: ${e.message}` };
  }
}

/**
 * Configurable serve function for CLI and library use
 */
export async function serve({
  _source,
  _meta,
  _output,
  port = 8080,
  _whitelist = null,
  _clean = false,
  _exclude = null
} = {}) {
  const sourceDir = resolve(_source);
  const metaDir = resolve(_meta);
  const outputDir = resolve(_output);

  console.log({ source: sourceDir, meta: metaDir, output: outputDir, port, whitelist: _whitelist, exclude: _exclude, clean: _clean });

  // Ensure output directory exists and start server immediately
  await mkdir(outputDir, { recursive: true });
  serveFiles(outputDir, port);
  console.log(`🚀 Development server running at http://localhost:${port}`);
  console.log("📁 Serving files from:", outputDir);
  console.log("⏳ Generating site in background...\n");

  // Initial generation (use _clean flag only for initial generation)
  // This also initializes the watch cache for fast single-file updates
  generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist, _exclude, _clean })
    .then(() => console.log("\n✅ Initial generation complete. Fast single-file regeneration enabled.\n"))
    .catch((error) => console.error("Error during initial generation:", error.message));

  // Watch for changes
  console.log("👀 Watching for changes in:");
  console.log("   Source:", sourceDir, "(fast single-file mode)");
  console.log("   Meta:", metaDir, "(full rebuild)");
  console.log("\nPress Ctrl+C to stop the server\n");
  
  // Meta changes trigger full rebuild (templates, CSS, etc. affect all pages)
  watch(metaDir, { recursive: true, filter: /\.(js|json|css|html|md|txt|yml|yaml)$/ }, async (evt, name) => {
    console.log(`Meta files changed! Event: ${evt}, File: ${name}`);
    console.log("Full rebuild required (meta files affect all pages)...");
    clearWatchCache(); // Clear cache since templates/CSS may have changed
    try {
      await generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist, _exclude, _clean: true });
      console.log("Regeneration complete.");
    } catch (error) {
      console.error("Error during regeneration:", error.message);
    }
  });

  // Source changes: try fast single-file regeneration first
  // Falls back to full rebuild for CSS, config, or if cache isn't ready
  watch(sourceDir, { 
    recursive: true, 
    filter: (f, skip) => {
      // Skip .ursa folder (contains hash cache that gets updated during generation)
      if (/[\/\\]\.ursa[\/\\]?/.test(f)) return skip;
      // Watch article files, config files, and static assets
      return /\.(js|json|css|html|md|txt|yml|yaml|jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|eot|pdf|mp3|mp4|webm|ogg)$/i.test(f);
    }
  }, async (evt, name) => {
    // Skip if we're already regenerating
    if (isRegenerating) {
      console.log(`⏳ Skipping ${name} (regeneration in progress)`);
      return;
    }
    
    // CSS files: just copy the file (no longer embedded in HTML)
    const isCssChange = name && name.endsWith('.css');
    // Menu/config changes need full rebuild
    const isMenuChange = name && (name.includes('_menu') || name.includes('menu.'));
    const isConfigChange = name && (name.includes('_config') || name.includes('.ursa'));
    
    if (isCssChange) {
      console.log(`\n🎨 CSS change detected: ${name}`);
      isRegenerating = true;
      try {
        const result = await copyCssFile(name, sourceDir + '/', outputDir + '/');
        if (result.success) {
          console.log(`✅ ${result.message}`);
        } else {
          console.log(`⚠️ ${result.message}`);
        }
      } catch (error) {
        console.error("Error copying CSS:", error.message);
      } finally {
        isRegenerating = false;
      }
      return;
    }
    
    // Static files (images, fonts, etc.): just copy the file
    const isStaticFile = name && STATIC_FILE_EXTENSIONS.test(name);
    if (isStaticFile) {
      console.log(`\n🖼️  Static file ${evt === 'remove' ? 'removed' : 'changed'}: ${name}`);
      isRegenerating = true;
      try {
        if (evt === 'remove') {
          // Delete the file from output
          const relativePath = name.replace(sourceDir, '');
          const outputPath = join(outputDir, relativePath);
          try {
            await promises.unlink(outputPath);
            console.log(`✅ Removed ${relativePath}`);
          } catch (e) {
            if (e.code !== 'ENOENT') {
              console.log(`⚠️ Error removing file: ${e.message}`);
            }
          }
        } else {
          const result = await copyStaticFile(name, sourceDir + '/', outputDir + '/');
          if (result.success) {
            console.log(`✅ ${result.message}`);
          } else {
            console.log(`⚠️ ${result.message}`);
          }
        }
      } catch (error) {
        console.error("Error handling static file:", error.message);
      } finally {
        isRegenerating = false;
      }
      return;
    }
    
    if (isMenuChange || isConfigChange) {
      console.log(`\n📦 ${isMenuChange ? 'Menu' : 'Config'} change detected: ${name}`);
      console.log("Full rebuild required...");
      clearWatchCache();
      isRegenerating = true;
      try {
        await generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist, _exclude, _clean: true });
        console.log("Regeneration complete.");
      } catch (error) {
        console.error("Error during regeneration:", error.message);
      } finally {
        isRegenerating = false;
      }
      return;
    }
    
    // Try fast single-file regeneration for article files
    const isArticle = name && /\.(md|txt|yml)$/.test(name);
    if (isArticle) {
      console.log(`\n⚡ Fast regeneration: ${name}`);
      isRegenerating = true;
      try {
        const result = await regenerateSingleFile(name, {
          _source: sourceDir,
          _meta: metaDir,
          _output: outputDir
        });
        
        if (result.success) {
          console.log(`✅ ${result.message}`);
          return;
        }
        
        // Fall back to full rebuild if single-file failed
        console.log(`⚠️ ${result.message}`);
        console.log("Falling back to full rebuild...");
        await generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist, _exclude });
        console.log("Regeneration complete.");
      } catch (error) {
        console.error("Error during regeneration:", error.message);
      } finally {
        isRegenerating = false;
      }
      return;
    }
    
    // Non-article files - incremental build
    console.log(`\n📄 Non-article change: ${name}`);
    console.log("Running incremental rebuild...");
    isRegenerating = true;
    try {
      await generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist, _exclude });
      console.log("Regeneration complete.");
    } catch (error) {
      console.error("Error during regeneration:", error.message);
    } finally {
      isRegenerating = false;
    }
  });
}

/**
 * Start HTTP server to serve static files
 */
function serveFiles(outputDir, port = 8080) {
  const app = express();

  // Enable gzip compression for all responses
  // This significantly reduces transfer size for JSON and HTML files
  app.use(compression({
    // Compress everything over 1KB
    threshold: 1024,
    // Use default compression level (good balance of speed vs size)
    level: 6
  }));

  app.use(
    express.static(outputDir, { extensions: ["html"], index: "index.html" })
  );

  app.get("/", async (req, res) => {
    try {
      console.log({ output: outputDir });
      const dir = await readdir(outputDir);
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Ursa Development Server</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            h1 { color: #333; }
            ul { list-style-type: none; padding: 0; }
            li { margin: 8px 0; }
            a { color: #0066cc; text-decoration: none; }
            a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <h1>Ursa Development Server</h1>
          <p>Files in ${outputDir}:</p>
          <ul>
            ${dir
              .map((file) => `<li><a href="${file}">${file}</a></li>`)
              .join("")}
          </ul>
        </body>
        </html>
      `;
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error) {
      res.status(500).send("Error reading directory");
    }
  });

  app.listen(port, () => {
    console.log(`🌐 Server listening on port ${port}`);
  });
}

/**
 * we're only interested in meta (and maybe, in the future, source)
 * for src changes, we need the node process to restart
 */
function filter(filename, skip) {
  // console.log("testing ", filename);
  if (/\/build/.test(filename)) return skip;
  if (/\/node_modules/.test(filename)) return skip;
  if (/\.git/.test(filename)) return skip;
  if (/\/src/.test(filename)) return skip;
  if (/\/meta/.test(filename)) return true;
  return false;
}

// Default serve function for backward compatibility (only run when executed directly)
if (import.meta.url === `file://${process.argv[1]}`) {
  const source = resolve(process.env.SOURCE ?? join(process.cwd(), "source"));
  const meta = resolve(process.env.META ?? join(process.cwd(), "meta"));
  const output = resolve(process.env.OUTPUT ?? join(process.cwd(), "build"));

  console.log({ source, meta, output });

  await generate({ _source: source, _meta: meta, _output: output });
  console.log("done generating. now serving...");

  serveFiles(output);

  watch(meta, { recursive: true }, async (evt, name) => {
    console.log("meta files changed! generating output");
    await generate({ _source: source, _meta: meta, _output: output });
  });

  watch(source, { recursive: true }, async (evt, name) => {
    console.log("source files changed! generating output");
    await generate({ _source: source, _meta: meta, _output: output });
  });
}
