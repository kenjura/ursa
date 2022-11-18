import { parse } from "yaml";

export function extractMetadata(rawBody) {
  const frontMatter = matchFrontMatter(rawBody);
  if (frontMatter === null) return null;

  const parsedYml = parse(frontMatter);
  return parsedYml;
}

function matchFrontMatter(str) {
  const match = str.match(/---(.*?)---/s);
  if (Array.isArray(match) && match.length > 1) {
    return match[1];
  } else return null;
}
