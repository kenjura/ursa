/**
 * Build configuration files: `ursa build prod.yml`, `ursa serve dev.json`.
 *
 * A build config holds the options that would otherwise be passed on the
 * command line, plus build options that have no flag. Keys are the long flag
 * names (`json-only`, `strict-port`); camelCase spellings (`jsonOnly`) are
 * accepted too. Relative paths resolve against the config file's directory,
 * not the working directory, so a config means the same thing wherever the
 * command is run from. Flags given on the command line override the file.
 *
 * See docs/BUILD_CONFIG.md.
 */

import { existsSync, readFileSync, statSync } from "fs";
import { dirname, extname, resolve } from "path";
import YAML from "yaml";

/** Extensions that mark the positional argument as a config file rather than a docroot. */
export const BUILD_CONFIG_EXTENSIONS = [".json", ".yml", ".yaml"];

/**
 * Every recognised key: its type and, for paths, that it resolves against
 * the config file. `commands` limits a key to the commands it means anything to.
 */
export const BUILD_CONFIG_KEYS = {
  source: { type: "path" },
  meta: { type: "path" },
  output: { type: "path" },
  whitelist: { type: "path" },
  exclude: { type: "string-or-list" },
  clean: { type: "boolean" },
  explain: { type: "boolean" },
  "promote-changelog": { type: "path" },
  "json-only": { type: "boolean", commands: ["generate"] },
  port: { type: "number", commands: ["serve"] },
  "strict-port": { type: "boolean", commands: ["serve"] },
  "directory-json": { type: "boolean" },
  "directory-depth": { type: "depth" },
  concurrency: { type: "number" },
};

/** Defaults for keys that have one when neither the file nor the command line sets them. */
export const BUILD_CONFIG_DEFAULTS = {
  output: "output",
  port: 8080,
  clean: false,
  explain: false,
  "json-only": false,
  "strict-port": false,
  "directory-json": true,
  "directory-depth": Infinity,
};

/** True when a positional argument names a build config file (by extension, and it is a file). */
export function isBuildConfigPath(arg) {
  if (!arg || !BUILD_CONFIG_EXTENSIONS.includes(extname(arg).toLowerCase())) return false;
  try {
    return statSync(arg).isFile();
  } catch {
    return false;
  }
}

const kebab = (key) => key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/**
 * Parse a `directory-depth` value: a non-negative integer, or
 * `infinite`/`infinity`/`-1`/null for no limit.
 */
export function parseDirectoryDepth(value) {
  if (value === null || value === undefined || value === Infinity) return Infinity;
  if (typeof value === "string" && /^(inf|infinite|infinity|unlimited)$/i.test(value.trim())) return Infinity;
  const n = Number(value);
  if (n === -1) return Infinity;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`directory-depth must be a non-negative integer or "infinite" (got ${JSON.stringify(value)})`);
  }
  return n;
}

function coerce(key, value, type, baseDir) {
  switch (type) {
    case "path":
      if (typeof value !== "string") throw new Error(`${key} must be a path`);
      return resolve(baseDir, value);
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`${key} must be true or false`);
      return value;
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
      return n;
    }
    case "depth":
      return parseDirectoryDepth(value);
    case "string-or-list":
      if (Array.isArray(value)) return value.map(String).join(",");
      if (typeof value !== "string") throw new Error(`${key} must be a string or a list`);
      // A list file is a path, so it resolves against the config like other paths
      if (existsSync(resolve(baseDir, value)) && statSync(resolve(baseDir, value)).isFile()) {
        return resolve(baseDir, value);
      }
      return value;
    default:
      return value;
  }
}

/**
 * Load and validate a build config file.
 *
 * @param {string} configPath - Path to a .json, .yml or .yaml file
 * @param {object} [opts]
 * @param {string} [opts.command] - "generate" or "serve": keys for the other command are warned about
 * @param {(msg: string) => void} [opts.warn]
 * @returns {object} Options keyed by long flag name, paths absolute
 */
export function loadBuildConfig(configPath, { command = null, warn = (m) => console.warn(m) } = {}) {
  const path = resolve(configPath);
  if (!existsSync(path)) throw new Error(`Build config not found: ${path}`);
  const text = readFileSync(path, "utf8");
  let raw;
  try {
    raw = extname(path).toLowerCase() === ".json" ? JSON.parse(text) : YAML.parse(text);
  } catch (e) {
    throw new Error(`Could not parse build config ${path}: ${e.message}`);
  }
  if (raw == null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Build config ${path} must be a mapping of option names to values`);
  }

  const baseDir = dirname(path);
  const options = {};
  for (const [rawKey, value] of Object.entries(raw)) {
    const key = kebab(rawKey);
    const spec = BUILD_CONFIG_KEYS[key];
    if (!spec) {
      warn(`⚠️  ${path}: unknown option "${rawKey}" ignored`);
      continue;
    }
    if (command && spec.commands && !spec.commands.includes(command)) {
      warn(`⚠️  ${path}: "${rawKey}" has no effect on \`ursa ${command}\``);
      continue;
    }
    if (value === null && spec.type !== "depth") continue;
    try {
      options[key] = coerce(rawKey, value, spec.type, baseDir);
    } catch (e) {
      throw new Error(`Build config ${path}: ${e.message}`);
    }
  }
  return options;
}

/**
 * Merge the three layers: defaults < config file < flags given on the command line.
 *
 * @param {object} fileOptions - From loadBuildConfig (paths already absolute)
 * @param {object} cliOptions - Flags the user actually passed, paths as typed
 * @param {string} [cwd]
 * @returns {object} Options keyed by long flag name, with paths absolute
 */
export function mergeBuildOptions(fileOptions, cliOptions, cwd = process.cwd()) {
  const merged = { ...BUILD_CONFIG_DEFAULTS, ...fileOptions };
  for (const [key, value] of Object.entries(cliOptions)) {
    if (value === undefined) continue;
    const spec = BUILD_CONFIG_KEYS[key];
    merged[key] = spec?.type === "path" ? resolve(cwd, value) : spec?.type === "depth" ? parseDirectoryDepth(value) : value;
  }
  if (typeof merged.output === "string") merged.output = resolve(cwd, merged.output);
  return merged;
}
