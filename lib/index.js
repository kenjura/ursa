import { generate } from "../src/jobs/generate.js";

export default function generateSite({ source, meta, output }) {
  if (!source) throw new Error("source is required");
  if (!meta) throw new Error("meta is required");
  if (!output) throw new Error("output is required");

  generate({ source, meta, output });
}
