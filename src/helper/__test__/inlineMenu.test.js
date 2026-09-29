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
  parseInjectMenu,
  mergeInjectMenus,
  splitMenuBody,
  rebaseMenuHtml,
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

  it("marks an item whose folder holds the current page, without calling it current", () => {
    const items = [
      { label: "Home", href: "/index.html", children: [] },
      { label: "Ancestry", href: "/character/ancestry/index.html", children: [] },
      { label: "Ancestry page", href: "/character/ancestry.html", children: [] },
      { label: "Anc", href: "/character/anc/index.html", children: [] },
      { label: "Classes", href: "/character/classes/index.html", children: [] },
    ];
    const html = renderInlineMenuHtml(items, { id: "character", currentUrl: "/character/ancestry/dragon.html" });
    expect(html).toContain('<li class="ursa-menu-item ursa-menu-path"><a href="/character/ancestry/index.html">Ancestry</a>');
    expect(html).toContain('<li class="ursa-menu-item ursa-menu-path"><a href="/character/ancestry.html">Ancestry page</a>');
    // the docroot covers every page, a name prefix is not a folder, a sibling folder is not on the path
    expect(html).toContain('<li class="ursa-menu-item"><a href="/index.html">Home</a>');
    expect(html).toContain('<li class="ursa-menu-item"><a href="/character/anc/index.html">Anc</a>');
    expect(html).toContain('<li class="ursa-menu-item"><a href="/character/classes/index.html">Classes</a>');
    expect(html).not.toContain("ursa-menu-current");
    // on the folder's own page it is current, not on the path; above a current item it is active
    expect(renderInlineMenuHtml(items, { id: "character", currentUrl: "/character/ancestry/" })).not.toContain("ursa-menu-path");
    const nested = [{ label: "Classes", href: "/character/classes/index.html", children: [{ label: "Witch", href: "/character/classes/witch.html", children: [] }] }];
    const active = renderInlineMenuHtml(nested, { id: "c", currentUrl: "/character/classes/witch.html" });
    expect(active).toContain("ursa-menu-active");
    expect(active).not.toContain("ursa-menu-path");
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

describe("config.json inject-menu", () => {
  it("accepts one object or an array, defaults position to top, reports bad entries", () => {
    expect(parseInjectMenu({ id: "classes" })).toEqual({ entries: [{ id: "classes", position: "top", replace: false }], problems: [] });
    expect(parseInjectMenu([{ id: "a", position: "bottom" }, { id: "b", position: "TOP" }]).entries).toEqual([
      { id: "a", position: "bottom", replace: false },
      { id: "b", position: "top", replace: false },
    ]);
    const bad = parseInjectMenu([{ id: "a", position: "left" }, { position: "top" }, "x", { id: "c", "replace-ancestor-menus": "yes" }]);
    expect(bad.entries).toEqual([{ id: "a", position: "top", replace: false }, { id: "c", position: "top", replace: false }]);
    expect(bad.problems).toHaveLength(4);
    expect(parseInjectMenu(undefined).entries).toEqual([]);
  });

  it("reads replace-ancestor-menus, and ignores the old inherit marker", () => {
    expect(parseInjectMenu({ id: "sub", "replace-ancestor-menus": true }).entries).toEqual([{ id: "sub", position: "top", replace: true }]);
    expect(parseInjectMenu({ inherit: true })).toEqual({ entries: [], problems: [] });
    expect(parseInjectMenu([{ inherit: true }, { id: "sub", position: "bottom" }]).entries).toEqual([{ id: "sub", position: "bottom", replace: false }]);
  });

  it("merges down the folder chain: ancestors first, replace-ancestor-menus clears its position, unset passes through", () => {
    const root = parseInjectMenu([{ id: "site", position: "top" }, { id: "foot", position: "bottom" }]);
    const mid = parseInjectMenu({ id: "section" });
    const leaf = parseInjectMenu({ id: "leaf" });
    const top = (id) => ({ id, position: "top" });
    const foot = { id: "foot", position: "bottom" };
    expect(mergeInjectMenus([root])).toEqual([top("site"), foot]);
    expect(mergeInjectMenus([root, null])).toEqual([top("site"), foot]);
    expect(mergeInjectMenus([root, mid])).toEqual([top("site"), foot, top("section")]);
    expect(mergeInjectMenus([root, mid, null, leaf])).toEqual([top("site"), foot, top("section"), top("leaf")]);
    // replacing at the top drops every ancestor's top menus but keeps the bottom one
    const replacer = parseInjectMenu({ id: "leaf", "replace-ancestor-menus": true });
    expect(mergeInjectMenus([root, mid, replacer])).toEqual([foot, top("leaf")]);
    // ...and a deeper folder adds to the replacement again
    expect(mergeInjectMenus([root, mid, replacer, parseInjectMenu({ id: "deep" })])).toEqual([foot, top("leaf"), top("deep")]);
    // the replacing level's own sibling entries survive
    expect(mergeInjectMenus([root, parseInjectMenu([{ id: "a" }, { id: "b", "replace-ancestor-menus": true }])])).toEqual([foot, top("a"), top("b")]);
    // same id and position inherited and restated: once, in its first place
    expect(mergeInjectMenus([root, mid, parseInjectMenu({ id: "site" })])).toEqual([top("site"), foot, top("section")]);
    expect(mergeInjectMenus([])).toEqual([]);
  });
});

describe("menu bodies with prose", () => {
  it("splits item lists from the text around them, in order", () => {
    const body = "Feat Categories:\n* [Ancestry](./ancestry/index.md)\n* [Class](./class/index.md)\n\nBlargo\n\n[foo](#)\n\n*bar* _baz_\n- [Last](./last.md)\n";
    expect(splitMenuBody(body)).toEqual([
      { kind: "text", text: "Feat Categories:" },
      { kind: "items", text: "* [Ancestry](./ancestry/index.md)\n* [Class](./class/index.md)" },
      { kind: "text", text: "Blargo\n\n[foo](#)\n\n*bar* _baz_" },
      { kind: "items", text: "- [Last](./last.md)" },
    ]);
    // nested items and blank lines inside a list stay with the list
    expect(splitMenuBody("- [A](a.md)\n  - [B](b.md)\n\n- [C](c.md)\n")).toEqual([
      { kind: "items", text: "- [A](a.md)\n  - [B](b.md)\n\n- [C](c.md)" },
    ]);
    expect(splitMenuBody("\n\n")).toEqual([]);
  });

  it("rebases a menu's relative links and images to the menu file's folder", () => {
    const html = '<p><a href="./x.md">x</a> <a href="../y/index.md#top">y</a> <a href="/abs.html">a</a> <a href="https://e.com">e</a> <a href="#h">h</a> <img src="img/pic.png?v=1"></p>';
    expect(rebaseMenuHtml(html, "/character/feats")).toBe(
      '<p><a href="/character/feats/x.html">x</a> <a href="/character/y/index.html#top">y</a> <a href="/abs.html">a</a> <a href="https://e.com">e</a> <a href="#h">h</a> <img src="/character/feats/img/pic.png?v=1"></p>'
    );
  });

  it("renders text segments inside the nav, in order with the lists", () => {
    const html = renderInlineMenuHtml(
      [
        { kind: "text", html: "<p>Feat Categories:</p>" },
        { kind: "items", items: [{ label: "Class", href: "/character/feats/class/index.html", children: [] }] },
        { kind: "text", html: "<p>Blargo</p>" },
      ],
      { id: "feats", currentUrl: "/character/feats/class/" }
    );
    expect(html).toBe(
      '<nav class="ursa-menu ursa-menu-horizontal" data-menu-id="feats" aria-label="feats">' +
      '<div class="ursa-menu-text"><p>Feat Categories:</p></div>' +
      '<ul class="ursa-menu-level" data-depth="0"><li class="ursa-menu-item ursa-menu-current"><a href="/character/feats/class/index.html" aria-current="page">Class</a></li></ul>' +
      '<div class="ursa-menu-text"><p>Blargo</p></div></nav>'
    );
  });
});
