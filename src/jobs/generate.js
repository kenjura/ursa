import { recurse } from "../helper/recursive-readdir.js";

import { copyFile, mkdir, readdir, readFile, stat } from "fs/promises";
import { getAutomenu } from "../helper/automenu.js";
import { filterAsync } from "../helper/filterAsync.js";
import { isDirectory } from "../helper/isDirectory.js";
import {
  extractMetadata,
  extractRawMetadata,
} from "../helper/metadataExtractor.js";
import { renderFile } from "../helper/fileRenderer.js";
import { findStyleCss } from "../helper/findStyleCss.js";
import { copy as copyDir, emptyDir, outputFile } from "fs-extra";
import { basename, dirname, extname, join, parse, resolve } from "path";
import { URL } from "url";
import o2x from "object-to-xml";
import { existsSync } from "fs";
import { fileExists } from "../helper/fileExists.js";

import { createWhitelistFilter } from "../helper/whitelistFilter.js";

const DEFAULT_TEMPLATE_NAME =
  process.env.DEFAULT_TEMPLATE_NAME ?? "default-template";

export async function generate({
  _source = join(process.cwd(), "."),
  _meta = join(process.cwd(), "meta"),
  _output = join(process.cwd(), "build"),
  _whitelist = null,
} = {}) {
  console.log({ _source, _meta, _output, _whitelist });
  const source = resolve(_source) + "/";
  const meta = resolve(_meta);
  const output = resolve(_output) + "/";
  console.log({ source, meta, output });

  const allSourceFilenamesUnfiltered = await recurse(source, [() => false]);
  
  // Apply include filter (existing functionality)
  const includeFilter = process.env.INCLUDE_FILTER
    ? (fileName) => fileName.match(process.env.INCLUDE_FILTER)
    : Boolean;
  let allSourceFilenames = allSourceFilenamesUnfiltered.filter(includeFilter);
  
  // Apply whitelist filter if specified
  if (_whitelist) {
    const whitelistFilter = await createWhitelistFilter(_whitelist, source);
    allSourceFilenames = allSourceFilenames.filter(whitelistFilter);
    console.log(`Whitelist applied: ${allSourceFilenames.length} files after filtering`);
  }
  // console.log(allSourceFilenames);

  // if (source.substr(-1) !== "/") source += "/"; // warning: might not work in windows
  // if (output.substr(-1) !== "/") output += "/";

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
  const allSourceFilenamesThatAreDirectories = await filterAsync(
    allSourceFilenames,
    (filename) => isDirectory(filename)
  );

  // process individual articles
  const jsonCache = new Map();
  await Promise.all(
    allSourceFilenamesThatAreArticles.map(async (file) => {
      console.log(`processing article ${file}`);

      const rawBody = await readFile(file, "utf8");
      const type = parse(file).ext;
      const meta = extractMetadata(rawBody);
      const rawMeta = extractRawMetadata(rawBody);
      const bodyLessMeta = rawMeta ? rawBody.replace(rawMeta, "") : rawBody;
      const transformedMetadata = await getTransformedMetadata(
        dirname(file),
        meta
      );
      const ext = extname(file);
      const base = basename(file, ext);
      const dir = addTrailingSlash(dirname(file)).replace(source, "");

      const body = renderFile({
        fileContents: rawBody,
        type,
        dirname: dir,
        basename: base,
      });

      // Find nearest style.css or _style.css up the tree
      let embeddedStyle = "";
      try {
        const css = await findStyleCss(resolve(_source, dir));
        if (css) {
          embeddedStyle = css;
        }
      } catch (e) {
        // ignore
        console.error(e);
      }

      const requestedTemplateName = meta && meta.template;
      const template =
        templates[requestedTemplateName] || templates[DEFAULT_TEMPLATE_NAME];

      // Insert embeddedStyle just before </head> if present, else at top
      let finalHtml = template
        .replace("${menu}", menu)
        .replace("${meta}", JSON.stringify(meta))
        .replace("${transformedMetadata}", transformedMetadata)
        .replace("${body}", body)
        .replace("${embeddedStyle}", embeddedStyle);

      const outputFilename = file
        .replace(source, output)
        .replace(parse(file).ext, ".html");

      console.log(`writing article to ${outputFilename}`);

      await outputFile(outputFilename, finalHtml);

      // json

      const jsonOutputFilename = outputFilename.replace(".html", ".json");
      const jsonObject = {
        name: base,
        contents: rawBody,
        // bodyLessMeta: bodyLessMeta,
        bodyHtml: body,
        metadata: meta,
        transformedMetadata,
        // html: finalHtml,
      };
      jsonCache.set(file, jsonObject);
      const json = JSON.stringify(jsonObject);
      console.log(`writing article to ${jsonOutputFilename}`);
      await outputFile(jsonOutputFilename, json);

      // xml

      const xmlOutputFilename = outputFilename.replace(".html", ".xml");
      const xml = `<article>${o2x(jsonObject)}</article>`;
      await outputFile(xmlOutputFilename, xml);
    })
  );

  console.log(jsonCache.keys());
  // process directory indices
  await Promise.all(
    allSourceFilenamesThatAreDirectories.map(async (dir) => {
      console.log(`processing directory ${dir}`);

      const pathsInThisDirectory = allSourceFilenames.filter((filename) =>
        filename.match(new RegExp(`${dir}.+`))
      );

      const jsonObjects = pathsInThisDirectory
        .map((path) => {
          const object = jsonCache.get(path);
          return typeof object === "object" ? object : null;
        })
        .filter((a) => a);

      const json = JSON.stringify(jsonObjects);

      const outputFilename = dir.replace(source, output) + ".json";

      console.log(`writing directory index to ${outputFilename}`);
      await outputFile(outputFilename, json);

      // html
      const htmlOutputFilename = dir.replace(source, output) + ".html";
      const indexAlreadyExists = fileExists(htmlOutputFilename);
      if (!indexAlreadyExists) {
        const template = templates["default-template"]; // TODO: figure out a way to specify template for a directory index
        const indexHtml = `<ul>${pathsInThisDirectory
          .map((path) => {
            const partialPath = path
              .replace(source, "")
              .replace(parse(path).ext, ".html");
            const name = basename(path, parse(path).ext);
            return `<li><a href="${partialPath}">${name}</a></li>`;
          })
          .join("")}</ul>`;
        const finalHtml = template
          .replace("${menu}", menu)
          .replace("${body}", indexHtml);
        console.log(`writing directory index to ${htmlOutputFilename}`);
        await outputFile(htmlOutputFilename, finalHtml);
      }
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

      await mkdir(dirname(outputFilename), { recursive: true });
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

async function getTransformedMetadata(dirname, metadata) {
  // console.log("getTransformedMetadata > ", { dirname });
  // custom transform? else, use default
  const customTransformFnFilename = join(dirname, "transformMetadata.js");
  let transformFn = defaultTransformFn;
  try {
    const customTransformFn = (await import(customTransformFnFilename)).default;
    if (typeof customTransformFn === "function")
      transformFn = customTransformFn;
  } catch (e) {
    // console.error(e);
  }
  try {
    return transformFn(metadata);
  } catch (e) {
    return "error transforming metadata";
  }

  function defaultTransformFn(metadata) {
    return "default transform";
  }
}

function addTrailingSlash(somePath) {
  if (typeof somePath !== "string") return somePath;
  if (somePath.length < 1) return somePath;
  if (somePath[somePath.length - 1] == "/") return somePath;
  return `${somePath}/`;
}
