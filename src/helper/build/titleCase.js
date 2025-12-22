// Helper to convert filename to title case
export function toTitleCase(filename) {
  return filename
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
