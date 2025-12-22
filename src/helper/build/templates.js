// Template helpers for build
import { readFile } from "fs/promises";
import { parse } from "path";
import { recurse } from "../recursive-readdir.js";

/**
 * Get all templates from meta directory
 * @param {string} meta - Full path to meta files directory
 * @returns {Promise<Object>} Map of templateName to templateBody
 */
export async function getTemplates(meta) {
  const allMetaFilenames = await recurse(meta);
  const allHtmlFilenames = allMetaFilenames.filter((filename) =>
    filename.match(/\.html/)
  );

  let templates = {};
  const templatesArray = await Promise.all(
    allHtmlFilenames.map(async (filename) => {
      const { name } = parse(filename);
      const fileContent = await readFile(filename, "utf8");
      return [name, fileContent];
    })
  );
  templatesArray.forEach(
    ([templateName, templateText]) => (templates[templateName] = templateText)
  );

  return templates;
}
