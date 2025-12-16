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

export async function generate({
  _source = join(process.cwd(), "."),
  _meta = join(process.cwd(), "meta"),
  _output = join(process.cwd(), "build"),
  _whitelist = null,
  _incremental = false,  // Legacy flag, now ignored (always incremental)
  _clean = false,  // When true, ignore cache and regenerate all files
} = {}) {
  console.log({ _source, _meta, _output, _whitelist, _clean });
  const source = resolve(_source) + "/";
  const meta = resolve(_meta);
  const output = resolve(_output) + "/";
  console.log({ source, meta, output });

  const allSourceFilenamesUnfiltered = await recurse(source, [() => false]);
  
  // Apply include filter (existing functionality)
  const includeFilter = process.env.INCLUDE_FILTER
    ? (fileName) => fileName.match(process.env.INCLUDE_FILTER)
    : Boolean;
  let allSourceFilenames = allSourceFilenamesUnfiltered.filter(includeFilter);
  
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
  const validPaths = buildValidPaths(allSourceFilenamesThatAreArticles, source);
  console.log(`Built ${validPaths.size} valid paths for link validation`);

  const menu = await getMenu(allSourceFilenames, source, validPaths);

  // Get and increment build ID from .ursa.json
  const buildId = getAndIncrementBuildId(resolve(_source));
  console.log(`Build #${buildId}`);

  // Generate footer content
  const footer = await getFooter(source, _source, buildId);

  // Load content hash cache from .ursa folder in source directory
  let hashCache = new Map();
  if (!_clean) {
    hashCache = await loadHashCache(source);
    console.log(`Loaded ${hashCache.size} cached content hashes from .ursa folder`);
  } else {
    console.log(`Clean build: ignoring cached hashes`);
  }

  // create public folder
  const pub = join(output, "public");
  await mkdir(pub, { recursive: true });
  await copyDir(meta, pub);

  // Track errors for error report
  const errors = [];

  // First pass: collect search index data
  const searchIndex = [];
  const jsonCache = new Map();
  
  // Collect basic data for search index
  for (const file of allSourceFilenamesThatAreArticles) {
    try {
      const rawBody = await readFile(file, "utf8");
      const type = parse(file).ext;
      const ext = extname(file);
      const base = basename(file, ext);
      const dir = addTrailingSlash(dirname(file)).replace(source, "");
      
      // Generate title from filename (in title case)
      const title = toTitleCase(base);
      
      // Generate URL path relative to output
      const relativePath = file.replace(source, '').replace(/\.(md|txt|yml)$/, '.html');
      const url = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
      
      // Basic content processing for search (without full rendering)
      const body = renderFile({
        fileContents: rawBody,
        type,
        dirname: dir,
        basename: base,
      });
      
      // Extract text content from body (strip HTML tags for search)
      const textContent = body && body.replace && body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || 'body is undefined for some reason'
      const excerpt = textContent.substring(0, 200); // First 200 chars for preview
      
      searchIndex.push({
        title: title,
        path: relativePath,
        url: url,
        content: excerpt
      });
    } catch (e) {
      console.error(`Error processing ${file} (first pass): ${e.message}`);
      errors.push({ file, phase: 'search-index', error: e });
    }
  }
  
  console.log(`Built search index with ${searchIndex.length} entries`);

  // Track files that were regenerated (for incremental mode stats)
  let regeneratedCount = 0;
  let skippedCount = 0;

  // Second pass: process individual articles with search data available
  await Promise.all(
    allSourceFilenamesThatAreArticles.map(async (file) => {
      try {
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
        
        // Skip files that haven't changed (unless --clean flag is set)
        if (!_clean && !needsRegeneration(file, rawBody, hashCache)) {
          skippedCount++;
          // Still need to populate jsonCache for directory indices
          const meta = extractMetadata(rawBody);
          const body = renderFile({
            fileContents: rawBody,
            type,
            dirname: dir,
            basename: base,
          });
          // Extract sections for markdown files
          const sections = type === '.md' ? extractSections(rawBody) : [];
          
          jsonCache.set(file, {
            name: base,
            url,
            contents: rawBody,
            bodyHtml: body,
            metadata: meta,
            sections,
            transformedMetadata: '',
          });
          return; // Skip regenerating this file
        }
        
        console.log(`processing article ${file}`);
        regeneratedCount++;

        const meta = extractMetadata(rawBody);
        const rawMeta = extractRawMetadata(rawBody);
        const bodyLessMeta = rawMeta ? rawBody.replace(rawMeta, "") : rawBody;
        const transformedMetadata = await getTransformedMetadata(
          dirname(file),
          meta
        );
        
        // Calculate the document's URL path (e.g., "/character/index.html")
        const docUrlPath = '/' + dir + base + '.html';
        
        // Generate title from filename (in title case)
        const title = toTitleCase(base);

        const body = renderFile({
          fileContents: rawBody,
          type,
          dirname: dir,
          basename: base,
        });

        // Find nearest style.css or _style.css up the tree
        let embeddedStyle = "";
        try {
          const css = await findStyleCss(resolve(_source, dir));
          if (css) {
            embeddedStyle = css;
          }
        } catch (e) {
          // ignore
          console.error(e);
        }

        const requestedTemplateName = meta && meta.template;
        const template =
          templates[requestedTemplateName] || templates[DEFAULT_TEMPLATE_NAME];

        if (!template) {
          throw new Error(`Template not found. Requested: "${requestedTemplateName || DEFAULT_TEMPLATE_NAME}". Available templates: ${Object.keys(templates).join(', ') || 'none'}`);
        }

        // Insert embeddedStyle just before </head> if present, else at top
        let finalHtml = template
          .replace("${title}", title)
          .replace("${menu}", menu)
          .replace("${meta}", JSON.stringify(meta))
          .replace("${transformedMetadata}", transformedMetadata)
          .replace("${body}", body)
          .replace("${embeddedStyle}", embeddedStyle)
          .replace("${searchIndex}", JSON.stringify(searchIndex))
          .replace("${footer}", footer);

        // Resolve links and mark broken internal links as inactive (debug mode on)
        // Pass docUrlPath so relative links can be resolved correctly
        finalHtml = markInactiveLinks(finalHtml, validPaths, docUrlPath, false);

        console.log(`writing article to ${outputFilename}`);

        await outputFile(outputFilename, finalHtml);

        // json

        const jsonOutputFilename = outputFilename.replace(".html", ".json");
        
        // Extract sections for markdown files
        const sections = type === '.md' ? extractSections(rawBody) : [];
        
        const jsonObject = {
          name: base,
          url,
          contents: rawBody,
          // bodyLessMeta: bodyLessMeta,
          bodyHtml: body,
          metadata: meta,
          sections,
          transformedMetadata,
          // html: finalHtml,
        };
        jsonCache.set(file, jsonObject);
        const json = JSON.stringify(jsonObject);
        console.log(`writing article to ${jsonOutputFilename}`);
        await outputFile(jsonOutputFilename, json);

        // xml

        const xmlOutputFilename = outputFilename.replace(".html", ".xml");
        const xml = `<article>${o2x(jsonObject)}</article>`;
        await outputFile(xmlOutputFilename, xml);
        
        // Update the content hash for this file
        updateHash(file, rawBody, hashCache);
      } catch (e) {
        console.error(`Error processing ${file} (second pass): ${e.message}`);
        errors.push({ file, phase: 'article-generation', error: e });
      }
    })
  );

  // Log build stats
  console.log(`Build: ${regeneratedCount} regenerated, ${skippedCount} unchanged`);

  console.log(jsonCache.keys());
  
  // process directory indices
  await Promise.all(
    allSourceFilenamesThatAreDirectories.map(async (dir) => {
      try {
        console.log(`processing directory ${dir}`);

        const pathsInThisDirectory = allSourceFilenames.filter((filename) =>
          filename.match(new RegExp(`${dir}.+`))
        );

        const jsonObjects = pathsInThisDirectory
          .map((path) => {
            const object = jsonCache.get(path);
            return typeof object === "object" ? object : null;
          })
          .filter((a) => a);

        const json = JSON.stringify(jsonObjects);

        const outputFilename = dir.replace(source, output) + ".json";

        console.log(`writing directory index to ${outputFilename}`);
        await outputFile(outputFilename, json);

        // html
        const htmlOutputFilename = dir.replace(source, output) + ".html";
        const indexAlreadyExists = fileExists(htmlOutputFilename);
        if (!indexAlreadyExists) {
          const template = templates["default-template"]; // TODO: figure out a way to specify template for a directory index
          const indexHtml = `<ul>${pathsInThisDirectory
            .map((path) => {
              const partialPath = path
                .replace(source, "")
                .replace(parse(path).ext, ".html");
              const name = basename(path, parse(path).ext);
              return `<li><a href="${partialPath}">${name}</a></li>`;
            })
            .join("")}</ul>`;
          const finalHtml = template
            .replace("${menu}", menu)
            .replace("${body}", indexHtml)
            .replace("${searchIndex}", JSON.stringify(searchIndex))
            .replace("${title}", "Index")
            .replace("${meta}", "{}")
            .replace("${transformedMetadata}", "")
            .replace("${embeddedStyle}", "")
            .replace("${footer}", footer);
          console.log(`writing directory index to ${htmlOutputFilename}`);
          await outputFile(htmlOutputFilename, finalHtml);
        }
      } catch (e) {
        console.error(`Error processing directory ${dir}: ${e.message}`);
        errors.push({ file: dir, phase: 'directory-index', error: e });
      }
    })
  );

  // copy all static files (i.e. images)
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|ico)/; // static asset extensions
  const allSourceFilenamesThatAreImages = allSourceFilenames.filter(
    (filename) => filename.match(imageExtensions)
  );
  await Promise.all(
    allSourceFilenamesThatAreImages.map(async (file) => {
      try {
        // For incremental mode, check if file has changed using file stat as a quick check
        if (_incremental) {
          const fileStat = await stat(file);
          const statKey = `${file}:stat`;
          const newStatHash = `${fileStat.size}:${fileStat.mtimeMs}`;
          if (hashCache.get(statKey) === newStatHash) {
            return; // Skip unchanged static file
          }
          hashCache.set(statKey, newStatHash);
        }
        
        console.log(`processing static file ${file}`);

        const outputFilename = file.replace(source, output);

        console.log(`writing static file to ${outputFilename}`);

        await mkdir(dirname(outputFilename), { recursive: true });
        return await copyFile(file, outputFilename);
      } catch (e) {
        console.error(`Error processing static file ${file}: ${e.message}`);
        errors.push({ file, phase: 'static-file', error: e });
      }
    })
  );

  // Save the hash cache to .ursa folder in source directory
  if (hashCache.size > 0) {
    await saveHashCache(source, hashCache);
  }

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
    console.log(`\n⚠️  ${errors.length} error(s) occurred during generation.`);
    console.log(`   Error report written to: ${errorReportPath}\n`);
  } else {
    console.log(`\n✅ Generation complete with no errors.\n`);
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