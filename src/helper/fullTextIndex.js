// Full-text indexing for search
// Creates an inverted index mapping words to document paths

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// Common English stopwords to exclude from indexing
// These are words that appear so frequently they don't help with search relevance
const STOPWORDS = new Set([
  // Articles
  'a', 'an', 'the',
  // Pronouns
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
  'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers',
  'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  // Prepositions
  'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up',
  'down', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'of', 'as', 'until', 'while', 'upon', 'across', 'along', 'around', 'behind',
  'beside', 'besides', 'beyond', 'inside', 'outside', 'throughout', 'toward',
  'towards', 'underneath', 'within', 'without',
  // Conjunctions
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'not',
  'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also', 'now',
  // Common verbs
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'having', 'do', 'does', 'did', 'doing', 'would', 'should', 'could', 'ought',
  'might', 'must', 'shall', 'will', 'can', 'may', 'need', 'dare', 'used',
  'get', 'got', 'getting', 'let', 'make', 'made', 'making', 'go', 'going', 'gone',
  'come', 'came', 'coming', 'take', 'took', 'taken', 'taking', 'give', 'gave',
  'given', 'giving', 'see', 'saw', 'seen', 'seeing', 'know', 'knew', 'known',
  'knowing', 'think', 'thought', 'thinking', 'say', 'said', 'saying',
  // Common adverbs
  'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'any',
  'some', 'no', 'most', 'more', 'other', 'such', 'much', 'many', 'few', 'little',
  'less', 'least', 'enough', 'several', 'another', 'still', 'already', 'ever',
  'never', 'always', 'often', 'sometimes', 'usually', 'really', 'quite', 'rather',
  'almost', 'even', 'especially', 'probably', 'perhaps', 'maybe', 'actually',
  'certainly', 'definitely', 'possibly', 'simply', 'basically', 'generally',
  // Common adjectives
  'new', 'old', 'good', 'bad', 'great', 'high', 'low', 'big', 'small', 'large',
  'long', 'short', 'first', 'last', 'next', 'early', 'late', 'full', 'empty',
  'right', 'wrong', 'true', 'false', 'real', 'main', 'different', 'same',
  'important', 'possible', 'able', 'available', 'certain', 'likely', 'sure',
  // Numbers (words)
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'hundred', 'thousand', 'million', 'billion',
  // Other common words
  'like', 'well', 'back', 'way', 'time', 'year', 'day', 'thing', 'man', 'woman',
  'child', 'world', 'life', 'hand', 'part', 'place', 'case', 'week', 'company',
  'system', 'program', 'question', 'work', 'government', 'number', 'night',
  'point', 'home', 'water', 'room', 'mother', 'area', 'money', 'story', 'fact',
  'month', 'lot', 'study', 'book', 'eye', 'job', 'word', 'business', 'issue',
  'side', 'kind', 'head', 'house', 'service', 'friend', 'father', 'power',
  'hour', 'game', 'line', 'end', 'member', 'law', 'car', 'city', 'community',
  'name', 'president', 'team', 'minute', 'idea', 'kid', 'body', 'information',
  'nothing', 'ago', 'lead', 'social', 'whether', 'called', 'set',
  // HTML/Markdown artifacts that might slip through
  'nbsp', 'amp', 'lt', 'gt', 'quot', 'http', 'https', 'www', 'com', 'org', 'net',
  'html', 'css', 'js', 'img', 'src', 'href', 'class', 'id', 'div', 'span', 'br',
]);

// Minimum word length to index
const MIN_WORD_LENGTH = 2;

// Maximum word length to index (avoid garbage)
const MAX_WORD_LENGTH = 50;

/**
 * Extract words from text content
 * @param {string} text - The text to extract words from
 * @returns {string[]} - Array of normalized words
 */
function extractWords(text) {
  if (!text) return [];
  
  // Convert to lowercase and extract words
  const words = text
    .toLowerCase()
    // Remove markdown formatting
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](link) -> text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // ![alt](img) -> remove
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]+`/g, '') // Remove inline code
    .replace(/^#+\s+/gm, '') // Remove heading markers
    .replace(/[*_~]+/g, '') // Remove emphasis markers
    .replace(/\|/g, ' ') // Table separators
    // Remove HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Remove special characters, keep letters, numbers, hyphens
    .replace(/[^a-z0-9\s-]/g, ' ')
    // Split on whitespace and hyphens
    .split(/[\s-]+/)
    // Filter
    .filter(word => {
      if (!word) return false;
      if (word.length < MIN_WORD_LENGTH) return false;
      if (word.length > MAX_WORD_LENGTH) return false;
      if (STOPWORDS.has(word)) return false;
      // Skip pure numbers
      if (/^\d+$/.test(word)) return false;
      return true;
    });
  
  return words;
}

/**
 * Build a full-text index from documents
 * @param {Array<{path: string, title: string, content: string}>} documents - Documents to index
 * @returns {Object} - Inverted index: { word: [{ path, score }] }
 */
export function buildFullTextIndex(documents) {
  const index = {};
  
  for (const doc of documents) {
    if (!doc.content && !doc.title) continue;
    
    // Extract words from title (higher weight) and content
    const titleWords = extractWords(doc.title);
    const contentWords = extractWords(doc.content);
    
    // Count word frequencies in this document
    const wordCounts = {};
    
    // Title words get weight of 10
    for (const word of titleWords) {
      wordCounts[word] = (wordCounts[word] || 0) + 10;
    }
    
    // Content words get weight of 1
    for (const word of contentWords) {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    }
    
    // Add to inverted index
    for (const [word, count] of Object.entries(wordCounts)) {
      if (!index[word]) {
        index[word] = [];
      }
      index[word].push({
        p: doc.path, // path (shortened key for smaller JSON)
        s: count,    // score (shortened key)
      });
    }
  }
  
  // Sort each word's document list by score (descending)
  for (const word of Object.keys(index)) {
    index[word].sort((a, b) => b.s - a.s);
    // Limit to top 100 documents per word to keep index size reasonable
    if (index[word].length > 100) {
      index[word] = index[word].slice(0, 100);
    }
  }
  
  return index;
}

/**
 * Get the path to the full-text index cache file
 * @param {string} sourceRoot - Source directory root
 * @returns {string} - Path to cache file
 */
function getIndexCachePath(sourceRoot) {
  return join(sourceRoot, '.ursa', 'fulltext-index.json');
}

/**
 * Load full-text index from cache
 * @param {string} sourceRoot - Source directory root
 * @returns {Object|null} - Cached index or null if not found
 */
export function loadIndexCache(sourceRoot) {
  const cachePath = getIndexCachePath(sourceRoot);
  if (existsSync(cachePath)) {
    try {
      const data = readFileSync(cachePath, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to load full-text index cache:', e.message);
    }
  }
  return null;
}

/**
 * Save full-text index to cache
 * @param {string} sourceRoot - Source directory root
 * @param {Object} index - The index to save
 */
export function saveIndexCache(sourceRoot, index) {
  const cachePath = getIndexCachePath(sourceRoot);
  const cacheDir = dirname(cachePath);
  
  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    writeFileSync(cachePath, JSON.stringify(index));
  } catch (e) {
    console.error('Failed to save full-text index cache:', e.message);
  }
}

/**
 * Build incremental full-text index
 * Only re-indexes changed documents, merges with cached index
 * @param {Array<{path: string, title: string, content: string}>} documents - All documents
 * @param {Set<string>} changedPaths - Paths of documents that changed
 * @param {string} sourceRoot - Source directory root
 * @returns {Object} - Updated full-text index
 */
export function buildIncrementalIndex(documents, changedPaths, sourceRoot) {
  // Load existing cache
  let existingIndex = loadIndexCache(sourceRoot) || {};
  
  // If no changed paths specified, rebuild everything
  if (!changedPaths || changedPaths.size === 0) {
    const newIndex = buildFullTextIndex(documents);
    saveIndexCache(sourceRoot, newIndex);
    return newIndex;
  }
  
  // Remove old entries for changed documents
  for (const word of Object.keys(existingIndex)) {
    existingIndex[word] = existingIndex[word].filter(
      entry => !changedPaths.has(entry.p)
    );
    // Remove empty word entries
    if (existingIndex[word].length === 0) {
      delete existingIndex[word];
    }
  }
  
  // Build index for only the changed documents
  const changedDocs = documents.filter(doc => changedPaths.has(doc.path));
  const changedIndex = buildFullTextIndex(changedDocs);
  
  // Merge changed index into existing
  for (const [word, entries] of Object.entries(changedIndex)) {
    if (!existingIndex[word]) {
      existingIndex[word] = entries;
    } else {
      existingIndex[word] = [...existingIndex[word], ...entries];
      // Re-sort and limit
      existingIndex[word].sort((a, b) => b.s - a.s);
      if (existingIndex[word].length > 100) {
        existingIndex[word] = existingIndex[word].slice(0, 100);
      }
    }
  }
  
  saveIndexCache(sourceRoot, existingIndex);
  return existingIndex;
}

/**
 * Check if the stopwords set contains a word
 * @param {string} word - Word to check
 * @returns {boolean} - True if it's a stopword
 */
export function isStopword(word) {
  return STOPWORDS.has(word.toLowerCase());
}

/**
 * Get all stopwords
 * @returns {Set<string>} - Set of stopwords
 */
export function getStopwords() {
  return STOPWORDS;
}
