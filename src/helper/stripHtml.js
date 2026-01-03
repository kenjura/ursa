/**
 * Strip HTML tags from a string
 * @param {string} text - The string that may contain HTML
 * @returns {string} The text with HTML tags removed
 */
export function stripHtml(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Remove HTML tags
  return text
    .replace(/<[^>]*>/g, '')  // Remove HTML tags
    .replace(/&lt;/g, '<')     // Decode common HTML entities
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}
