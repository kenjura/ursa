#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { generate } from '../src/jobs/generate.js';
import { resolve } from 'path';

yargs(hideBin(process.argv))
  .command(
    '$0 <source>',
    'Generate a static site from source files',
    (yargs) => {
      return yargs
        .positional('source', {
          describe: 'Source directory containing markdown/wikitext files',
          type: 'string',
          demandOption: true
        })
        .option('meta', {
          alias: 'm',
          default: 'meta',
          describe: 'Meta directory containing templates and styles',
          type: 'string'
        })
        .option('output', {
          alias: 'o', 
          default: 'output',
          describe: 'Output directory for generated site',
          type: 'string'
        });
    },
    async (argv) => {
      const source = resolve(argv.source);
      const meta = resolve(argv.meta);
      const output = resolve(argv.output);
      
      console.log(`Generating site from ${source} to ${output} using meta from ${meta}`);
      
      try {
        await generate({
          _source: source,
          _meta: meta,
          _output: output
        });
        console.log('Site generation completed successfully!');
      } catch (error) {
        console.error('Error generating site:', error.message);
        process.exit(1);
      }
    }
  )
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .parse();
