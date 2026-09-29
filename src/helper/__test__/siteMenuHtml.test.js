import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { renderNavListHtml, menuDataScript, buildCustomMenuHtml } from "../customMenu.js";
import { getAutomenu } from "../automenu.js";

// The root-level site menu that automenu.js / customMenu.js render into the
// template's ${menu}: the .ursa-nav vocabulary menu.js upgrades in place.

const DATA = [
  {
    label: "Home", path: "", href: "/index.html", hasChildren: true, isHome: true,
    children: [{ label: "Rules", path: "rules", href: "/rules.html", hasChildren: false }],
  },
  {
    label: "Classes", path: "classes", href: "/classes/index.html", hasChildren: true,
    children: [
      { label: "Classes", path: "classes/index", href: "/classes/index.html", hasChildren: false, isIndex: true },
      { label: "Fighter", path: "classes/fighter", href: "/classes/fighter.html", hasChildren: false },
      { label: "Gone", path: "classes/gone", href: "/classes/gone", hasChildren: false, inactive: true },
    ],
  },
  { label: "Bestiary", path: "bestiary", href: null, hasChildren: false },
];

describe("renderNavListHtml", () => {
  it("renders the root level as .ursa-nav-list > li.ursa-nav-item > .ursa-nav-link", () => {
    const html = renderNavListHtml(DATA);
    expect(html.startsWith('<ul class="ursa-nav-list">')).toBe(true);
    expect(html).toContain('<li class="ursa-nav-item" data-path="classes" data-branch><a class="ursa-nav-link" href="/classes/index.html">Classes</a></li>');
    // An entry with no page is a span
    expect(html).toContain('<li class="ursa-nav-item" data-path="bestiary"><span class="ursa-nav-link">Bestiary</span></li>');
    // Root level only by default
    expect(html).not.toContain("Fighter");
    expect((html.match(/<ul/g) || []).length).toBe(1);
  });

  it("marks home with data-home and an .ursa-icon svg", () => {
    const html = renderNavListHtml(DATA);
    expect(html).toMatch(/<li class="ursa-nav-item" data-path="" data-branch data-home><a class="ursa-nav-link" href="\/index.html"><svg class="ursa-icon" viewBox="0 0 24 24" aria-hidden="true">.*<\/svg>Home<\/a><\/li>/);
  });

  it("nests children, and marks index, broken and current links", () => {
    const html = renderNavListHtml(DATA, { nested: true, currentHref: "/classes/fighter" });
    expect(html).toContain('<li class="ursa-nav-item" data-path="classes/index" data-index><a class="ursa-nav-link" href="/classes/index.html">Classes</a></li>');
    expect(html).toContain('<a class="ursa-nav-link" href="/classes/fighter.html" aria-current="page">Fighter</a>');
    expect(html).toContain('<a class="ursa-nav-link" href="/classes/gone" data-ursa-broken>Gone</a>');
    expect((html.match(/aria-current/g) || []).length).toBe(1);
  });

  it("has no blank lines (it goes through the Markdown renderer as one HTML block)", () => {
    expect(renderNavListHtml(DATA, { nested: true })).not.toMatch(/\n\s*\n/);
    expect(renderNavListHtml([])).toBe('<ul class="ursa-nav-list"></ul>');
  });
});

describe("menuDataScript", () => {
  it("embeds JSON in script#ursa-menu-data without letting it close the element", () => {
    const html = menuDataScript({ openMenuItems: ["</script>"] });
    expect(html).toBe('<script type="application/json" id="ursa-menu-data">{"openMenuItems":["\\u003c/script>"]}</script>');
    expect(JSON.parse(html.replace(/^<script[^>]*>|<\/script>$/g, ""))).toEqual({ openMenuItems: ["</script>"] });
  });
});

describe("buildCustomMenuHtml", () => {
  it("side: menu data script plus the root level", () => {
    const html = buildCustomMenuHtml(DATA, "side");
    expect(html).toMatch(/^<script type="application\/json" id="ursa-menu-data">\{"openMenuItems":\[\],"customMenu":true\}<\/script>\n<ul class="ursa-nav-list">/);
    expect(html).not.toContain("Fighter");
  });

  it("top: the whole tree as nested lists", () => {
    const html = buildCustomMenuHtml(DATA, "top");
    expect(html).toContain('"position":"top"');
    expect(html).toContain('<li class="ursa-nav-item" data-path="classes" data-branch><a class="ursa-nav-link" href="/classes/index.html">Classes</a>\n<ul class="ursa-nav-list">');
    expect(html).toContain("Fighter");
  });

  it("uses none of the old menu classes", () => {
    const html = buildCustomMenuHtml(DATA, "side") + buildCustomMenuHtml(DATA, "top");
    expect(html).not.toMatch(/menu-config|menu-level|menu-item|menu-label|menu-more|menu-icon|menu-breadcrumb|top-menu|dropdown-|flyout-indicator|has-children|has-dropdown|has-flyout|is-index/);
  });
});

describe("getAutomenu", () => {
  let dir;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ursa-automenu-"));
    await mkdir(join(dir, "classes"));
    await writeFile(join(dir, "index.md"), "# Home\n");
    await writeFile(join(dir, "rules.md"), "# Rules\n");
    await writeFile(join(dir, "classes", "index.md"), "# Classes\n");
    await writeFile(join(dir, "classes", "fighter.md"), "# Fighter\n");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("renders script#ursa-menu-data and the root level in the .ursa-nav vocabulary", async () => {
    const validPaths = new Map([["/", "/index.html"], ["/rules.html", "/rules.html"]]);
    const { html, menuData } = await getAutomenu(dir + "/", validPaths);
    expect(html).toMatch(/^<script type="application\/json" id="ursa-menu-data">\{"openMenuItems":\[\]\}<\/script>\n<ul class="ursa-nav-list">/);
    expect(html).toMatch(/<li class="ursa-nav-item" data-path="" data-branch data-home><a class="ursa-nav-link" href="\/index.html"><svg class="ursa-icon"/);
    expect(html).toContain('<li class="ursa-nav-item" data-path="classes" data-branch><a class="ursa-nav-link" href="/classes/index.html">Classes</a></li>');
    expect(html).not.toMatch(/menu-breadcrumb|menu-icon|menu-level|menu-item/);
    expect(menuData[0]).toMatchObject({ label: "Home", isHome: true });
  });
});
