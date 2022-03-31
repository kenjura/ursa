import yargs from 'yargs';

import { describeGenerate, generate } from './commands/generate.js';
import { hideBin } from 'yargs/helpers';

yargs(hideBin(process.argv))
    .command(['$0', 'generate'], 'generates a static site', describeGenerate, generate);

