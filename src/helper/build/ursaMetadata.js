// Helper for building the _ursa_metadata field embedded in generated JSON files
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { getUrsaVersion } from "../ursaVersion.js";

/**
 * Read the documentation repo version from its package.json.
 * Checks the source dir itself, then one level up (if docs is a subfolder).
 * @param {string} _source - original source path
 * @returns {Promise<string>} The doc repo version, or 'unknown' if it can't be read
 */
async function getDocVersion(_source) {
  const sourceDir = resolve(_source);
  const packagePaths = [
    join(sourceDir, "package.json"),
    join(sourceDir, "..", "package.json"),
  ];
  for (const packagePath of packagePaths) {
    try {
      if (existsSync(packagePath)) {
        const docPackage = JSON.parse(await readFile(packagePath, "utf8"));
        if (docPackage.version) return docPackage.version;
      }
    } catch (e) {
      // Continue to next path
    }
  }
  return "unknown";
}

/**
 * Build the _ursa_metadata object that is embedded in every generated JSON file.
 * @param {string} _source - original source path of the documentation repo
 * @returns {Promise<{ursaVersion: string, docVersion: string}>}
 */
export async function getUrsaMetadata(_source) {
  return { ursaVersion: getUrsaVersion(), docVersion: await getDocVersion(_source) };
}
