import recurse from 'recursive-readdir';

import { copyFile, readdir, readFile } from 'fs/promises';
import { renderFile } from '../helper/fileRenderer.js';
import { outputFile } from 'fs-extra';
import { parse, resolve } from 'path';
import { URL } from 'url';

export async function generate({ 
    source=resolve(process.cwd(), '.'),
    meta=resolve(process.cwd(), 'meta'),
    output=resolve(process.cwd(), 'build'),
}={}) {
    console.log({source, meta, output});

    const allSourceFilenames = await recurse(source);
    // console.log(allSourceFilenames);

    const templates = await getTemplates(meta); // todo: error if no default template
    console.log({templates});

    const menu = await getMenu(allSourceFilenames);

    // read all articles, process them, copy them to build
    const articleExtensions = /\.(md|txt|yml)/;
    const allSourceFilenamesThatAreArticles = allSourceFilenames.filter(filename => filename.match(articleExtensions));
    Promise.all(allSourceFilenamesThatAreArticles.map(async file => {
        console.log(`processing article ${file}`);

        const requestedTemplateName = null; // todo: read the file to figure out which template. For now, assuming null, i.e. default
        const template = templates[requestedTemplateName] || templates['default-template']; 
        const rawBody = await readFile(file, 'utf8');
        const type = parse(file).ext;
        const body = renderFile({ fileContents:rawBody, type });
        
        const finalHtml = template
            .replace('${menu}', menu)
            .replace('${body}', body);
            
        const outputFilename = file
            .replace(source, output)
            .replace(parse(file).ext, '.html');

        console.log(`writing article to ${outputFilename}`);

        await outputFile(outputFilename, finalHtml);
    }));

    // copy all static files (i.e. images)
    const imageExtensions = /\.(jpg|png|gif|webp)/; // todo: handle-extensionless images...ugh
    const allSourceFilenamesThatAreImages = allSourceFilenames.filter(filename => filename.match(imageExtensions));
    Promise.all(allSourceFilenamesThatAreImages.map(async file => {
        console.log(`processing static file ${file}`);
            
        const outputFilename = file
            .replace(source, output);

        console.log(`writing static file to ${outputFilename}`);

        return await copyFile(file, outputFilename);
    }));

}


/**
 * gets { [templateName:String]:[templateBody:String] }
 * meta: full path to meta files (default-template.html, etc)
 */
async function getTemplates(meta) {
    const allMetaFilenames = await recurse(meta);
    const allHtmlFilenames = allMetaFilenames.filter(filename => filename.match(/\.html/));

    console.log({ allHtmlFilenames });

    let templates = {};
    const templatesArray = await Promise.all(allHtmlFilenames.map(async filename => {
        const { name } = parse(filename);
        const fileContent = await readFile(filename, 'utf8');
        return [ name, fileContent ];
    }));
    templatesArray.forEach(([ templateName, templateText ]) => templates[templateName] = templateText);

    return templates;
}


async function getMenu(allSourceFilenames) {
    // todo: handle various incarnations of menu filename

    const allMenus = allSourceFilenames.filter(filename => filename.match(/_?menu\.(html|yml|md|txt)/));
    console.log({allMenus});
    
    // pick best menu...TODO: actually apply logic here
    const bestMenu = allMenus[0]; 
    const rawBody = await readFile(bestMenu, 'utf8');
    const type = parse(bestMenu).ext;
    const menuBody = renderFile({ fileContents:rawBody, type });

    return menuBody;
}