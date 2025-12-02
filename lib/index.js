import { generate } from "../src/jobs/generate.js";
import { serve } from "../src/serve.js";

export default function generateSite({ source, meta, output, whitelist }) {
  if (!source) throw new Error("source is required");
  if (!meta) throw new Error("meta is required");
  if (!output) throw new Error("output is required");

  return generate({ _source: source, _meta: meta, _output: output, _whitelist: whitelist });
}

// Also export the generate and serve functions directly for more flexibility
export { generate } from "../src/jobs/generate.js";
export { serve } from "../src/serve.js";
