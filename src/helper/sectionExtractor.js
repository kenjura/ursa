/**
 * Extract sections from markdown content based on headings
 * Creates a hierarchical structure of sections
 */

/**
 * Extract sections from markdown content
 * @param {string} content - The markdown content
 * @returns {Array} Array of section objects with name and optional children
 */
export function extractSections(content) {
  if (!content) return [];
  
  // Match all markdown headings (# to ######)
  // Handles both "# Heading" and "#Heading" formats
  const headingRegex = /^(#{1,6})\s*(.+?)$/gm;
  
  const headings = [];
  let match;
  
  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length; // Number of # characters
    const name = match[2].trim();
    headings.push({ level, name });
  }
  
  if (headings.length === 0) return [];
  
  // Build hierarchical structure
  return buildSectionTree(headings);
}

/**
 * Build a hierarchical tree from flat heading list
 * @param {Array} headings - Array of {level, name} objects
 * @returns {Array} Hierarchical section tree
 */
function buildSectionTree(headings) {
  const root = { level: 0, children: [] };
  const stack = [root];
  
  for (const heading of headings) {
    const section = { name: heading.name, level: heading.level, children: [] };
    
    // Pop stack until we find a parent with lower level
    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    
    // Add to parent's children
    const parent = stack[stack.length - 1];
    parent.children.push(section);
    
    // Push this section onto stack (it might have children)
    stack.push(section);
  }
  
  // Clean up: remove level and empty children arrays
  cleanupTree(root.children);
  
  return root.children;
}

/**
 * Remove level property and empty children arrays from the tree
 */
function cleanupTree(sections) {
  for (const section of sections) {
    delete section.level;
    if (section.children && section.children.length > 0) {
      cleanupTree(section.children);
    } else {
      delete section.children;
    }
  }
}
