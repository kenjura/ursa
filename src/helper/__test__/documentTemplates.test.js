import { join } from 'path';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import {
  isInsideTemplatesFolder,
  extractFrontmatterBlock,
  extractBody,
  buildFrontmatter,
  ensureTemplateSourceFrontmatter,
  findAllDocumentTemplates,
  threeWayMerge,
  instantiateTemplate,
  reconcileDocument,
  reconcileAll,
  loadBaseSnapshot,
} from '../documentTemplates.js';

// Helper: create a temp directory for each test
let tempDir;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ursa-doctemplate-'));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isInsideTemplatesFolder
// ---------------------------------------------------------------------------
describe('isInsideTemplatesFolder', () => {
  it('detects _templates as a path segment', () => {
    expect(isInsideTemplatesFolder('/site/docs/_templates/city.md')).toBe(true);
    expect(isInsideTemplatesFolder('_templates/foo.md')).toBe(true);
    expect(isInsideTemplatesFolder('/a/b/_templates/c/d.md')).toBe(true);
  });

  it('returns false for normal paths', () => {
    expect(isInsideTemplatesFolder('/site/docs/city.md')).toBe(false);
    expect(isInsideTemplatesFolder('/site/my_templates/city.md')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------
describe('extractFrontmatterBlock / extractBody', () => {
  it('extracts frontmatter from a standard document', () => {
    const content = '---\ntitle: Hello\n---\nBody here';
    expect(extractFrontmatterBlock(content)).toBe('---\ntitle: Hello\n---\n');
    expect(extractBody(content)).toBe('Body here');
  });

  it('returns empty string when no frontmatter', () => {
    const content = 'Just body content';
    expect(extractFrontmatterBlock(content)).toBe('');
    expect(extractBody(content)).toBe('Just body content');
  });
});

describe('buildFrontmatter', () => {
  it('builds YAML frontmatter from an object', () => {
    const result = buildFrontmatter({ title: 'My City', type: 'city' });
    expect(result).toBe('---\ntitle: My City\ntype: city\n---\n');
  });

  it('returns empty string for null/empty', () => {
    expect(buildFrontmatter(null)).toBe('');
    expect(buildFrontmatter({})).toBe('');
  });
});

describe('ensureTemplateSourceFrontmatter', () => {
  it('adds frontmatter when none exists', () => {
    const result = ensureTemplateSourceFrontmatter('Body text', '_templates/city.md');
    expect(result).toContain('template-source: _templates/city.md');
    expect(result).toContain('Body text');
  });

  it('inserts into existing frontmatter', () => {
    const content = '---\ntitle: Springfield\n---\nBody';
    const result = ensureTemplateSourceFrontmatter(content, '_templates/city.md');
    expect(result).toContain('template-source: _templates/city.md');
    expect(result).toContain('title: Springfield');
    expect(result).toContain('Body');
  });

  it('updates existing template-source value', () => {
    const content = '---\ntemplate-source: old/path.md\ntitle: X\n---\nBody';
    const result = ensureTemplateSourceFrontmatter(content, '_templates/new.md');
    expect(result).toContain('template-source: _templates/new.md');
    expect(result).not.toContain('old/path.md');
  });
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
describe('findAllDocumentTemplates', () => {
  it('finds .md files inside _templates folders', () => {
    const files = [
      '/src/docs/_templates/city.md',
      '/src/docs/_templates/character.md',
      '/src/docs/places/springfield.md',
      '/src/docs/deep/path/_templates/quest.mdx',
    ];
    const result = findAllDocumentTemplates(files, '/src/docs/');
    expect(result.size).toBe(3);
    expect(result.has('_templates/city.md')).toBe(true);
    expect(result.has('_templates/character.md')).toBe(true);
    expect(result.has('deep/path/_templates/quest.mdx')).toBe(true);
  });

  it('ignores non-markdown files in _templates', () => {
    const files = ['/src/_templates/style.css', '/src/_templates/image.png'];
    const result = findAllDocumentTemplates(files, '/src/');
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3-way merge
// ---------------------------------------------------------------------------
describe('threeWayMerge', () => {
  it('cleanly merges non-conflicting changes', () => {
    const base   = 'line 1\nline 2\nline 3';
    const ours   = 'line 1\nline 2 modified\nline 3';     // user edited line 2
    const theirs = 'line 1\nline 2\nline 3\nline 4 new';  // template added line 4

    const { merged, conflict } = threeWayMerge(base, ours, theirs);
    expect(conflict).toBe(false);
    expect(merged).toContain('line 2 modified');
    expect(merged).toContain('line 4 new');
  });

  it('returns conflict markers when both sides edit the same line', () => {
    const base   = 'line 1\nline 2\nline 3';
    const ours   = 'line 1\nours version\nline 3';
    const theirs = 'line 1\ntheirs version\nline 3';

    const { merged, conflict } = threeWayMerge(base, ours, theirs);
    expect(conflict).toBe(true);
    expect(merged).toContain('<<<<<<<');
    expect(merged).toContain('>>>>>>>');
  });

  it('handles identical changes on both sides (no conflict)', () => {
    const base   = 'line 1\nline 2\nline 3';
    const ours   = 'line 1\nline 2 same change\nline 3';
    const theirs = 'line 1\nline 2 same change\nline 3';

    const { merged, conflict } = threeWayMerge(base, ours, theirs);
    expect(conflict).toBe(false);
    expect(merged).toBe('line 1\nline 2 same change\nline 3');
  });
});

// ---------------------------------------------------------------------------
// instantiateTemplate (filesystem)
// ---------------------------------------------------------------------------
describe('instantiateTemplate', () => {
  it('creates a document from a template with template-source frontmatter', async () => {
    // Setup: create a template file
    const tplDir = join(tempDir, '_templates');
    await mkdir(tplDir, { recursive: true });
    const tplPath = join(tplDir, 'city.md');
    await writeFile(tplPath, '---\ntype: city\n---\n# {City Name}\n\n## Geography\n');

    const destPath = join(tempDir, 'places', 'springfield.md');
    const result = await instantiateTemplate(tplPath, destPath, tempDir);

    expect(result.templateRelPath).toBe('_templates/city.md');
    expect(result.destRelPath).toBe(join('places', 'springfield.md'));

    // Check the created file
    const content = await readFile(destPath, 'utf8');
    expect(content).toContain('template-source: _templates/city.md');
    expect(content).toContain('type: city');
    expect(content).toContain('# {City Name}');
    expect(content).toContain('## Geography');
  });

  it('creates frontmatter even if the template has none', async () => {
    const tplDir = join(tempDir, '_templates');
    await mkdir(tplDir, { recursive: true });
    const tplPath = join(tplDir, 'bare.md');
    await writeFile(tplPath, '# Simple Template\n\nContent here.\n');

    const destPath = join(tempDir, 'pages', 'new.md');
    await instantiateTemplate(tplPath, destPath, tempDir);

    const content = await readFile(destPath, 'utf8');
    expect(content).toContain('---');
    expect(content).toContain('template-source: _templates/bare.md');
    expect(content).toContain('# Simple Template');
  });

  it('throws if destination already exists', async () => {
    const tplDir = join(tempDir, '_templates');
    await mkdir(tplDir, { recursive: true });
    const tplPath = join(tplDir, 'city.md');
    await writeFile(tplPath, '# Template');

    const destPath = join(tempDir, 'existing.md');
    await writeFile(destPath, 'already here');

    await expect(instantiateTemplate(tplPath, destPath, tempDir)).rejects.toThrow(
      /already exists/
    );
  });

  it('saves a base snapshot for future reconciliation', async () => {
    const tplDir = join(tempDir, '_templates');
    await mkdir(tplDir, { recursive: true });
    const tplPath = join(tplDir, 'city.md');
    await writeFile(tplPath, '---\ntype: city\n---\n# {City Name}\n');

    const destPath = join(tempDir, 'places', 'springfield.md');
    const result = await instantiateTemplate(tplPath, destPath, tempDir);

    const base = await loadBaseSnapshot(tempDir, result.destRelPath);
    expect(base).toBe('# {City Name}\n');
  });
});

// ---------------------------------------------------------------------------
// reconcileDocument (filesystem)
// ---------------------------------------------------------------------------
describe('reconcileDocument', () => {
  it('initializes a base snapshot on first encounter', async () => {
    // Setup: template + document that references it, but no base snapshot yet
    const tplDir = join(tempDir, '_templates');
    await mkdir(tplDir, { recursive: true });
    const tplPath = join(tplDir, 'city.md');
    await writeFile(tplPath, '# {City Name}\n\n## Geography\n');

    const docPath = join(tempDir, 'springfield.md');
    await writeFile(docPath, '---\ntemplate-source: _templates/city.md\n---\n# Springfield\n\n## Geography\nFlat plains.\n');

    const result = await reconcileDocument(docPath, tplPath, tempDir);
    expect(result.action).toBe('initialized');
  });

  it('returns "none" when template has not changed', async () => {
    const tplDir = join(tempDir, '_templates');
    await mkdir(tplDir, { recursive: true });
    const tplPath = join(tplDir, 'city.md');
    const tplBody = '# {City Name}\n\n## Geography\n';
    await writeFile(tplPath, tplBody);

    const destPath = join(tempDir, 'springfield.md');
    // Instantiate first so base is saved
    await instantiateTemplate(tplPath, destPath, tempDir);

    // Now reconcile without changing the template
    const result = await reconcileDocument(destPath, tplPath, tempDir);
    expect(result.action).toBe('none');
  });

  it('auto-merges when template and document change different parts', async () => {
    const tplDir = join(tempDir, '_templates');
    await mkdir(tplDir, { recursive: true });
    const tplPath = join(tplDir, 'city.md');
    await writeFile(tplPath, '# {City Name}\n\n## Geography\n\n## History\n');

    const destPath = join(tempDir, 'springfield.md');
    await instantiateTemplate(tplPath, destPath, tempDir);

    // User modifies the document (fills in Geography)
    const docContent = await readFile(destPath, 'utf8');
    const edited = docContent.replace('## Geography', '## Geography\nFlat plains and rivers.');
    await writeFile(destPath, edited);

    // Template adds a new section at the end
    await writeFile(tplPath, '# {City Name}\n\n## Geography\n\n## History\n\n## Notable People\n');

    const result = await reconcileDocument(destPath, tplPath, tempDir);
    expect(result.action).toBe('updated');
    expect(result.conflict).toBe(false);

    // Verify the merged document has both changes
    const merged = await readFile(destPath, 'utf8');
    expect(merged).toContain('Flat plains and rivers.');
    expect(merged).toContain('## Notable People');
  });

  it('writes conflict markers when both sides edit the same section', async () => {
    const tplDir = join(tempDir, '_templates');
    await mkdir(tplDir, { recursive: true });
    const tplPath = join(tplDir, 'city.md');
    await writeFile(tplPath, '# {City Name}\n\n## Geography\nDescribe here.\n');

    const destPath = join(tempDir, 'springfield.md');
    await instantiateTemplate(tplPath, destPath, tempDir);

    // User changes "Describe here." to their own text
    const docContent = await readFile(destPath, 'utf8');
    await writeFile(destPath, docContent.replace('Describe here.', 'User wrote this.'));

    // Template also changes "Describe here." to something else
    await writeFile(tplPath, '# {City Name}\n\n## Geography\nTemplate says this instead.\n');

    const result = await reconcileDocument(destPath, tplPath, tempDir);
    expect(result.action).toBe('conflict');
    expect(result.conflict).toBe(true);

    const merged = await readFile(destPath, 'utf8');
    expect(merged).toContain('<<<<<<<');
    expect(merged).toContain('>>>>>>>');
  });
});

// ---------------------------------------------------------------------------
// reconcileAll (filesystem)
// ---------------------------------------------------------------------------
describe('reconcileAll', () => {
  it('reconciles multiple documents at once', async () => {
    const tplDir = join(tempDir, '_templates');
    await mkdir(tplDir, { recursive: true });
    const tplPath = join(tplDir, 'city.md');
    await writeFile(tplPath, '# {City Name}\n\n## Geography\n');

    // Create two instances
    const doc1 = join(tempDir, 'springfield.md');
    const doc2 = join(tempDir, 'shelbyville.md');
    await instantiateTemplate(tplPath, doc1, tempDir);
    await instantiateTemplate(tplPath, doc2, tempDir);

    // Change template
    await writeFile(tplPath, '# {City Name}\n\n## Geography\n\n## History\n');

    const allFiles = [tplPath, doc1, doc2];
    const articlePaths = [doc1, doc2];

    const summary = await reconcileAll(articlePaths, allFiles, tempDir);
    expect(summary.updated).toBe(2);
    expect(summary.conflicts).toBe(0);
    expect(summary.affectedPaths.size).toBe(2);

    // Verify both docs now have the new section
    const content1 = await readFile(doc1, 'utf8');
    const content2 = await readFile(doc2, 'utf8');
    expect(content1).toContain('## History');
    expect(content2).toContain('## History');
  });

  it('returns zeroes when there are no templated documents', async () => {
    const doc = join(tempDir, 'plain.md');
    await writeFile(doc, '# Just a regular doc');

    const summary = await reconcileAll([doc], [doc], tempDir);
    expect(summary.updated).toBe(0);
    expect(summary.initialized).toBe(0);
  });
});
