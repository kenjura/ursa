import recurse from "recursive-readdir";

import { copyFile, mkdir, readdir, readFile } from "fs/promises";
import { getAutomenu } from "../helper/automenu.js";
import { extractMetadata } from "../helper/metadataExtractor.js";
import { renderFile } from "../helper/fileRenderer.js";
import { copy as copyDir, emptyDir, outputFile } from "fs-extra";
import { join, parse, resolve } from "path";
import { URL } from "url";

export async function generate({
  source = join(process.cwd(), "."),
  meta = join(process.cwd(), "meta"),
  output = join(process.cwd(), "build"),
} = {}) {
  console.log({ source, meta, output });

  const allSourceFilenames = await recurse(source);
  // console.log(allSourceFilenames);

  if (source.substr(-1) !== "/") source += "/"; // warning: might not work in windows
  if (output.substr(-1) !== "/") output += "/";

  const templates = await getTemplates(meta); // todo: error if no default template
  // console.log({ templates });

  const menu = await getMenu(allSourceFilenames, source);

  // clean build directory
  await emptyDir(output);

  // create public folder
  const pub = join(output, "public");
  await mkdir(pub);
  await copyDir(meta, pub);

  // read all articles, process them, copy them to build
  const articleExtensions = /\.(md|txt|yml)/;
  const allSourceFilenamesThatAreArticles = allSourceFilenames.filter(
    (filename) => filename.match(articleExtensions)
  );
  await Promise.all(
    allSourceFilenamesThatAreArticles.map(async (file) => {
      console.log(`processing article ${file}`);

      const rawBody = await readFile(file, "utf8");
      const type = parse(file).ext;
      const meta = extractMetadata(rawBody);
      const body = renderFile({ fileContents: rawBody, type });

      const requestedTemplateName = meta && meta.template;
      const template =
        templates[requestedTemplateName] || templates["default-template"];

      const finalHtml = template
        .replace("${menu}", menu)
        .replace("${meta}", JSON.stringify(meta))
        .replace("${body}", body);

      const outputFilename = file
        .replace(source, output)
        .replace(parse(file).ext, ".html");

      console.log(`writing article to ${outputFilename}`);

      await outputFile(outputFilename, finalHtml);
    })
  );

  // copy all static files (i.e. images)
  const imageExtensions = /\.(jpg|png|gif|webp)/; // todo: handle-extensionless images...ugh
  const allSourceFilenamesThatAreImages = allSourceFilenames.filter(
    (filename) => filename.match(imageExtensions)
  );
  await Promise.all(
    allSourceFilenamesThatAreImages.map(async (file) => {
      console.log(`processing static file ${file}`);

      const outputFilename = file.replace(source, output);

      console.log(`writing static file to ${outputFilename}`);

      return await copyFile(file, outputFilename);
    })
  );
}

/**
 * gets { [templateName:String]:[templateBody:String] }
 * meta: full path to meta files (default-template.html, etc)
 */
async function getTemplates(meta) {
  const allMetaFilenames = await recurse(meta);
  const allHtmlFilenames = allMetaFilenames.filter((filename) =>
    filename.match(/\.html/)
  );

  console.log({ allHtmlFilenames });

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

async function getMenu(allSourceFilenames, source) {
  // todo: handle various incarnations of menu filename

  const rawMenu = await getAutomenu(source);
  const menuBody = renderFile({ fileContents: rawMenu, type: ".md" });
  return menuBody;

  // const allMenus = allSourceFilenames.filter((filename) =>
  //   filename.match(/_?menu\.(html|yml|md|txt)/)
  // );
  // console.log({ allMenus });
  // if (allMenus.length === 0) return "";

  // // pick best menu...TODO: actually apply logic here
  // const bestMenu = allMenus[0];
  // const rawBody = await readFile(bestMenu, "utf8");
  // const type = parse(bestMenu).ext;
  // const menuBody = renderFile({ fileContents: rawBody, type });

  // return menuBody;
}
