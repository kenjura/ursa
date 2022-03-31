import { generate } from './jobs/generate.js';

import { resolve } from 'path';

generate({ source:resolve(process.cwd(), 'source') });
