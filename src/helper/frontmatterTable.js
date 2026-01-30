/**
 * Convert YAML frontmatter metadata to an HTML table
 * and inject it into the document body after the first H1
 */

/**
 * Convert a metadata value to a displayable string
 * @param {any} value - The value to convert
 * @returns {string} The displayable string
 */
function formatValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(formatValue).join(', ');
  }
  if (typeof value === 'object') {
    // For nested objects, render as a mini definition list
    return Object.entries(value)
      .map(([k, v]) => `<strong>${escapeHtml(k)}:</strong> ${escapeHtml(formatValue(v))}`)
      .join('<br>');
  }
  return String(value);
}

/**
 * Escape HTML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Convert a key to a human-readable label
 * @param {string} key - The metadata key
 * @returns {string} Human-readable label
 */
function formatKey(key) {
  // Convert camelCase or snake_case to Title Case with spaces
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase
    .replace(/_/g, ' ') // snake_case
    .replace(/\b\w/g, c => c.toUpperCase()); // Title Case
}

/**
 * Generate an HTML table from metadata object
 * @param {Object} metadata - The parsed YAML frontmatter
 * @returns {string} HTML table string
 */
export function metadataToTable(metadata) {
  if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length === 0) {
    return '';
  }

  // Filter out Ursa-internal keys that shouldn't be displayed in the metadata table
  // These are used by Ursa for rendering/menu behavior, not document metadata
  const excludeKeys = [
    'title',          // Document title
    'template',       // Specifies which HTML template to use
    'layout',         // Alternative name for template
    'draft',          // Marks document as draft (not published)
    'published',      // Publication status
    'menu-label',     // Custom label for menu display
    'menu-sort-as',   // Custom sort key for menu ordering
    'generate-auto-index', // Auto-indexing control
    'auto-index-depth',    // Auto-indexing depth
    'auto-index-position'  // Auto-indexing position
  ];
  const entries = Object.entries(metadata).filter(
    ([key]) => !excludeKeys.includes(key.toLowerCase())
  );

  if (entries.length === 0) {
    return '';
  }

  const rows = entries.map(([key, value]) => {
    const formattedValue = formatValue(value);
    // Don't escape HTML in formatted value since it may contain our formatting
    return `    <tr>
      <th>${escapeHtml(formatKey(key))}</th>
      <td>${formattedValue}</td>
    </tr>`;
  }).join('\n');

  return `<table class="frontmatter-table">
  <tbody>
${rows}
  </tbody>
</table>`;
}

/**
 * Inject the frontmatter table into the body HTML after the first H1
 * If no H1 is present, prepend the table to the body
 * @param {string} bodyHtml - The rendered body HTML
 * @param {Object} metadata - The parsed YAML frontmatter
 * @returns {string} The body HTML with the frontmatter table injected
 */
export function injectFrontmatterTable(bodyHtml, metadata) {
  const table = metadataToTable(metadata);
  
  if (!table) {
    return bodyHtml;
  }

  // Look for the first closing </h1> tag
  const h1CloseMatch = bodyHtml.match(/<\/h1>/i);
  
  if (h1CloseMatch) {
    // Insert the table after the first </h1>
    const insertPosition = h1CloseMatch.index + h1CloseMatch[0].length;
    return (
      bodyHtml.slice(0, insertPosition) +
      '\n' + table + '\n' +
      bodyHtml.slice(insertPosition)
    );
  }

  // No H1 found, prepend the table
  return table + '\n' + bodyHtml;
}
