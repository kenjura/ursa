// Auto-index generation helpers for build
import { existsSync, readFileSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import { outputFile } from "fs-extra";
import { findStyleCss } from "../findStyleCss.js";
import { toTitleCase } from "./titleCase.js";
import { addTimestampToHtmlStaticRefs } from "./cacheBust.js";
import { isMetadataOnly } from "../metadataExtractor.js";

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
 * @param {Set<string>} existingHtmlFiles - Set of existing HTML files in source (relative paths)
 * @param {string} cacheBustTimestamp - Cache-busting timestamp
 * @param {object} progress - Progress reporter instance
 */
export async function generateAutoIndices(output, directories, source, templates, menu, footer, generatedArticles, copiedCssFiles, existingHtmlFiles, cacheBustTimestamp, progress) {
  // Alternate index file names to look for (in priority order)
  const INDEX_ALTERNATES = ['_index.html', 'home.html', '_home.html'];
  
  // Normalize paths (remove trailing slashes for consistent replacement)
  const sourceNorm = source.replace(/\/+$/, '');
  const outputNorm = output.replace(/\/+$/, '');
  
  // Build set of directories that already have an index.html from a source index.md/txt/yml
  // Exclude metadata-only index files - they should still get auto-generated indices
  const dirsWithSourceIndex = new Set();
  for (const articlePath of generatedArticles) {
    const base = basename(articlePath, extname(articlePath));
    if (base === 'index') {
      // Check if this is a metadata-only index file
      try {
        if (existsSync(articlePath)) {
          const content = readFileSync(articlePath, 'utf8');
          if (isMetadataOnly(content)) {
            // Skip - this folder should still get an auto-index
            continue;
          }
        }
      } catch (e) {
        // If we can't read it, assume it has content
      }
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
  let skippedHtmlCount = 0;
  
  for (const dir of outputDirs) {
    const indexPath = join(dir, 'index.html');
    
    // Skip if this directory had a source index.md/txt/yml that was already processed
    if (dirsWithSourceIndex.has(dir)) {
      continue;
    }
    
    // Check if there's an existing index.html in the source directory (don't overwrite it)
    const sourceDir = dir.replace(outputNorm, sourceNorm);
    const relativeIndexPath = join(sourceDir, 'index.html').replace(sourceNorm + '/', '');
    if (existingHtmlFiles && existingHtmlFiles.has(relativeIndexPath)) {
      skippedHtmlCount++;
      continue; // Don't overwrite existing source HTML
    }
    
    // Skip if index.html already exists in output (e.g., created by previous run)
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
            // For directories, link to /folder/index.html; for files, use the filename directly
            const href = isDir ? `${child.name}/index.html` : child.name;
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
        // Add cache-busting timestamps to static file references
        finalHtml = addTimestampToHtmlStaticRefs(finalHtml, cacheBustTimestamp);
        
        await outputFile(indexPath, finalHtml);
        generatedCount++;
        progress.status('Auto-index', `Generated index.html for ${dir.replace(outputNorm, '') || '/'}`);
      } catch (e) {
        progress.log(`Error generating auto-index for ${dir}: ${e.message}`);
      }
    }
  }
  
  if (generatedCount > 0 || renamedCount > 0 || skippedHtmlCount > 0) {
    let summary = `${generatedCount} generated, ${renamedCount} promoted`;
    if (skippedHtmlCount > 0) {
      summary += `, ${skippedHtmlCount} skipped (existing HTML)`;
    }
    progress.done('Auto-index', summary);
  } else {
    progress.log(`Auto-index: All folders already have index.html`);
  }
}
