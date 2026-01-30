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

/**
 * Check if a markdown file is "metadata-only" - has frontmatter but no meaningful content
 * Such files are used only to provide metadata (like menu-label) for folders
 * @param {string} rawBody - The raw file content
 * @returns {boolean} True if the file has only frontmatter and no other content
 */
export function isMetadataOnly(rawBody) {
  if (!rawBody) return false;
  
  const frontMatter = matchAllFrontMatter(rawBody);
  if (!frontMatter) return false;
  
  // Get content after frontmatter
  const contentAfter = rawBody.slice(frontMatter.length).trim();
  
  // Consider the file metadata-only if there's no content after frontmatter
  return contentAfter.length === 0;
}

/**
 * Extract auto-index configuration from metadata
 * @param {object} metadata - Parsed frontmatter metadata
 * @returns {{enabled: boolean, depth: number, position: 'top'|'bottom'}} Auto-index configuration
 */
export function getAutoIndexConfig(metadata) {
  return {
    enabled: metadata?.['generate-auto-index'] === true,
    depth: typeof metadata?.['auto-index-depth'] === 'number' ? metadata['auto-index-depth'] : 1,
    position: metadata?.['auto-index-position'] === 'bottom' ? 'bottom' : 'top'
  };
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
