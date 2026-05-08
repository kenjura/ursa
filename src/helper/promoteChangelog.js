/**
 * Promote-changelog helper.
 *
 * Implements the `--promote-changelog=<file.md>` CLI option for `generate`
 * and `serve`. The named markdown (or .mdx) file is staged into the source
 * root before the build runs, so that it is rendered by the normal Ursa
 * pipeline and ends up in the output root as a sibling of the main
 * `index.html`. Once the build finishes (or the serve process exits) the
 * staged copy is removed, leaving the source tree untouched.
 *
 * Behavior:
 *   - If no `--promote-changelog` value is provided, this is a no-op.
 *   - The staged filename is the basename of the supplied path (e.g.
 *     `CHANGELOG.md` becomes `<source>/CHANGELOG.md`).
 *   - If a file with the same basename already exists in the source root,
 *     no staging is performed and the existing file is left in place. A
 *     warning is logged so the user can resolve the conflict.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Stage a changelog file into the source root.
 *
 * @param {Object} args
 * @param {string|null|undefined} args.changelogPath - Path supplied via --promote-changelog.
 * @param {string} args.sourceDir - Resolved absolute path to the source directory.
 * @returns {Promise<{ stagedFile: string|null, cleanup: () => Promise<void> }>}
 */
export async function stagePromotedChangelog({ changelogPath, sourceDir }) {
  const noop = { stagedFile: null, cleanup: async () => {} };
  if (!changelogPath) return noop;

  const absolute = path.resolve(changelogPath);
  let content;
  try {
    content = await fs.readFile(absolute, 'utf8');
  } catch (err) {
    throw new Error(
      `--promote-changelog: cannot read file at ${absolute}: ${err.message}`
    );
  }

  const baseName = path.basename(absolute);
  const stagedFile = path.join(sourceDir, baseName);

  // Refuse to clobber an existing file in the source root.
  let alreadyExists = false;
  try {
    await fs.access(stagedFile);
    alreadyExists = true;
  } catch {
    // expected when the file does not exist
  }

  if (alreadyExists) {
    console.warn(
      `--promote-changelog: a file already exists at ${stagedFile}; leaving it in place.`
    );
    return noop;
  }

  await fs.writeFile(stagedFile, content);
  console.log(`--promote-changelog: staged ${absolute} -> ${stagedFile}`);

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      await fs.unlink(stagedFile);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(
          `--promote-changelog: failed to remove staged file ${stagedFile}: ${err.message}`
        );
      }
    }
  };

  return { stagedFile, cleanup };
}

/**
 * Register process-exit handlers that invoke the given cleanup function.
 * Used by long-running commands (serve, dev) so the staged file is removed
 * even when the user stops the process with Ctrl-C.
 *
 * @param {() => Promise<void>} cleanup
 */
export function registerCleanupOnExit(cleanup) {
  if (!cleanup) return;
  let triggered = false;
  const run = (exitCode) => {
    if (triggered) return;
    triggered = true;
    Promise.resolve(cleanup())
      .catch(() => {})
      .finally(() => {
        if (typeof exitCode === 'number') process.exit(exitCode);
      });
  };
  process.once('exit', () => run());
  process.once('SIGINT', () => run(130));
  process.once('SIGTERM', () => run(143));
}
