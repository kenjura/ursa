import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { jest } from '@jest/globals';
import { stagePromotedChangelog } from '../promoteChangelog.js';

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ursa-promote-changelog-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('stagePromotedChangelog', () => {
  it('is a no-op when no changelogPath is provided', async () => {
    const sourceDir = path.join(tmpDir, 'src');
    await fs.mkdir(sourceDir);
    const result = await stagePromotedChangelog({ changelogPath: null, sourceDir });
    expect(result.stagedFile).toBe(null);
    const entries = await fs.readdir(sourceDir);
    expect(entries).toEqual([]);
  });

  it('throws when the source file does not exist', async () => {
    const sourceDir = path.join(tmpDir, 'src');
    await fs.mkdir(sourceDir);
    await expect(
      stagePromotedChangelog({
        changelogPath: path.join(tmpDir, 'missing.md'),
        sourceDir,
      })
    ).rejects.toThrow(/cannot read file/);
  });

  it('copies the file into the source root using its basename', async () => {
    const sourceDir = path.join(tmpDir, 'src');
    await fs.mkdir(sourceDir);
    const cl = path.join(tmpDir, 'CHANGELOG.md');
    await fs.writeFile(cl, '# Hello\n');

    const result = await stagePromotedChangelog({ changelogPath: cl, sourceDir });

    expect(result.stagedFile).toBe(path.join(sourceDir, 'CHANGELOG.md'));
    const staged = await fs.readFile(result.stagedFile, 'utf8');
    expect(staged).toBe('# Hello\n');
  });

  it('cleanup removes the staged file', async () => {
    const sourceDir = path.join(tmpDir, 'src');
    await fs.mkdir(sourceDir);
    const cl = path.join(tmpDir, 'CHANGELOG.md');
    await fs.writeFile(cl, '# Hello\n');

    const result = await stagePromotedChangelog({ changelogPath: cl, sourceDir });
    await result.cleanup();

    await expect(fs.access(result.stagedFile)).rejects.toThrow();
  });

  it('cleanup is idempotent', async () => {
    const sourceDir = path.join(tmpDir, 'src');
    await fs.mkdir(sourceDir);
    const cl = path.join(tmpDir, 'CHANGELOG.md');
    await fs.writeFile(cl, '# Hello\n');

    const result = await stagePromotedChangelog({ changelogPath: cl, sourceDir });
    await result.cleanup();
    await expect(result.cleanup()).resolves.toBeUndefined();
  });

  it('refuses to clobber an existing file in the source root', async () => {
    const sourceDir = path.join(tmpDir, 'src');
    await fs.mkdir(sourceDir);
    const existing = path.join(sourceDir, 'CHANGELOG.md');
    await fs.writeFile(existing, '# Original\n');
    const cl = path.join(tmpDir, 'CHANGELOG.md');
    await fs.writeFile(cl, '# Promoted\n');

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await stagePromotedChangelog({ changelogPath: cl, sourceDir });
      expect(result.stagedFile).toBe(null);
      // Existing file untouched
      const content = await fs.readFile(existing, 'utf8');
      expect(content).toBe('# Original\n');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
