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

// Build a flat tree structure with path info for JS navigation
function buildMenuData(tree, source, parentPath = '') {
  const items = [];
  
  for (const item of tree.children || []) {
    const ext = extname(item.path);
    const label = basename(item.path, ext);
    const hasChildren = !!item.children;
    const relativePath = item.path.replace(source, '');
    const folderPath = parentPath ? `${parentPath}/${label}` : label;
    
    let href = null;
    if (hasChildren) {
      if (hasIndexFile(item.path)) {
        href = `/${relativePath}/index.html`;
      }
    } else {
      href = `/${relativePath.replace(ext, '')}`;
    }
    
    const menuItem = {
      label,
      path: folderPath,
      href,
      hasChildren,
      icon: getIcon(item, source),
    };
    
    if (hasChildren) {
      menuItem.children = buildMenuData(item, source, folderPath);
    }
    
    items.push(menuItem);
  }
  
  return items.sort((a, b) => {
    if (a.hasChildren && !b.hasChildren) return -1;
    if (b.hasChildren && !a.hasChildren) return 1;
    if (a.label > b.label) return 1;
    if (a.label < b.label) return -1;
    return 0;
  });
}

export async function getAutomenu(source) {
  const tree = dirTree(source);
  const menuData = buildMenuData(tree, source);
  
  // Add home item
  const fullMenuData = [
    { label: 'Home', path: '', href: '/', hasChildren: false, icon: `<span class="menu-icon">${HOME_ICON}</span>` },
    ...menuData
  ];
  
  // Embed the menu data as JSON for JavaScript to use
  const menuDataScript = `<script type="application/json" id="menu-data">${JSON.stringify(fullMenuData)}</script>`;
  
  // Render the breadcrumb header (hidden by default, shown when navigating)
  const breadcrumbHtml = `
<div class="menu-breadcrumb" style="display: none;">
  <button class="menu-back" title="Go back">←</button>
  <button class="menu-home" title="Go to root">🏠</button>
  <span class="menu-current-path"></span>
</div>`;

  // Render the initial menu (root level)
  const menuHtml = renderMenuLevel(fullMenuData, 0);
  
  return `${menuDataScript}${breadcrumbHtml}<ul class="menu-level" data-level="0">${menuHtml}</ul>`;
}

function renderMenuLevel(items, level) {
  return items.map(item => {
    const hasChildrenClass = item.hasChildren ? ' has-children' : '';
    const hasChildrenIndicator = item.hasChildren ? '<span class="menu-more">⋯</span>' : '';
    
    const labelHtml = item.href
      ? `<a href="${item.href}" class="menu-label">${item.label}</a>`
      : `<span class="menu-label">${item.label}</span>`;
    
    return `
<li class="menu-item${hasChildrenClass}" data-path="${item.path}">
  <div class="menu-item-row">
    ${item.icon}
    ${labelHtml}
    ${hasChildrenIndicator}
  </div>
</li>`;
  }).join('');
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
