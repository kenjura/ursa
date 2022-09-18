import watch from 'node-watch';

import { generate } from './jobs/generate.js';
import { join, resolve } from 'path';

const source = process.env.SOURCE ?? join(process.cwd(), 'source');
const build = process.env.BUILD ?? join(process.cwd(), 'build');

serve(build);

generate({ source });

watch(resolve(process.cwd()), { recursive:true, filter }, async (evt, name) => {
    console.log('files changed! generating output');
    await generate({ source });

});

/**
 * we're only interested in meta (and maybe, in the future, source)
 * for src changes, we need the node process to restart
 */
function filter(filename, skip) {
    console.log('testing ',filename);
    if (/\/build/.test(filename)) return skip;
    if (/\/source/.test(filename)) return skip;
    if (/\/node_modules/.test(filename)) return skip;
    if (/\/src/.test(filename)) return skip;
    if (/\/meta/.test(filename)) return true;
    return false;
}

import fs from 'fs';
import http from 'http';
import { Server } from 'node-static';

function serve(root) {
    const server = new Server(root, { defaultExtension:'html'});

    http.createServer(function (req, res) {
        console.log(`Serving ${req.url}`);
        server.serve(req, res, (err, result) => {
            if (err) {
                console.error('file server encountered an error: ',err);
                res.writeHead(err.status, err.headers);
                res.end();
            }
        });
    }).listen(8080);
}