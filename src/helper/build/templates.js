// Template helpers for build
import { readFile, readdir } from "fs/promises";
import { join, basename } from "path";
import { existsSync } from "fs";

/**
 * Get all templates from meta directory
 * Templates are now organized in meta/templates/{templateName}/index.html
 * Falls back to legacy flat structure if templates folder doesn't exist
 * @param {string} meta - Full path to meta files directory
 * @returns {Promise<Object>} Map of templateName to { html, dir }
 */
export async function getTemplates(meta) {
  const templatesDir = join(meta, "templates");
  let templates = {};

  // Check if new templates folder structure exists
  if (existsSync(templatesDir)) {
    const entries = await readdir(templatesDir, { withFileTypes: true });
    const templateFolders = entries.filter(e => e.isDirectory());

    const templatesArray = await Promise.all(
      templateFolders.map(async (folder) => {
        const templateName = folder.name;
        const templateDir = join(templatesDir, templateName);
        const indexPath = join(templateDir, "index.html");

        if (existsSync(indexPath)) {
          const fileContent = await readFile(indexPath, "utf8");
          return [templateName, { html: fileContent, dir: templateDir }];
        }
        return null;
      })
    );

    templatesArray
      .filter(Boolean)
      .forEach(([name, data]) => (templates[name] = data));
  }

  // Legacy fallback: check for *-template.html files in meta root
  // This allows backward compatibility during migration
  if (Object.keys(templates).length === 0) {
    const { recurse } = await import("../recursive-readdir.js");
    const allMetaFilenames = await recurse(meta);
    const legacyTemplates = allMetaFilenames.filter((filename) =>
      filename.match(/-template\.html$/)
    );

    const templatesArray = await Promise.all(
      legacyTemplates.map(async (filename) => {
        const name = basename(filename).replace("-template.html", "");
        const fileContent = await readFile(filename, "utf8");
        // For legacy templates, the dir is the meta folder itself
        return [name, { html: fileContent, dir: meta }];
      })
    );
    templatesArray.forEach(
      ([templateName, data]) => (templates[templateName] = data)
    );
  }

  return templates;
}

/**
 * Get template HTML content (backward compatible)
 * @param {Object} templates - Templates map from getTemplates()
 * @param {string} name - Template name
 * @returns {string|null} Template HTML or null
 */
export function getTemplateHtml(templates, name) {
  const template = templates[name];
  if (!template) return null;
  // Support both new { html, dir } format and legacy string format
  return typeof template === 'string' ? template : template.html;
}

/**
 * Get template directory (for resolving assets)
 * @param {Object} templates - Templates map from getTemplates()
 * @param {string} name - Template name
 * @returns {string|null} Template directory path or null
 */
export function getTemplateDir(templates, name) {
  const template = templates[name];
  if (!template) return null;
  return typeof template === 'string' ? null : template.dir;
}

/**
 * Copy meta assets to output/public directory.
 * Handles the new template folder structure:
 * - meta/shared/* → output/public/*
 * - meta/templates/{name}/* (except index.html) → output/public/*
 * 
 * Also handles legacy flat structure for backward compatibility.
 * 
 * @param {string} metaDir - Path to meta directory
 * @param {string} outputPublicDir - Path to output/public directory
 * @returns {Promise<{ copiedFiles: string[], orphanedFiles: string[] }>}
 */
export async function copyMetaAssets(metaDir, outputPublicDir) {
  const { copy } = await import('fs-extra');
  const { readdir, stat } = await import('fs/promises');
  const { relative } = await import('path');
  
  const copiedFiles = [];
  const orphanedFiles = [];
  const templatesDir = join(metaDir, 'templates');
  const sharedDir = join(metaDir, 'shared');
  
  // Helper to copy a file
  const copyFile = async (src, dest) => {
    await copy(src, dest, { overwrite: true });
    copiedFiles.push(relative(metaDir, src));
  };
  
  // Helper to recursively copy directory contents (not the directory itself)
  const copyDirContents = async (srcDir, destDir, excludeFiles = []) => {
    if (!existsSync(srcDir)) return;
    
    const entries = await readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // Skip hidden files
      if (excludeFiles.includes(entry.name)) continue;
      
      const srcPath = join(srcDir, entry.name);
      const destPath = join(destDir, entry.name);
      
      if (entry.isDirectory()) {
        await copyDirContents(srcPath, destPath, excludeFiles);
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  };
  
  // Check if new structure exists
  if (existsSync(templatesDir)) {
    // Copy shared assets
    await copyDirContents(sharedDir, outputPublicDir);
    
    // Copy each template's assets (except index.html)
    const templateFolders = await readdir(templatesDir, { withFileTypes: true });
    for (const folder of templateFolders) {
      if (!folder.isDirectory()) continue;
      const templateDir = join(templatesDir, folder.name);
      await copyDirContents(templateDir, outputPublicDir, ['index.html']);
    }
    
    // Check for orphaned files in meta root (excluding templates and shared folders)
    const rootEntries = await readdir(metaDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'templates' || entry.name === 'shared') continue;
      
      // This is an orphaned file/folder in meta root
      const fullPath = join(metaDir, entry.name);
      if (entry.isDirectory()) {
        // Recursively find all orphaned files
        const findOrphans = async (dir) => {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name.startsWith('.')) continue;
            const p = join(dir, e.name);
            if (e.isDirectory()) {
              await findOrphans(p);
            } else {
              orphanedFiles.push(relative(metaDir, p));
            }
          }
        };
        await findOrphans(fullPath);
      } else {
        orphanedFiles.push(entry.name);
      }
    }
  } else {
    // Legacy: copy entire meta folder to public (old behavior)
    await copy(metaDir, outputPublicDir, {
      filter: (src) => !basename(src).startsWith('.') && !src.endsWith('.html')
    });
  }
  
  return { copiedFiles, orphanedFiles };
}
