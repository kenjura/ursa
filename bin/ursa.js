#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { generate } from '../src/jobs/generate.js';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Get the directory where ursa is installed
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_META = join(__dirname, '..', 'meta');

yargs(hideBin(process.argv))
  .command(
    'generate <source>',
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
          describe: 'Meta directory containing templates and styles (defaults to ursa package meta)',
          type: 'string'
        })
        .option('output', {
          alias: 'o', 
          default: 'output',
          describe: 'Output directory for generated site',
          type: 'string'
        })
        .option('whitelist', {
          alias: 'w',
          describe: 'Path to whitelist file containing patterns for files to include',
          type: 'string'
        })
        .option('clean', {
          alias: 'c',
          describe: 'Ignore cached hashes and regenerate all files',
          type: 'boolean',
          default: false
        });
    },
    async (argv) => {
      const source = resolve(argv.source);
      const meta = argv.meta ? resolve(argv.meta) : PACKAGE_META;
      const output = resolve(argv.output);
      const whitelist = argv.whitelist ? resolve(argv.whitelist) : null;
      const clean = argv.clean;
      
      console.log(`Generating site from ${source} to ${output} using meta from ${meta}`);
      if (whitelist) {
        console.log(`Using whitelist: ${whitelist}`);
      }
      if (clean) {
        console.log(`Clean build: ignoring cached hashes`);
      }
      
      try {
        await generate({
          _source: source,
          _meta: meta,
          _output: output,
          _whitelist: whitelist,
          _clean: clean
        });
        console.log('Site generation completed successfully!');
      } catch (error) {
        console.error('Error generating site:', error.message);
        process.exit(1);
      }
    }
  )
  .command(
    'serve <source>',
    'Generate site and serve with live reloading',
    (yargs) => {
      return yargs
        .positional('source', {
          describe: 'Source directory containing markdown/wikitext files',
          type: 'string',
          demandOption: true
        })
        .option('meta', {
          alias: 'm',
          describe: 'Meta directory containing templates and styles (defaults to ursa package meta)',
          type: 'string'
        })
        .option('output', {
          alias: 'o', 
          default: 'output',
          describe: 'Output directory for generated site',
          type: 'string'
        })
        .option('port', {
          alias: 'p',
          default: 8080,
          describe: 'Port to serve on',
          type: 'number'
        })
        .option('whitelist', {
          alias: 'w',
          describe: 'Path to whitelist file containing patterns for files to include',
          type: 'string'
        })
        .option('clean', {
          alias: 'c',
          describe: 'Ignore cached hashes and regenerate all files',
          type: 'boolean',
          default: false
        });
    },
    async (argv) => {
      const source = resolve(argv.source);
      const meta = argv.meta ? resolve(argv.meta) : PACKAGE_META;
      const output = resolve(argv.output);
      const port = argv.port;
      const whitelist = argv.whitelist ? resolve(argv.whitelist) : null;
      const clean = argv.clean;
      
      console.log(`Starting development server...`);
      console.log(`Source: ${source}`);
      console.log(`Meta: ${meta}`);
      console.log(`Output: ${output}`);
      console.log(`Port: ${port}`);
      if (whitelist) {
        console.log(`Using whitelist: ${whitelist}`);
      }
      
      try {
        const { serve } = await import('../src/serve.js');
        await serve({
          _source: source,
          _meta: meta,
          _output: output,
          port: port,
          _whitelist: whitelist,
          _clean: clean
        });
      } catch (error) {
        console.error('Error starting development server:', error.message);
        console.error(error);
        process.exit(1);
      }
    }
  )
  .command(
    '$0 <source>',
    'Generate a static site from source files (default command)',
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
        })
        .option('whitelist', {
          alias: 'w',
          describe: 'Path to whitelist file containing patterns for files to include',
          type: 'string'
        });
    },
    async (argv) => {
      const source = resolve(argv.source);
      const meta = resolve(argv.meta);
      const output = resolve(argv.output);
      const whitelist = argv.whitelist ? resolve(argv.whitelist) : null;
      
      console.log(`Generating site from ${source} to ${output} using meta from ${meta}`);
      if (whitelist) {
        console.log(`Using whitelist: ${whitelist}`);
      }
      
      try {
        await generate({
          _source: source,
          _meta: meta,
          _output: output,
          _whitelist: whitelist
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
