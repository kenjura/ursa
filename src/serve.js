import express from "express";
import watch from "node-watch";
import { generate } from "./jobs/generate.js";
import { join, resolve } from "path";
import fs from "fs";
import { promises } from "fs";
const { readdir } = promises;

/**
 * Configurable serve function for CLI and library use
 */
export async function serve({
  _source,
  _meta,
  _output,
  port = 8080,
  _whitelist = null
} = {}) {
  const sourceDir = resolve(_source);
  const metaDir = resolve(_meta);
  const outputDir = resolve(_output);

  console.log({ source: sourceDir, meta: metaDir, output: outputDir, port, whitelist: _whitelist });

  // Initial generation
  console.log("Generating initial site...");
  await generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist });
  console.log("Initial generation complete. Starting server...");

  // Start file server
  serveFiles(outputDir, port);

  // Watch for changes
  console.log("Watching for file changes...");
  
  // Meta changes trigger full rebuild (templates, CSS, etc. affect all pages)
  watch(metaDir, { recursive: true, filter: /\.(js|json|css|html|md|txt|yml|yaml)$/ }, async (evt, name) => {
    console.log(`Meta files changed! Event: ${evt}, File: ${name}`);
    console.log("Full rebuild required (meta files affect all pages)...");
    try {
      await generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist, _incremental: false });
      console.log("Regeneration complete.");
    } catch (error) {
      console.error("Error during regeneration:", error.message);
    }
  });

  // Source changes use incremental mode (only regenerate changed files)
  // Exception: CSS changes require full rebuild since they're embedded in all pages
  watch(sourceDir, { recursive: true, filter: /\.(js|json|css|html|md|txt|yml|yaml)$/ }, async (evt, name) => {
    console.log(`Source files changed! Event: ${evt}, File: ${name}`);
    
    // CSS files affect all pages (embedded styles), so trigger full rebuild
    const isCssChange = name && name.endsWith('.css');
    if (isCssChange) {
      console.log("CSS change detected - full rebuild required...");
      try {
        await generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist, _incremental: false });
        console.log("Regeneration complete.");
      } catch (error) {
        console.error("Error during regeneration:", error.message);
      }
    } else {
      console.log("Incremental rebuild...");
      try {
        await generate({ _source: sourceDir, _meta: metaDir, _output: outputDir, _whitelist, _incremental: true });
        console.log("Regeneration complete.");
      } catch (error) {
        console.error("Error during regeneration:", error.message);
      }
    }
  });

  console.log(`🚀 Development server running at http://localhost:${port}`);
  console.log("📁 Serving files from:", outputDir);
  console.log("👀 Watching for changes in:");
  console.log("   Source:", sourceDir, "(incremental)");
  console.log("   Meta:", metaDir, "(full rebuild)");
  console.log("\nPress Ctrl+C to stop the server");
}

/**
 * Start HTTP server to serve static files
 */
function serveFiles(outputDir, port = 8080) {
  const app = express();

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
