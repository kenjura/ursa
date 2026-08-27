import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

let cached = null;

/**
 * Read ursa's own version from the package.json that ships with it.
 * Memoised — it cannot change while the process runs.
 * @returns {string} The version, or 'unknown' if it can't be read
 */
export function getUrsaVersion() {
  if (cached) return cached;
  try {
    // From src/helper/ursaVersion.js, go up to the package root
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const ursaPackagePath = resolve(currentDir, "..", "..", "package.json");
    if (existsSync(ursaPackagePath)) {
      const ursaPackage = JSON.parse(readFileSync(ursaPackagePath, "utf8"));
      if (ursaPackage.version) return (cached = ursaPackage.version);
    }
  } catch (e) {
    console.error(`Error reading ursa package.json: ${e.message}`);
  }
  return (cached = "unknown");
}
