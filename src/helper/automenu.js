import dirTree from "directory-tree";
import { extname, basename, join, dirname } from "path";
import { existsSync } from "fs";

// Icon extensions to check for custom icons
const ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];

// Default icons (using emoji for simplicity, can be replaced with SVG)
const FOLDER_ICON = '📁';
const DOCUMENT_ICON = '📄';
const HOME_ICON = '🏠';

// Index file extensions to check for folder links
const INDEX_EXTENSIONS = ['.md', '.txt', '.yml', '.yaml'];

function hasIndexFile(dirPath) {
  for (const ext of INDEX_EXTENSIONS) {
    const indexPath = join(dirPath, `index${ext}`);
    if (existsSync(indexPath)) {
      return true;
    }
  }
  return false;
}

function findCustomIcon(dirPath, source) {
  for (const ext of ICON_EXTENSIONS) {
    const iconPath = join(dirPath, `icon${ext}`);
    if (existsSync(iconPath)) {
      // Return the web-accessible path
      return iconPath.replace(source, '/');
    }
  }
  return null;
}

function getIcon(item, source, isHome = false) {
  if (isHome) {
    return `<span class="menu-icon">${HOME_ICON}</span>`;
  }
  
  if (item.children) {
    // It's a folder - check for custom icon
    const customIcon = findCustomIcon(item.path, source);
    if (customIcon) {
      return `<span class="menu-icon"><img src="${customIcon}" alt="" /></span>`;
    }
    return `<span class="menu-icon">${FOLDER_ICON}</span>`;
  }
  
  // It's a file - check for custom icon in parent directory with matching name
  const dir = dirname(item.path);
  const base = basename(item.path, extname(item.path));
  for (const ext of ICON_EXTENSIONS) {
    const iconPath = join(dir, `${base}-icon${ext}`);
    if (existsSync(iconPath)) {
      return `<span class="menu-icon"><img src="${iconPath.replace(source, '/')}" alt="" /></span>`;
    }
  }
  
  return `<span class="menu-icon">${DOCUMENT_ICON}</span>`;
}

export async function getAutomenu(source) {
  const tree = dirTree(source);
  const menuItems = [];

  /** order of menu items:
   *  - Home
   *  - Top-level folders A-Z
   *  - Top-level files A-Z
   **/

  menuItems.push({
    path: "/",
    name: "Home",
    type: "file",
    isHome: true,
  });

  const topLevelItems = tree.children.sort(childSorter);
  const topLevelHtml = topLevelItems
    .map((item) => renderMenuItem({ ...item, source }))
    .join("");

  // Render home item separately with home icon
  const homeHtml = `
<li class="menu-item">
  <div class="menu-item-row">
    <span class="menu-no-twisty"></span>
    <span class="menu-icon">${HOME_ICON}</span>
    <a href="/" class="menu-label">Home</a>
  </div>
</li>`;

  return `<ul>${homeHtml}${topLevelHtml}</ul>`;
}

function renderMenuItem({ path, name, children, source }) {
  const ext = extname(path);
  const label = basename(path, ext);
  const hasChildren = !!children;
  const icon = getIcon({ path, children }, source);
  
  // Determine the href based on whether it's a folder or file
  let labelHtml;
  if (hasChildren) {
    // It's a folder - check if it has an index file
    if (hasIndexFile(path)) {
      const folderPath = path.replace(source, "");
      labelHtml = `<a href="/${folderPath}/index.html" class="menu-label">${label}</a>`;
    } else {
      // No index file - render as non-clickable text
      labelHtml = `<span class="menu-label">${label}</span>`;
    }
  } else {
    // It's a file - link to the HTML version
    const href = path.replace(source, "").replace(ext, "");
    labelHtml = `<a href="/${href}" class="menu-label">${label}</a>`;
  }
  
  // Twisty arrow for expandable items
  const twisty = hasChildren 
    ? `<span class="expand-arrow">▶</span>`
    : `<span class="menu-no-twisty"></span>`;
  
  const childrenHtml = children
    ? `<ul>${children
        .sort(childSorter)
        .map((child) => renderMenuItem({ ...child, source }))
        .join("")}</ul>`
    : "";

  const hasChildrenClass = hasChildren ? ' has-children' : '';
  const html = `
<li class="menu-item${hasChildrenClass}">
  <div class="menu-item-row">
    ${twisty}
    ${icon}
    ${labelHtml}
  </div>
  ${childrenHtml}
</li>`;

  return html;
}

function childSorter(a, b) {
  if (a.children && !b.children) return -1;
  if (b.children && !a.children) return 1;
  if (a.name > b.name) return 1;
  if (a.name < b.name) return -1;
  return 0;
}

function menuItemSorter(a, b) {
  if (a.childMenuItems && !b.childMenuItems) return -1;
  if (b.childMenuItems && !a.childMenuItems) return 1;
  if (a.label > b.label) return 1;
  if (a.label < b.label) return -1;
  return 0;
}

export async function OLDgetAutomenu(source) {
  const trimmedFilenames = allSourceFilenames.map((filename) => ({
    filename: filename.replace(source, ""),
    depth: filename.split("").filter((char) => char === "/").length,
  }));
  const sortedFilenames = [...trimmedFilenames].sort((a, b) => {
    if (a.depth > b.depth) return 1;
    if (a.depth < b.depth) return -1;
    if (a.filename > b.filename) return 1;
    if (a.filename < b.filename) return -1;
    return 0;
  });
  const menuItems = sortedFilenames
    .filter((filename) => filename.indexOf(".md") > -1)
    .filter((filename) => filename.indexOf("menu.") === -1)
    .map((filename) => {
      const depthPrefix = filename
        .split("")
        .filter((char) => char === "/")
        .map((char) => "  ")
        .join("");
      const ext = extname(filename);
      const articleName = basename(filename, ext);
      const link = filename.replace(ext, "");
      const menuItem = `${depthPrefix}+ [${articleName}](${link})`;
      return menuItem;
    });
  return menuItems.join("\n");

  /*
+ [Home](/5e)
+ [Classes](/5e/Classes)
  + [Artificer](/5e/Classes/Artificer)
  + [Elementalist](/5e/Classes/Elementalist)
  */
}
