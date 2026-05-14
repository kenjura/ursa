/**
 * Document Templates
 *
 * Allows users to create _templates/ folders anywhere in the docroot tree.
 * Template .md files inside those folders serve as reusable stubs (e.g. a City
 * page with headings and placeholder text).  An instance is a normal document
 * whose frontmatter contains `template-source: <relative-path-to-template>`.
 *
 * When a template changes, Ursa performs a 3-way merge (git-style) against
 * every instance:
 *   base  = template body at the time the instance was last synced
 *   ours  = current instance body (user edits)
 *   theirs = new template body
 *
 * If the merge succeeds the instance is updated silently.  If it fails,
 * git-style conflict markers are written and the user is warned.
 *
 * Base snapshots live in <sourceRoot>/.ursa/template-bases/ so they survive
 * across builds.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { merge as diff3Merge } from 'node-diff3';
import { extractMetadata } from './metadataExtractor.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TEMPLATES_FOLDER = '_templates';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * True when any segment of `filePath` is `_templates`.
 * Works with both / and \ separators.
 */
export function isInsideTemplatesFolder(filePath) {
  return filePath.split(/[/\\]/).includes(TEMPLATES_FOLDER);
}

/**
 * Return the on-disk directory that stores template-base snapshots.
 */
function templateBasesDir(sourceRoot) {
  return join(sourceRoot.replace(/\/$/, ''), '.ursa', 'template-bases');
}

/**
 * Deterministic filename for a document's stored base snapshot.
 * We encode slashes so everything lives in one flat directory.
 */
function baseSnapshotPath(sourceRoot, documentRelPath) {
  const safeName = documentRelPath.replace(/[/\\]/g, '__');
  return join(templateBasesDir(sourceRoot), safeName);
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

/**
 * Extract the raw frontmatter block (including delimiters + trailing newline)
 * from the beginning of a markdown string.  Returns '' if there is none.
 */
export function extractFrontmatterBlock(content) {
  const match = content.match(/^---\r?\n[\s\S]+?\r?\n---(?:\r?\n|$)/);
  return match ? match[0] : '';
}

/**
 * Return everything *after* the frontmatter block.
 */
export function extractBody(content) {
  return content.slice(extractFrontmatterBlock(content).length);
}

/**
 * Build a YAML frontmatter string from a plain object.
 * Produces `---\nkey: value\n---\n`.
 */
export function buildFrontmatter(meta) {
  if (!meta || Object.keys(meta).length === 0) return '';
  const lines = Object.entries(meta).map(([k, v]) => {
    if (typeof v === 'string') return `${k}: ${v}`;
    // For non-string values use JSON-compatible representation that YAML also accepts
    return `${k}: ${JSON.stringify(v)}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

/**
 * Ensure the document content has a `template-source` frontmatter field.
 * Preserves any existing frontmatter, adding or updating the field.
 */
export function ensureTemplateSourceFrontmatter(content, templateRelPath) {
  const fmBlock = extractFrontmatterBlock(content);
  const body = extractBody(content);

  if (fmBlock) {
    // Frontmatter exists — check if template-source is already there
    if (/^template-source:/m.test(fmBlock)) {
      // Update existing value
      const updated = fmBlock.replace(
        /^template-source:.*$/m,
        `template-source: ${templateRelPath}`
      );
      return updated + body;
    }
    // Insert before closing ---
    const insertPos = fmBlock.lastIndexOf('---');
    const before = fmBlock.slice(0, insertPos);
    const after = fmBlock.slice(insertPos);
    return `${before}template-source: ${templateRelPath}\n${after}${body}`;
  }

  // No frontmatter at all — create one
  return `---\ntemplate-source: ${templateRelPath}\n---\n${content}`;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * From the full list of source files, return a Map of
 *   templateRelPath → absolutePath
 * for every .md/.mdx file inside a _templates folder.
 */
export function findAllDocumentTemplates(allFiles, sourceRoot) {
  const normalizedRoot = sourceRoot.replace(/\/$/, '');
  const templates = new Map();
  for (const file of allFiles) {
    if (isInsideTemplatesFolder(file) && /\.(md|mdx)$/.test(file)) {
      const relPath = relative(normalizedRoot, file);
      templates.set(relPath, file);
    }
  }
  return templates;
}

/**
 * From the full list of source files, return a Map of
 *   documentAbsPath → templateRelPath
 * for every document whose frontmatter contains `template-source`.
 *
 * `rawBodyCache` is an optional Map<absPath, string> of already-read file
 * contents to avoid double I/O during the build.
 */
export async function findTemplatedDocuments(articlePaths, sourceRoot, rawBodyCache) {
  const normalizedRoot = sourceRoot.replace(/\/$/, '');
  const result = new Map(); // docAbsPath → templateRelPath

  for (const absPath of articlePaths) {
    try {
      // Skip files that are themselves inside _templates
      if (isInsideTemplatesFolder(absPath)) continue;

      const content = rawBodyCache?.get(absPath) ?? await readFile(absPath, 'utf8');
      const meta = extractMetadata(content);
      const tplSrc = meta?.['template-source'];
      if (tplSrc) {
        result.set(absPath, tplSrc);
      }
    } catch {
      // Unreadable file — skip silently
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Base snapshot I/O
// ---------------------------------------------------------------------------

/**
 * Load the stored base snapshot for a document.
 * Returns `null` if no snapshot exists yet.
 */
export async function loadBaseSnapshot(sourceRoot, documentRelPath) {
  const p = baseSnapshotPath(sourceRoot, documentRelPath);
  if (!existsSync(p)) return null;
  return readFile(p, 'utf8');
}

/**
 * Persist the base snapshot for a document.
 */
export async function saveBaseSnapshot(sourceRoot, documentRelPath, body) {
  const p = baseSnapshotPath(sourceRoot, documentRelPath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, body, 'utf8');
}

// ---------------------------------------------------------------------------
// 3-way merge
// ---------------------------------------------------------------------------

/**
 * Perform a git-style 3-way merge.
 *
 * @param {string} base      – template body when instance was last synced
 * @param {string} ours      – current instance body (user edits)
 * @param {string} theirs    – new template body
 * @returns {{ merged: string, conflict: boolean }}
 */
export function threeWayMerge(base, ours, theirs) {
  const baseLines  = base.split('\n');
  const ourLines   = ours.split('\n');
  const theirLines = theirs.split('\n');

  const result = diff3Merge(ourLines, baseLines, theirLines);

  if (!result.conflict) {
    return { merged: result.result.join('\n'), conflict: false };
  }

  // Has conflicts — build output with conflict markers
  const lines = [];
  for (const chunk of result.result) {
    if (typeof chunk === 'string') {
      lines.push(chunk);
    }
  }
  // The `merge` function from node-diff3 returns { conflict: bool, result: string[] }
  // When conflict is true, result already contains conflict markers by default
  return { merged: result.result.join('\n'), conflict: true };
}

// ---------------------------------------------------------------------------
// Reconciliation (the main entry point for the build)
// ---------------------------------------------------------------------------

/**
 * Reconcile a single templated document against its parent template.
 *
 * @param {string} docAbsPath      – absolute path to the document
 * @param {string} templateAbsPath – absolute path to the template .md
 * @param {string} sourceRoot      – docroot (with or without trailing /)
 * @returns {Promise<{ action: string, conflict: boolean, message: string }>}
 *   action: 'none' | 'updated' | 'initialized' | 'conflict' | 'error'
 */
export async function reconcileDocument(docAbsPath, templateAbsPath, sourceRoot) {
  const normalizedRoot = sourceRoot.replace(/\/$/, '');
  const docRelPath = relative(normalizedRoot, docAbsPath);

  try {
    const [docContent, templateContent] = await Promise.all([
      readFile(docAbsPath, 'utf8'),
      readFile(templateAbsPath, 'utf8'),
    ]);

    const templateBody = extractBody(templateContent);
    const docBody = extractBody(docContent);
    const docFmBlock = extractFrontmatterBlock(docContent);

    // Load stored base snapshot
    const storedBase = await loadBaseSnapshot(normalizedRoot, docRelPath);

    if (storedBase === null) {
      // First encounter — save current template body as the base.
      // No merge needed; the document is already an instance.
      await saveBaseSnapshot(normalizedRoot, docRelPath, templateBody);
      return { action: 'initialized', conflict: false, message: `Initialized base snapshot for ${docRelPath}` };
    }

    // Check if template actually changed since last sync
    if (storedBase === templateBody) {
      return { action: 'none', conflict: false, message: `Template unchanged for ${docRelPath}` };
    }

    // Template changed — 3-way merge
    const { merged, conflict } = threeWayMerge(storedBase, docBody, templateBody);

    // Write the reconciled document (frontmatter + merged body)
    await writeFile(docAbsPath, docFmBlock + merged, 'utf8');

    // Update the base snapshot to the new template body
    // (even on conflict — the user will resolve, and next run should be clean)
    await saveBaseSnapshot(normalizedRoot, docRelPath, templateBody);

    if (conflict) {
      return { action: 'conflict', conflict: true, message: `Conflict in ${docRelPath} — manual resolution required` };
    }
    return { action: 'updated', conflict: false, message: `Auto-merged template changes into ${docRelPath}` };
  } catch (e) {
    return { action: 'error', conflict: false, message: `Error reconciling ${docRelPath}: ${e.message}` };
  }
}

/**
 * Reconcile ALL templated documents in the source tree.
 *
 * Returns a summary object:
 *   { initialized, updated, conflicts, unchanged, errors, affectedPaths }
 *
 * `affectedPaths` is the set of absolute document paths that were written to
 * disk (so the caller knows which files to regenerate).
 */
export async function reconcileAll(articlePaths, allFiles, sourceRoot) {
  const normalizedRoot = sourceRoot.replace(/\/$/, '');

  // 1. Discover templates and templated documents
  const templateMap = findAllDocumentTemplates(allFiles, normalizedRoot);
  const templatedDocs = await findTemplatedDocuments(articlePaths, normalizedRoot);

  const summary = {
    initialized: 0,
    updated: 0,
    conflicts: 0,
    unchanged: 0,
    errors: 0,
    affectedPaths: new Set(),
    messages: [],
  };

  if (templatedDocs.size === 0) {
    return summary;
  }

  // 2. For each templated document, reconcile
  for (const [docAbsPath, templateRelPath] of templatedDocs) {
    const templateAbsPath = templateMap.get(templateRelPath)
      ?? resolve(normalizedRoot, templateRelPath);

    if (!existsSync(templateAbsPath)) {
      summary.errors++;
      summary.messages.push(`Template not found: ${templateRelPath} (referenced by ${relative(normalizedRoot, docAbsPath)})`);
      continue;
    }

    const result = await reconcileDocument(docAbsPath, templateAbsPath, normalizedRoot);
    summary.messages.push(result.message);

    switch (result.action) {
      case 'initialized':
        summary.initialized++;
        break;
      case 'updated':
        summary.updated++;
        summary.affectedPaths.add(docAbsPath);
        break;
      case 'conflict':
        summary.conflicts++;
        summary.affectedPaths.add(docAbsPath);
        break;
      case 'none':
        summary.unchanged++;
        break;
      case 'error':
        summary.errors++;
        break;
    }
  }

  return summary;
}

/**
 * Reconcile only documents that reference a specific template.
 * Used by serve mode when a single template file changes.
 *
 * @param {string} changedTemplateAbsPath – the template that was saved
 * @param {string[]} articlePaths         – all known article paths
 * @param {string} sourceRoot             – docroot
 * @returns same shape as reconcileAll's summary
 */
export async function reconcileByTemplate(changedTemplateAbsPath, articlePaths, sourceRoot) {
  const normalizedRoot = sourceRoot.replace(/\/$/, '');
  const templateRelPath = relative(normalizedRoot, changedTemplateAbsPath);

  const summary = {
    initialized: 0,
    updated: 0,
    conflicts: 0,
    unchanged: 0,
    errors: 0,
    affectedPaths: new Set(),
    messages: [],
  };

  // Find documents that reference this specific template
  for (const docPath of articlePaths) {
    if (isInsideTemplatesFolder(docPath)) continue;
    try {
      const content = await readFile(docPath, 'utf8');
      const meta = extractMetadata(content);
      if (meta?.['template-source'] !== templateRelPath) continue;

      const result = await reconcileDocument(docPath, changedTemplateAbsPath, normalizedRoot);
      summary.messages.push(result.message);

      switch (result.action) {
        case 'initialized': summary.initialized++; break;
        case 'updated':
          summary.updated++;
          summary.affectedPaths.add(docPath);
          break;
        case 'conflict':
          summary.conflicts++;
          summary.affectedPaths.add(docPath);
          break;
        case 'none': summary.unchanged++; break;
        case 'error': summary.errors++; break;
      }
    } catch {
      // skip unreadable
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Template instantiation (CLI helper)
// ---------------------------------------------------------------------------

/**
 * Create a new document from a template.
 *
 * @param {string} templateAbsPath – absolute path to the template .md file
 * @param {string} destAbsPath     – absolute path for the new document
 * @param {string} sourceRoot      – docroot
 * @returns {{ templateRelPath: string, destRelPath: string }}
 */
export async function instantiateTemplate(templateAbsPath, destAbsPath, sourceRoot) {
  const normalizedRoot = sourceRoot.replace(/\/$/, '');
  const templateRelPath = relative(normalizedRoot, templateAbsPath);
  const destRelPath = relative(normalizedRoot, destAbsPath);

  if (existsSync(destAbsPath)) {
    throw new Error(`Destination already exists: ${destAbsPath}`);
  }

  const templateContent = await readFile(templateAbsPath, 'utf8');
  const templateBody = extractBody(templateContent);

  // Build instance content: original template frontmatter + template-source + body
  const templateMeta = extractMetadata(templateContent);
  const instanceMeta = { ...(templateMeta || {}), 'template-source': templateRelPath };
  const instanceContent = buildFrontmatter(instanceMeta) + templateBody;

  await mkdir(dirname(destAbsPath), { recursive: true });
  await writeFile(destAbsPath, instanceContent, 'utf8');

  // Save the base snapshot so future reconciliation works
  await saveBaseSnapshot(normalizedRoot, destRelPath, templateBody);

  return { templateRelPath, destRelPath };
}
