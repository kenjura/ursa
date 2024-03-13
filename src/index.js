import { generate } from "./jobs/generate.js";

import { join, resolve } from "path";

const _source = process.env.SOURCE ?? join(process.cwd(), "source");
const _meta = process.env.META ?? join(process.cwd(), "meta");
const _output = process.env.OUTPUT ?? join(process.cwd(), "output");

generate({ _source, _meta, _output });
