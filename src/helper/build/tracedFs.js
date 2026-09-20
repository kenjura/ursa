/**
 * Filesystem access that records what it touched.
 *
 * The build graph (graph.js) decides what to rebuild purely from recorded
 * inputs, so every file a node's compute function reads, every path it probes
 * and every directory it lists has to become an edge. Threading a context
 * object through every helper that touches the disk — the menu walker, the
 * label resolver, the breadcrumb builder, the style.css chain finder — would
 * mean rewriting all of them. Instead those helpers import their `fs` calls
 * from here. When a node is computing, an AsyncLocalStorage store carries that
 * node's recorder, and each call below reports the leaf it observed. Outside a
 * compute (tests, the CLI) the calls are plain `fs`.
 *
 * Because AsyncLocalStorage follows the async chain, concurrent computes each
 * see only their own recorder, and a synchronous read inside a deeply nested
 * helper is attributed to the right node.
 *
 * Fingerprints:
 *   - file:   md5 of the content (16 hex chars), or "missing"
 *   - lookup: "exists" | "absent"
 *   - dir:    md5 of the sorted visible child names, or "missing"
 *
 * Names beginning with "." and the deny-listed names (`node_modules`, the
 * `4913` vim probe, editor scratch files) are not part of a directory's
 * fingerprint — they are never build inputs, and excluding them keeps an
 * editor's temp files from dirtying the menu.
 */

import { AsyncLocalStorage } from "async_hooks";
import { createHash } from "crypto";
import fs from "fs";
import fsp from "fs/promises";

const als = new AsyncLocalStorage();

export const MISSING = "missing";
export const EXISTS = "exists";
export const ABSENT = "absent";

export function hashBytes(data) {
  return createHash("md5").update(data).digest("hex").substring(0, 16);
}

/** Run `fn` with `recorder` as the active leaf recorder. */
export function withRecorder(recorder, fn) {
  return als.run(recorder, fn);
}

/** The recorder for the currently computing node, or undefined. */
export function currentRecorder() {
  return als.getStore();
}

// ---------------------------------------------------------------------------
// Directory listings
// ---------------------------------------------------------------------------

/** Editor scratch and probe files that must never count as inputs. */
export function isScratchName(name) {
  return (
    name.endsWith("~") ||
    name.endsWith(".swp") ||
    name.endsWith(".swx") ||
    name.endsWith(".tmp") ||
    name.startsWith(".#") ||
    name === "4913"
  );
}

/** Names never observed by a directory leaf. */
export function isIgnoredDirEntry(name) {
  return name.startsWith(".") || name === "node_modules" || isScratchName(name);
}

/**
 * Fingerprint a directory from its Dirent list (or `null` when it is missing).
 * Sorted by name so readdir order never leaks into a fingerprint.
 */
export function dirFingerprintFromEntries(entries) {
  if (!entries) return MISSING;
  const names = [];
  for (const e of entries) {
    const name = typeof e === "string" ? e : e.name;
    if (isIgnoredDirEntry(name)) continue;
    // A directory and a file of the same name are different inputs
    names.push(typeof e !== "string" && e.isDirectory() ? name + "/" : name);
  }
  names.sort();
  return hashBytes(names.join("\n"));
}

// ---------------------------------------------------------------------------
// Recording helpers (shared by sync and async variants)
// ---------------------------------------------------------------------------

function recordFile(rec, path, st, buf) {
  if (!rec) return;
  if (!st) {
    rec.file(path, MISSING, null);
    return;
  }
  const stats = { size: st.size, mtimeMs: st.mtimeMs };
  const fp = rec.knownFileFingerprint?.(path, stats) ?? hashBytes(buf);
  rec.file(path, fp, stats);
}

function recordLookup(rec, path, exists) {
  if (rec) rec.lookup(path, exists ? EXISTS : ABSENT);
}

function recordDir(rec, path, entries) {
  if (rec) rec.dir(path, dirFingerprintFromEntries(entries));
}

// ---------------------------------------------------------------------------
// Synchronous API
// ---------------------------------------------------------------------------

export function existsSync(path) {
  const exists = fs.existsSync(path);
  recordLookup(currentRecorder(), path, exists);
  return exists;
}

export function readFileSync(path, options) {
  const rec = currentRecorder();
  let st = null;
  try {
    st = fs.statSync(path);
  } catch {
    recordFile(rec, path, null, null);
    throw enoent(path);
  }
  const buf = fs.readFileSync(path);
  recordFile(rec, path, st, buf);
  return options ? buf.toString(typeof options === "string" ? options : options.encoding ?? "utf8") : buf;
}

export function readdirSync(path, options) {
  const rec = currentRecorder();
  let entries;
  try {
    entries = fs.readdirSync(path, { withFileTypes: true });
  } catch (e) {
    recordDir(rec, path, null);
    throw e;
  }
  recordDir(rec, path, entries);
  if (options?.withFileTypes) return entries;
  return entries.map((e) => e.name);
}

/** stat as an existence probe plus a content leaf: callers use size/mtime. */
export function statSync(path) {
  const rec = currentRecorder();
  try {
    const st = fs.statSync(path);
    recordLookup(rec, path, true);
    return st;
  } catch (e) {
    recordLookup(rec, path, false);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Promise API
// ---------------------------------------------------------------------------

export async function readFile(path, options) {
  const rec = currentRecorder();
  let st = null;
  try {
    st = await fsp.stat(path);
  } catch {
    recordFile(rec, path, null, null);
    throw enoent(path);
  }
  const buf = await fsp.readFile(path);
  recordFile(rec, path, st, buf);
  return options ? buf.toString(typeof options === "string" ? options : options.encoding ?? "utf8") : buf;
}

export async function readdir(path, options) {
  const rec = currentRecorder();
  let entries;
  try {
    entries = await fsp.readdir(path, { withFileTypes: true });
  } catch (e) {
    recordDir(rec, path, null);
    throw e;
  }
  recordDir(rec, path, entries);
  if (options?.withFileTypes) return entries;
  return entries.map((e) => e.name);
}

export async function stat(path) {
  const rec = currentRecorder();
  try {
    const st = await fsp.stat(path);
    recordLookup(rec, path, true);
    return st;
  } catch (e) {
    recordLookup(rec, path, false);
    throw e;
  }
}

export async function exists(path) {
  try {
    await fsp.access(path);
    recordLookup(currentRecorder(), path, true);
    return true;
  } catch {
    recordLookup(currentRecorder(), path, false);
    return false;
  }
}

/**
 * Directory entries that are build inputs, sorted by name, with `kind`.
 * Returns [] for a missing directory (the miss is recorded).
 * @returns {Promise<{name: string, kind: 'file'|'dir'|'other'}[]>}
 */
export async function listDir(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !isIgnoredDirEntry(e.name))
    .map((e) => ({
      name: e.name,
      kind: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function enoent(path) {
  const e = new Error(`ENOENT: no such file or directory, open '${path}'`);
  e.code = "ENOENT";
  e.path = path;
  return e;
}
