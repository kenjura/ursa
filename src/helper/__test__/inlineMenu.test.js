import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import {
  namedMenuOptions,
  findNamedMenu,
  collectMenuAnchorIds,
  prepareMdxMenuAnchors,
  resolveMenuAnchors,
  renderInlineMenuHtml,
  menuNotFoundComment,
  leadingMenusEnd,
} from "../inlineMenu.js";
import { isMenuFile, findCustomMenu } from "../customMenu.js";

describe("isMenuFile", () => {
  it("matches the folder menu and named menus, not documents", () => {
    for (const name of ["menu.md", "_menu.md", "menu.txt", "menu-2.md", "menu-classes.md", "_menu-x.txt", "Menu-Classes.md"]) {
      expect(isMenuFile(name)).toBe(true);
    }
    for (const name of ["menus.md", "menu.mdx", "my-menu.md", "menu-.md", "menu_x.md", "index.md", "menu"]) {
      expect(isMenuFile(name)).toBe(false);
    }
  });
});

describe("namedMenuOptions", () => {
  it("defaults appearance to horizontal and reports an invalid value", () => {
    expect(namedMenuOptions({ id: "classes" })).toEqual({ id: "classes", appearance: "horizontal", appearanceInvalid: null });
    expect(namedMenuOptions({ id: "x", appearance: "Vertical" }).appearance).toBe("vertical");
    expect(namedMenuOptions({ id: "x", appearance: "sideways" })).toMatchObject({ appearance: "horizontal", appearanceInvalid: "sideways" });
    expect(namedMenuOptions({}).id).toBeNull();
    expect(namedMenuOptions({ id: "" }).id).toBeNull();
  });
});

describe("anchors", () => {
  it("collects ids in both forms, once each", () => {
    const html = '<p>{menu:a}</p><div data-ursa-menu="b"></div><p>x {menu:a} y</p>';
    expect(collectMenuAnchorIds(html)).toEqual(["b", "a"]);
  });

  it("rewrites MDX anchors alone on a line into the element form", () => {
    const src = "---\nx: 1\n---\n\n{menu:classes}\n\nText with {menu:inline} stays.\n  {menu:indented}  \n";
    const out = prepareMdxMenuAnchors(src);
    expect(out).toContain('<div data-ursa-menu="classes"></div>');
    expect(out).toContain('<div data-ursa-menu="indented"></div>');
    expect(out).toContain("Text with {menu:inline} stays.");
  });

  it("replaces a paragraph that is only the anchor", () => {
    const out = resolveMenuAnchors("<h1>T</h1>\n<p>{menu:classes}</p>\n<p>Body.</p>", (id) => `<nav>${id}</nav>`);
    expect(out).toBe("<h1>T</h1>\n<nav>classes</nav>\n<p>Body.</p>");
  });

  it("splits a paragraph with text around the anchor so the nav is not inside a <p>", () => {
    const out = resolveMenuAnchors("<p>Before {menu:x} after</p>", (id) => `<nav>${id}</nav>`);
    expect(out).toBe("<p>Before</p>\n<nav>x</nav><p>after</p>\n");
  });

  it("leaves anchors quoted in code alone", () => {
    const html = "<p>Write <code>{menu:x}</code> on its own line.</p>\n<pre><code>{menu:y}</code></pre>";
    expect(resolveMenuAnchors(html, () => "NO")).toBe(html);
  });

  it("replaces the element form anywhere", () => {
    const out = resolveMenuAnchors('<div data-ursa-menu="c"></div><div data-ursa-menu="d"/>', (id) => `[${id}]`);
    expect(out).toBe("[c][d]");
  });

  it("is a no-op for bodies without anchors", () => {
    const html = "<p>Nothing here { menu } either</p>";
    expect(resolveMenuAnchors(html, () => "X")).toBe(html);
  });

  it("finds where leading menus end", () => {
    const nav = '<nav class="ursa-menu ursa-menu-horizontal" data-menu-id="a"><ul></ul></nav>';
    expect(leadingMenusEnd(`${nav}\n<p>x</p>`)).toBe(nav.length);
    expect(leadingMenusEnd(`\n${nav}${menuNotFoundComment("b")}<h1>T</h1>`)).toBe(1 + nav.length + menuNotFoundComment("b").length);
    expect(leadingMenusEnd("<h1>T</h1>")).toBe(0);
  });
});

describe("renderInlineMenuHtml", () => {
  const data = [
    { label: "Arcanist", href: "/character/classes/arcanist.html", children: [] },
    { label: "Fighter & Co", href: "/character/classes/fighter.html", children: [] },
    {
      label: "More",
      href: null,
      children: [{ label: "Witch", href: "/character/classes/witch.html", children: [] }],
    },
  ];

  it("renders a horizontal nav by default, escaping labels", () => {
    const html = renderInlineMenuHtml(data, { id: "classes" });
    expect(html).toMatch(/^<nav class="ursa-menu ursa-menu-horizontal" data-menu-id="classes"/);
    expect(html).toContain("Fighter &amp; Co");
    expect(html).toContain('<ul class="ursa-menu-level" data-depth="1">');
    expect(html).toContain('<li class="ursa-menu-item ursa-menu-has-children"><span>More</span>');
  });

  it("marks the current page and its ancestors", () => {
    const html = renderInlineMenuHtml(data, { id: "classes", appearance: "vertical", currentUrl: "/character/classes/witch.html" });
    expect(html).toContain("ursa-menu-vertical");
    expect(html).toContain('<li class="ursa-menu-item ursa-menu-current"><a href="/character/classes/witch.html" aria-current="page">Witch</a>');
    expect(html).toContain('<li class="ursa-menu-item ursa-menu-has-children ursa-menu-active"><span>More</span>');
    expect(html).not.toContain('ursa-menu-current"><a href="/character/classes/arcanist.html"');
  });

  it("treats index.html, a trailing slash and no extension as the same page", () => {
    const items = [{ label: "Classes", href: "/character/classes/index.html", children: [] }];
    for (const url of ["/character/classes/", "/character/classes", "/character/classes/index.html"]) {
      expect(renderInlineMenuHtml(items, { id: "x", currentUrl: url })).toContain("ursa-menu-current");
    }
  });
});

describe("findNamedMenu / findCustomMenu", () => {
  let root;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ursa-inline-menu-"));
    await mkdir(join(root, "a/b"), { recursive: true });
    await writeFile(join(root, "menu.md"), "---\nauto-generate-menu: true\n---\n");
    await writeFile(join(root, "menu-classes.md"), "---\nid: classes\n---\n- [Root](./index.md)\n");
    await writeFile(join(root, "a/menu-classes.md"), "---\nid: classes\nappearance: vertical\n---\n- [Deep](./x.md)\n");
    await writeFile(join(root, "a/b/menu.md"), "---\nid: named-main\n---\n- [Hidden](./y.md)\n");
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("nearest file with the id wins", () => {
    expect(findNamedMenu(join(root, "a/b"), root, "classes").menuDir).toBe(join(root, "a"));
    expect(findNamedMenu(root, root, "classes").menuDir).toBe(root);
    expect(findNamedMenu(join(root, "a/b"), root, "named-main").path).toBe(join(root, "a/b/menu.md"));
    expect(findNamedMenu(join(root, "a/b"), root, "nope")).toBeNull();
  });

  it("a menu.md with an id is not the folder's nav menu", () => {
    const info = findCustomMenu(join(root, "a/b"), root);
    expect(info.menuDir).toBe(root);
  });
});
