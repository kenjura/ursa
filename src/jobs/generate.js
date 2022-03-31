import recurse from 'recursive-readdir';

import { readdir, readFile } from 'fs/promises';
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

    const fileList = await recurse(source);
    // console.log(fileList);

    const templates = await getTemplates(meta); // todo: error if no default template
    console.log({templates});

    Promise.all(fileList.map(async file => {
        console.log(`processing file ${file}`);

        const requestedTemplateName = null; // todo: read the file to figure out which template. For now, assuming null, i.e. default
        const template = templates[requestedTemplateName] || templates['default-template']; 
        const rawBody = await readFile(file, 'utf8');
        const type = parse(file).ext;
        const body = renderFile({ fileContents:rawBody, type });
        const menu = 'MENU TBD'; // todo: menu
        
        const finalHtml = template
            .replace('${menu}', menu)
            .replace('${body}', body);

        const outputFilename = file
            .replace(source, output)
            .replace(parse(file).ext, '.html');

        console.log(`writing to ${outputFilename}`);

        await outputFile(outputFilename, finalHtml);
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