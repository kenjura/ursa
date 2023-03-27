import dirTree from "directory-tree";
import { extname, basename } from "path";

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
  });

  const topLevelItems = tree.children.sort(childSorter);
  const topLevelHtml = topLevelItems
    .map((item) => renderMenuItem({ ...item, source }))
    .join("");

  return `<ul>${topLevelHtml}</ul>`;
}

function renderMenuItem({ path, name, children, source }) {
  const ext = extname(path);
  const href = path.replace(source, "").replace(ext, "");
  const label = basename(path, ext);
  //   const childMenuItems = Array.isArray(children)
  //     ? children
  //         .map((child) => renderMenuItem({ ...child, source }))
  //         .sort(menuItemSorter)
  //     : null;
  const html = `
<li data-has-children="${!!children}">
  <a href="/${href}">${label}</a>
  ${
    children
      ? `<ul>
    ${children
      .sort(childSorter)
      .map((child) => renderMenuItem({ ...child, source }))
      .join("")}
  </ul>`
      : ""
  }
</li>`;
  return html;

  return {
    href,
    label,
    childMenuItems,
  };

  /**
   * example output:
   * {
   *   href:'Foo/Bar',
   *   label:'Bar',
   *   childMenuItems: [thisObject]
   * }
   */
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
