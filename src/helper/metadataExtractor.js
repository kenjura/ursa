import { parse } from "yaml";

export function extractMetadata(rawBody) {
  const frontMatter = matchFrontMatter(rawBody);
  if (frontMatter === null) return null;

  const parsedYml = parse(frontMatter);
  return parsedYml;
}

export function extractRawMetadata(rawBody) {
  const frontMatter = matchAllFrontMatter(rawBody);
  if (frontMatter === null) return null;

  return frontMatter;
}

function matchFrontMatter(str) {
  const match = str.match(/---(.*?)---/s);
  if (Array.isArray(match) && match.length > 1) {
    return match[1];
  } else return null;
}

function matchAllFrontMatter(str) {
  const match = str.match(/---(.*?)---\n+/s);
  if (Array.isArray(match) && match.length > 0) {
    return match[0];
  } else return null;
}
