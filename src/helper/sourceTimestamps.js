import { execFile } from "child_process";
import { promisify } from "util";
import { realpath, stat } from "fs/promises";
import { relative, resolve, sep } from "path";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// When was a source document last edited?
//
// The recent-activity feed needs a per-document "last edited" time that does
// not depend on when ursa happened to run. Two sources, in order:
//
// 1. git: the commit date of the last commit that touched the file. One
//    `git log --name-only` pass over the source directory yields every file's
//    latest commit in a single process, which is far cheaper than a `git log`
//    per file. Files with uncommitted changes (per `git status`) are taken
//    from the working tree instead, since the commit time predates the edit.
// 2. filesystem mtime, for sources that are not in a git work tree, files git
//    does not know about, and the uncommitted files above.
//
// A shallow clone (CI checkouts default to depth 1) truncates history, so
// every file appears to have been edited in the one fetched commit. That is
// detected and warned about; the fix is on the checkout side (fetch-depth: 0).
// ---------------------------------------------------------------------------

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Parse `git log --format=%x00%ct --name-only` output into a map of
 * repo-relative path → last-commit time in ms. The log is newest-first, so the
 * first commit a path appears under is its latest.
 * @param {string} log
 * @returns {Map<string, number>}
 */
export function parseGitLog(log) {
  const times = new Map();
  let current = 0;
  for (const line of log.split("\n")) {
    if (line.startsWith("\0")) {
      current = Number(line.slice(1)) * 1000;
    } else if (line && !times.has(line)) {
      times.set(line, current);
    }
  }
  return times;
}

/**
 * Parse `git status --porcelain -z` output into the set of repo-relative paths
 * with uncommitted changes (modified, added, untracked, renamed — any status).
 * @param {string} status
 * @returns {Set<string>}
 */
export function parseGitStatus(status) {
  const dirty = new Set();
  const entries = status.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    dirty.add(entry.slice(3));
    // A rename entry ("R  new\0old") is followed by the original path
    if (code[0] === "R" || code[0] === "C") i++;
  }
  return dirty;
}

/**
 * Build a lookup of last-edited times for files under `sourceDir`.
 *
 * @param {string} sourceDir - Absolute path to the source directory
 * @param {object} [options]
 * @param {(msg: string) => void} [options.log] - Receives one-line status/warnings
 * @returns {Promise<{ get: (file: string) => Promise<number>, source: 'git'|'mtime' }>}
 */
export async function buildSourceTimestampIndex(sourceDir, { log = () => {} } = {}) {
  const dir = resolve(sourceDir);

  async function mtime(file) {
    try {
      return (await stat(file)).mtimeMs;
    } catch {
      return 0;
    }
  }

  // git reports the real path of the work tree; resolve symlinks (macOS
  // /var → /private/var, for one) so paths line up with what git prints.
  let realDir = dir;
  let toplevel = null;
  try {
    realDir = await realpath(dir);
    toplevel = (await git(realDir, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    // Not a git work tree, or git is not installed
  }
  if (!toplevel) {
    return { get: mtime, source: "mtime" };
  }

  let committed;
  let dirty;
  const relSource = relative(toplevel, realDir) || ".";
  try {
    const [logOut, statusOut, shallow] = await Promise.all([
      git(toplevel, ["log", "--format=%x00%ct", "--name-only", "--", relSource]),
      git(toplevel, ["status", "--porcelain", "-z", "--untracked-files=all", "--", relSource]),
      git(toplevel, ["rev-parse", "--is-shallow-repository"]),
    ]);
    committed = parseGitLog(logOut);
    dirty = parseGitStatus(statusOut);
    if (shallow.trim() === "true") {
      log(
        "⚠️  Source is a shallow git clone: every document appears last edited in the one fetched commit, " +
          "so recent activity will be inaccurate. Fetch full history (e.g. actions/checkout fetch-depth: 0)."
      );
    }
  } catch (e) {
    log(`⚠️  git history unavailable (${e.message.split("\n")[0]}); using file mtimes for recent activity`);
    return { get: mtime, source: "mtime" };
  }

  return {
    source: "git",
    async get(file) {
      // Repo-relative path as git prints it: forward slashes on every platform
      const fromSource = relative(dir, resolve(file));
      const rel = (relSource === "." ? fromSource : `${relSource}/${fromSource}`).split(sep).join("/");
      if (dirty.has(rel) || !committed.has(rel)) return mtime(file);
      return committed.get(rel);
    },
  };
}
