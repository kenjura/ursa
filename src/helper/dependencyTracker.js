/**
 * Dependency tracker for Ursa's regeneration system.
 *
 * Tracks which documents depend on which files so that when a file changes,
 * we can determine exactly which documents need regeneration.
 *
 * Dependency types:
 * - template: document uses a specific meta template
 * - style: document inherits a specific style.css
 * - script: document inherits a specific script.js
 * - static: document references a static asset (image, font, etc.)
 * - meta-asset: document depends on a meta CSS/JS file (via template bundling)
 *
 * The tracker maintains two indexes:
 * 1. fileToDocuments: Map<dependencyPath, Set<documentPath>> — given a changed file, which documents need regeneration?
 * 2. documentToFiles: Map<documentPath, Set<dependencyPath>> — given a document, what are its dependencies? (for cleanup)
 */

import { dirname, join, relative, resolve } from "path";

export class DependencyTracker {
  constructor() {
    /** @type {Map<string, Set<string>>} dependency file path → set of document paths */
    this.fileToDocuments = new Map();
    /** @type {Map<string, Set<string>>} document path → set of dependency file paths */
    this.documentToFiles = new Map();
    /** @type {string} source directory root (absolute, with trailing slash) */
    this.sourceDir = "";
  }

  /**
   * Initialize with the source directory.
   * @param {string} sourceDir - Absolute path to source directory (with or without trailing slash)
   */
  init(sourceDir) {
    this.sourceDir = resolve(sourceDir) + "/";
    this.fileToDocuments.clear();
    this.documentToFiles.clear();
  }

  /**
   * Register that a document depends on a file.
   * @param {string} documentPath - Absolute path to the document
   * @param {string} dependencyPath - Absolute path to the dependency file
   */
  addDependency(documentPath, dependencyPath) {
    // file → documents
    if (!this.fileToDocuments.has(dependencyPath)) {
      this.fileToDocuments.set(dependencyPath, new Set());
    }
    this.fileToDocuments.get(dependencyPath).add(documentPath);

    // document → files
    if (!this.documentToFiles.has(documentPath)) {
      this.documentToFiles.set(documentPath, new Set());
    }
    this.documentToFiles.get(documentPath).add(dependencyPath);
  }

  /**
   * Register dependencies for a document: template, style.css files, script.js files.
   * @param {string} documentPath - Absolute path to the document
   * @param {{ templateName: string, cssPaths: string[], scriptPaths: string[], metaAssets: string[] }} deps
   */
  registerDocument(documentPath, { templateName, cssPaths = [], scriptPaths = [], metaAssets = [] } = {}) {
    // Clear old dependencies for this document
    this.clearDocument(documentPath);

    // Template dependency (use a virtual path so template changes can be looked up)
    if (templateName) {
      this.addDependency(documentPath, `template:${templateName}`);
    }

    // Style.css dependencies
    for (const cssPath of cssPaths) {
      this.addDependency(documentPath, cssPath);
    }

    // Script.js dependencies
    for (const scriptPath of scriptPaths) {
      this.addDependency(documentPath, scriptPath);
    }

    // Meta template assets (CSS/JS referenced by the template)
    for (const metaAsset of metaAssets) {
      this.addDependency(documentPath, metaAsset);
    }
  }

  /**
   * Clear all dependencies for a document.
   * @param {string} documentPath
   */
  clearDocument(documentPath) {
    const deps = this.documentToFiles.get(documentPath);
    if (deps) {
      for (const dep of deps) {
        const docSet = this.fileToDocuments.get(dep);
        if (docSet) {
          docSet.delete(documentPath);
          if (docSet.size === 0) this.fileToDocuments.delete(dep);
        }
      }
      this.documentToFiles.delete(documentPath);
    }
  }

  /**
   * Get all documents that depend on a given file.
   * @param {string} filePath - Absolute path to the changed file
   * @returns {Set<string>} Set of document paths that need regeneration
   */
  getAffectedDocuments(filePath) {
    return this.fileToDocuments.get(filePath) || new Set();
  }

  /**
   * Get all documents that use a specific template.
   * @param {string} templateName - Template name (e.g., "default-template")
   * @returns {Set<string>} Set of document paths
   */
  getDocumentsUsingTemplate(templateName) {
    return this.getAffectedDocuments(`template:${templateName}`);
  }

  /**
   * Determine which documents are affected by a changed file.
   * This is the main entry point for the invalidation logic.
   *
   * @param {string} changedFile - Absolute path to the changed file
   * @param {string} sourceDir - Absolute path to source directory
   * @returns {{ affectedDocuments: string[], reason: string, requiresFullRebuild: boolean }}
   */
  getInvalidationPlan(changedFile, sourceDir) {
    const normalizedSource = resolve(sourceDir) + "/";
    const relativePath = changedFile.replace(normalizedSource, "");
    const fileName = relativePath.split("/").pop();

    // 1. Menu/config changes → full rebuild (affects navigation structure)
    if (
      fileName === "menu.md" || fileName === "menu.txt" || fileName === "_menu" ||
      fileName === "config.json" || fileName === "_config"
    ) {
      return {
        affectedDocuments: [],
        reason: `Menu/config change: ${relativePath}`,
        requiresFullRebuild: true,
      };
    }

    // 2. style.css or script.js → affects current folder + all subfolders
    //    These are "inherited" files — documents in the folder and all subfolders include them.
    if (
      fileName === "style.css" || fileName === "_style.css" || fileName === "style-ursa.css" ||
      fileName === "script.js" || fileName === "_script.js"
    ) {
      // Get all documents directly registered as depending on this file
      const directDeps = this.getAffectedDocuments(changedFile);

      if (directDeps.size > 0) {
        return {
          affectedDocuments: [...directDeps],
          reason: `Inherited ${fileName} changed: ${relativePath} (${directDeps.size} documents)`,
          requiresFullRebuild: false,
        };
      }

      // Fallback: if dependency tracker wasn't populated, scope by directory
      const changedDir = dirname(changedFile);
      const allDocs = [...this.documentToFiles.keys()];
      const affected = allDocs.filter((doc) => doc.startsWith(changedDir));
      return {
        affectedDocuments: affected,
        reason: `Inherited ${fileName} changed: ${relativePath} (${affected.length} documents in subtree, fallback)`,
        requiresFullRebuild: false,
      };
    }

    // 3. Article file changes → just that document
    if (/\.(md|mdx|txt|yml|yaml)$/.test(fileName)) {
      return {
        affectedDocuments: [changedFile],
        reason: `Article changed: ${relativePath}`,
        requiresFullRebuild: false,
      };
    }

    // 4. Other static files (images, fonts, etc.) → find documents that reference them
    const directDeps = this.getAffectedDocuments(changedFile);
    if (directDeps.size > 0) {
      return {
        affectedDocuments: [...directDeps],
        reason: `Static asset changed: ${relativePath} (${directDeps.size} referencing documents)`,
        requiresFullRebuild: false,
      };
    }

    // If we don't track this file, it's safe to just broadcast reload (dev mode only)
    return {
      affectedDocuments: [],
      reason: `Unknown file changed: ${relativePath} (no registered dependents)`,
      requiresFullRebuild: false,
    };
  }

  /**
   * Determine which documents are affected by a meta file change.
   * @param {string} changedFile - Absolute path to the changed meta file
   * @param {string} metaDir - Absolute path to meta directory
   * @returns {{ affectedDocuments: string[], reason: string, requiresFullRebuild: boolean }}
   */
  getMetaInvalidationPlan(changedFile, metaDir) {
    const normalizedMeta = resolve(metaDir) + "/";
    const relativePath = changedFile.replace(normalizedMeta, "");
    const fileName = relativePath.split("/").pop();

    // Template file changed → regenerate all documents using that template
    if (fileName.endsWith(".html")) {
      const templateName = fileName.replace(".html", "");
      const affected = this.getDocumentsUsingTemplate(templateName);
      if (affected.size > 0) {
        return {
          affectedDocuments: [...affected],
          reason: `Template changed: ${templateName} (${affected.size} documents)`,
          requiresFullRebuild: false,
        };
      }
      // If no documents tracked, fall back to full rebuild (safe default)
      return {
        affectedDocuments: [],
        reason: `Template changed: ${templateName} (no tracked documents, full rebuild)`,
        requiresFullRebuild: true,
      };
    }

    // Meta CSS or JS file changed → all documents are affected
    // (meta assets are bundled into every template)
    if (fileName.endsWith(".css") || fileName.endsWith(".js")) {
      const allDocs = [...this.documentToFiles.keys()];
      return {
        affectedDocuments: allDocs,
        reason: `Meta asset changed: ${relativePath} (affects all ${allDocs.length} documents)`,
        requiresFullRebuild: false,
      };
    }

    // Other meta file → full rebuild to be safe
    return {
      affectedDocuments: [],
      reason: `Meta file changed: ${relativePath}`,
      requiresFullRebuild: true,
    };
  }

  /**
   * Get stats about the dependency graph.
   * @returns {{ totalDocuments: number, totalDependencies: number, uniqueFiles: number }}
   */
  getStats() {
    return {
      totalDocuments: this.documentToFiles.size,
      totalDependencies: [...this.documentToFiles.values()].reduce((sum, s) => sum + s.size, 0),
      uniqueFiles: this.fileToDocuments.size,
    };
  }
}

// Singleton instance
export const dependencyTracker = new DependencyTracker();
