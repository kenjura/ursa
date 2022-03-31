import yargs from 'yargs';

export function generate(argv) {
    console.log({argv});
}


export function describeGenerate(yargs) {
    return yargs
        .option('sourceDir', {
            alias: 's',
            default: '.',
            describe: 'path of source files (i.e. markdown, wikitext, yaml, etc)',
        })
        .option('meta', {
            alias: 'm',
            default: '.',
            dsecribe: 'path of meta files (i.e. templates, styles, menu)',
        })
        .option('output', {
            alias: 'o',
            default: 'build',
            dsecribe: 'path of output files (i.e. html)',
        });
}