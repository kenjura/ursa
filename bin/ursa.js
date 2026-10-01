#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { generate } from '../src/jobs/generate.js';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { stagePromotedChangelog, registerCleanupOnExit } from '../src/helper/promoteChangelog.js';
import { instantiateTemplate } from '../src/helper/documentTemplates.js';
import {
  BUILD_CONFIG_KEYS,
  isBuildConfigPath,
  loadBuildConfig,
  mergeBuildOptions,
} from '../src/helper/buildConfig.js';

// Get the directory where ursa is installed
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_META = join(__dirname, '..', 'meta');

/**
 * Options for `generate`/`serve` from the positional argument (a docroot or a
 * build config file) and the flags. Flags typed on the command line override
 * the config file, which overrides the defaults. See docs/BUILD_CONFIG.md.
 */
function resolveCommandOptions(argv, command) {
  let fileOptions = {};
  let cliSource = argv.source;
  if (isBuildConfigPath(argv.source)) {
    console.log(`Using build config: ${resolve(argv.source)}`);
    fileOptions = loadBuildConfig(argv.source, { command });
    cliSource = undefined;
  }
  const cli = { source: cliSource };
  for (const key of Object.keys(BUILD_CONFIG_KEYS)) {
    if (key !== 'source' && argv[key] !== undefined) cli[key] = argv[key];
  }
  const options = mergeBuildOptions(fileOptions, cli);
  if (!options.source) {
    throw new Error(`No source directory: pass one, or set "source" in the build config`);
  }
  options.meta = options.meta || PACKAGE_META;
  return options;
}

const sourcePositional = (yargs) =>
  yargs.positional('source', {
    describe: 'Source directory containing markdown/wikitext files, or a build config file (.json/.yml)',
    type: 'string',
    demandOption: true
  });

/** Options shared by generate and serve that have no command-line flag of their own. */
const buildOnlyOptions = (yargs) =>
  yargs
    .option('directory-depth', {
      describe: 'Levels of nested directory objects in each _directory.json (default: unlimited)',
      type: 'string'
    })
    .option('directory-json', {
      describe: 'Write _directory.json in every folder (use --no-directory-json to disable)',
      type: 'boolean'
    });

yargs(hideBin(process.argv))
  .command(
    ['generate <source>', 'build <source>', '$0 <source>'],
    'Generate a static site from source files (alias: build)',
    (yargs) => {
      return buildOnlyOptions(sourcePositional(yargs))
        .option('meta', {
          alias: 'm',
          describe: 'Meta directory containing templates and styles (defaults to ursa package meta)',
          type: 'string'
        })
        .option('output', {
          alias: 'o', 
          describe: 'Output directory for generated site (default: output)',
          type: 'string'
        })
        .option('whitelist', {
          alias: 'w',
          describe: 'Path to whitelist file containing patterns for files to include',
          type: 'string'
        })
        .option('exclude', {
          alias: 'x',
          describe: 'Folders to exclude: comma-separated paths relative to source, or path to file with one folder per line',
          type: 'string'
        })
        .option('clean', {
          alias: 'c',
          describe: 'Ignore cached hashes and regenerate all files',
          type: 'boolean'
        })
        .option('promote-changelog', {
          describe: 'Path to a markdown file to render at the output root (sibling of index.html)',
          type: 'string'
        })
        .option('json-only', {
          alias: 'j',
          describe: 'Emit only the .json data files — no HTML, XML, images, static assets, search indices or menu data',
          type: 'boolean'
        })
        .option('explain', {
          describe: 'Log, for every output that was rebuilt, the input that changed',
          type: 'boolean'
        });
    },
    async (argv) => {
      let options;
      try {
        options = resolveCommandOptions(argv, 'generate');
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      const { source, meta, output, clean, explain } = options;
      const whitelist = options.whitelist || null;
      const exclude = options.exclude || null;
      const promoteChangelog = options['promote-changelog'] || null;
      const jsonOnly = options['json-only'];

      console.log(`Generating site from ${source} to ${output} using meta from ${meta}`);
      if (whitelist) {
        console.log(`Using whitelist: ${whitelist}`);
      }
      if (exclude) {
        console.log(`Excluding: ${exclude}`);
      }
      if (clean) {
        console.log(`Clean build: ignoring cached hashes`);
      }
      if (jsonOnly) {
        console.log(`JSON-only build: emitting .json data files only`);
      }

      let promoted = { stagedFile: null, cleanup: async () => {} };
      try {
        promoted = await stagePromotedChangelog({ changelogPath: promoteChangelog, sourceDir: source });
        await generate({
          _source: source,
          _meta: meta,
          _output: output,
          _whitelist: whitelist,
          _exclude: exclude,
          _clean: clean,
          _jsonOnly: jsonOnly,
          _explain: explain,
          _directoryJson: options['directory-json'],
          _directoryDepth: options['directory-depth'],
          _concurrency: options.concurrency
        });
        console.log('Site generation completed successfully!');
      } catch (error) {
        console.error('Error generating site:', error.message);
        process.exit(1);
      } finally {
        await promoted.cleanup();
      }
    }
  )
  .command(
    'serve <source>',
    'Generate site and serve with live reloading',
    (yargs) => {
      return buildOnlyOptions(sourcePositional(yargs))
        .option('meta', {
          alias: 'm',
          describe: 'Meta directory containing templates and styles (defaults to ursa package meta)',
          type: 'string'
        })
        .option('output', {
          alias: 'o', 
          describe: 'Output directory for generated site (default: output)',
          type: 'string'
        })
        .option('port', {
          alias: 'p',
          describe: 'Port to serve on (default: 8080)',
          type: 'number'
        })
        .option('strict-port', {
          describe: 'Fail if the port is taken instead of falling back to another',
          type: 'boolean'
        })
        .option('whitelist', {
          alias: 'w',
          describe: 'Path to whitelist file containing patterns for files to include',
          type: 'string'
        })
        .option('exclude', {
          alias: 'x',
          describe: 'Folders to exclude: comma-separated paths relative to source, or path to file with one folder per line',
          type: 'string'
        })
        .option('clean', {
          alias: 'c',
          describe: 'Ignore cached hashes and regenerate all files',
          type: 'boolean'
        })
        .option('promote-changelog', {
          describe: 'Path to a markdown file to render at the output root (sibling of index.html)',
          type: 'string'
        })
        .option('explain', {
          describe: 'Log, for every output that was rebuilt, the input that changed',
          type: 'boolean'
        });
    },
    async (argv) => {
      let options;
      try {
        options = resolveCommandOptions(argv, 'serve');
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      const { source, meta, output, port, clean } = options;
      const whitelist = options.whitelist || null;
      const exclude = options.exclude || null;
      const promoteChangelog = options['promote-changelog'] || null;
      
      console.log(`Starting development server...`);
      console.log(`Source: ${source}`);
      console.log(`Meta: ${meta}`);
      console.log(`Output: ${output}`);
      console.log(`Port: ${port}`);
      if (whitelist) {
        console.log(`Using whitelist: ${whitelist}`);
      }
      if (exclude) {
        console.log(`Excluding: ${exclude}`);
      }
      
      try {
        const promoted = await stagePromotedChangelog({ changelogPath: promoteChangelog, sourceDir: source });
        registerCleanupOnExit(promoted.cleanup);
        const { serve } = await import('../src/serve.js');
        await serve({
          _source: source,
          _meta: meta,
          _output: output,
          port: port,
          _whitelist: whitelist,
          _exclude: exclude,
          _clean: clean,
          _explain: options.explain,
          strictPort: options['strict-port'],
          _directoryJson: options['directory-json'],
          _directoryDepth: options['directory-depth'],
          _concurrency: options.concurrency
        });
      } catch (error) {
        console.error('Error starting development server:', error.message);
        console.error(error);
        process.exit(1);
      }
    }
  )
  .command(
    'dev <source>',
    'Start dev mode - serves documents on-demand without pre-processing (fast startup)',
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
          describe: 'Output directory for generated files',
          type: 'string'
        })
        .option('port', {
          alias: 'p',
          default: 8080,
          describe: 'Port to serve on',
          type: 'number'
        });
    },
    async (argv) => {
      const source = resolve(argv.source);
      const meta = argv.meta ? resolve(argv.meta) : PACKAGE_META;
      const output = resolve(argv.output);
      const port = argv.port;
      
      try {
        const { dev } = await import('../src/dev.js');
        await dev({
          _source: source,
          _meta: meta,
          _output: output,
          port: port
        });
      } catch (error) {
        console.error('Error starting dev mode:', error.message);
        console.error(error);
        process.exit(1);
      }
    }
  )
  .command(
    'template <source> <templatePath> <destination>',
    'Create a new document from a document template',
    (yargs) => {
      return yargs
        .positional('source', {
          describe: 'Source directory (docroot) of the Ursa site',
          type: 'string',
          demandOption: true
        })
        .positional('templatePath', {
          describe: 'Path to the template file (relative to source, e.g. _templates/city.md)',
          type: 'string',
          demandOption: true
        })
        .positional('destination', {
          describe: 'Path for the new document (relative to source, e.g. places/springfield.md)',
          type: 'string',
          demandOption: true
        });
    },
    async (argv) => {
      const source = resolve(argv.source);
      const templateAbsPath = resolve(source, argv.templatePath);
      const destAbsPath = resolve(source, argv.destination);

      try {
        const { templateRelPath, destRelPath } = await instantiateTemplate(
          templateAbsPath,
          destAbsPath,
          source
        );
        console.log(`✅ Created ${destRelPath} from template ${templateRelPath}`);
      } catch (error) {
        console.error(`Error creating template instance: ${error.message}`);
        process.exit(1);
      }
    }
  )
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .parse();
