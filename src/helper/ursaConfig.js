import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const CONFIG_FILENAME = '.ursa.json';

/**
 * Get the path to the .ursa.json config file in the source directory
 * @param {string} sourceDir - The source directory path
 * @returns {string} Path to the config file
 */
function getConfigPath(sourceDir) {
  return join(sourceDir, CONFIG_FILENAME);
}

/**
 * Load the ursa config from .ursa.json
 * @param {string} sourceDir - The source directory path
 * @returns {object} The config object (empty object if file doesn't exist)
 */
export function loadUrsaConfig(sourceDir) {
  const configPath = getConfigPath(sourceDir);
  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.error(`Error reading ${CONFIG_FILENAME}: ${e.message}`);
  }
  return {};
}

/**
 * Save the ursa config to .ursa.json
 * @param {string} sourceDir - The source directory path
 * @param {object} config - The config object to save
 */
export function saveUrsaConfig(sourceDir, config) {
  const configPath = getConfigPath(sourceDir);
  try {
    const content = JSON.stringify(config, null, 2);
    writeFileSync(configPath, content, 'utf8');
  } catch (e) {
    console.error(`Error writing ${CONFIG_FILENAME}: ${e.message}`);
  }
}

/**
 * Get the current build ID and increment it for the next build
 * @param {string} sourceDir - The source directory path
 * @returns {number} The current build ID (starting from 1)
 */
export function getAndIncrementBuildId(sourceDir) {
  const config = loadUrsaConfig(sourceDir);
  const currentBuildId = config.buildId || 0;
  const newBuildId = currentBuildId + 1;
  
  config.buildId = newBuildId;
  saveUrsaConfig(sourceDir, config);
  
  return newBuildId;
}
