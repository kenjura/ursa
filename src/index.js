import { generate } from "./jobs/generate.js";

import { join, resolve } from "path";

const source = process.env.SOURCE ?? join(process.cwd(), "source");
const build = process.env.BUILD ?? join(process.cwd(), "build");

generate({ source, build });
