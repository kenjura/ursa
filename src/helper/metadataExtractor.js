import { parse } from "yaml";

export function extractMetadata(rawBody) {
  const frontMatter = matchFrontMatter(rawBody);
  if (frontMatter === null) return null;
  
  // Don't try to parse empty or whitespace-only content
  if (frontMatter.trim().length === 0) return null;

  const parsedYml = parse(frontMatter);
  return parsedYml;
}

export function extractRawMetadata(rawBody) {
  const frontMatter = matchAllFrontMatter(rawBody);
  if (frontMatter === null) return null;

  return frontMatter;
}

function matchFrontMatter(str) {
  // Only match YAML front matter at the start of the file
  // Must have --- at line start, content, then closing --- also at line start
  // The (?=\n|$) ensures the closing --- is followed by newline or end of string
  const match = str.match(/^---\n([\s\S]+?)\n---(?=\n|$)/);
  if (!match || match.length < 2) return null;
  
  // Return null if the captured content is empty or only whitespace
  const content = match[1].trim();
  return content.length > 0 ? match[1] : null;
}

function matchAllFrontMatter(str) {
  // Only match YAML front matter at the start of the file
  const match = str.match(/^---\n([\s\S]+?)\n---(?=\n|$)/);
  if (!match || match.length < 2) return null;
  
  // Check if there's actual content between the delimiters
  const content = match[1].trim();
  return content.length > 0 ? match[0] + '\n' : null;
}
