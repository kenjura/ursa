import { resolve } from "path";

/**
 * Hidden / system folder detection.
 *
 * The pattern matches a path segment that starts with a dot (but not `..`),
 * `node_modules`, or `_templates`. A leading separator is required, which is
 * why {@link toSourceRelative} always returns a path that begins with one.
 */
export const HIDDEN_OR_SYSTEM_DIRS =
  /[\/\\]\.(?!\.)|[\/\\]node_modules[\/\\]|[\/\\]_templates[\/\\]|[\/\\]_templates$/;

/** The dev server's narrower pattern — no `_templates`, which it does not process. */
export const HIDDEN_OR_SYSTEM_DIRS_DEV = /[\/\\]\.(?!\.)|[\/\\]node_modules[\/\\]/;

/**
 * A file's path relative to the site source root, always separator-prefixed.
 *
 * **This is the whole point of this module.** These patterns must be tested
 * against the path *relative to `source`*, never against the absolute path. A
 * docroot that happens to live under a dot-directory — `~/.config/site`, a git
 * worktree under `.claude/worktrees/…`, anything inside `.local` — is not a
 * site full of hidden folders, but an absolute-path test reads it as one and
 * classifies **every** article as hidden. The failure is silent and
 * particularly nasty: generation reports success, and writes a site with zero
 * pages, so the first symptom is an empty deploy.
 *
 * The separator prefix preserves detection of a genuinely hidden folder at the
 * top of the docroot (`<source>/.drafts/x.md` → `/.drafts/x.md`, still a match).
 *
 * @param {string} filePath - Absolute path to a file or directory
 * @param {string} source - Absolute path of the source root (trailing slash optional)
 * @returns {string} The relative path, beginning with `/`
 */
export function toSourceRelative(filePath, source) {
  if (!source) return filePath;

  // Normalize both sides so a trailing slash on either cannot change the result.
  const root = resolve(source);
  const full = resolve(filePath);

  if (full === root) return "/";
  if (!full.startsWith(root)) return full; // outside the docroot; test it as-is

  const rel = full.slice(root.length);
  return rel.startsWith("/") || rel.startsWith("\\") ? rel : `/${rel}`;
}

/**
 * True when a path lies inside a hidden or system folder *within the docroot*.
 *
 * @param {string} filePath - Absolute path to a file or directory
 * @param {string} source - Absolute path of the source root
 * @param {RegExp} [pattern] - Defaults to {@link HIDDEN_OR_SYSTEM_DIRS}
 */
export function isHiddenOrSystemPath(
  filePath,
  source,
  pattern = HIDDEN_OR_SYSTEM_DIRS
) {
  return pattern.test(toSourceRelative(filePath, source));
}
