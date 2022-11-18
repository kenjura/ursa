import express from "express";
import watch from "node-watch";

import { generate } from "./jobs/generate.js";
import { join, resolve } from "path";

const source = resolve(process.env.SOURCE ?? join(process.cwd(), "source"));
const meta = resolve(process.env.META ?? join(process.cwd(), "meta"));
const build = process.env.BUILD ?? join(process.cwd(), "build");

await generate({ source });
console.log("done generating. now serving...");

serve(build);

watch(meta, { recursive: true }, async (evt, name) => {
  console.log("meta files changed! generating output");
  await generate({ source });
});

watch(source, { recursive: true }, async (evt, name) => {
  console.log("source files changed! generating output");
  await generate({ source });
});

/**
 * we're only interested in meta (and maybe, in the future, source)
 * for src changes, we need the node process to restart
 */
function filter(filename, skip) {
  // console.log("testing ", filename);
  if (/\/build/.test(filename)) return skip;
  if (/\/node_modules/.test(filename)) return skip;
  if (/\.git/.test(filename)) return skip;
  if (/\/src/.test(filename)) return skip;
  if (/\/meta/.test(filename)) return true;
  return false;
}

import fs, { stat } from "fs";
import { promises } from "fs";
const { readdir } = promises;
import http from "http";
import { Server } from "node-static";

function serve(root) {
  const app = express();
  const port = process.env.PORT || 8080;

  app.use(
    express.static(build, { extensions: [".html"], index: "index.html" })
  );

  app.get("/", async (req, res) => {
    console.log({ build });
    const dir = await readdir(build);
    const html = dir
      .map((file) => `<li><a href="${file}">${file}</a></li>`)
      .join("");
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  app.listen(port, () => {
    console.log(`server listening on port ${port}`);
  });
}
