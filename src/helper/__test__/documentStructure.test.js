import { markdownToHtml } from "../markdownHelper.cjs";
import { wikiToHtml } from "../wikitextHelper.js";
import { renderMDX } from "../mdxRenderer.js";
import { slugify, createSlugger } from "../slug.cjs";
import { ensureTitleSection, docWithFurniture } from "../build/docStructure.js";

/** The section/heading skeleton of rendered HTML: `S1[`, `h1#id`, `]`, … */
function outline(html) {
  const tokens = [];
  const re = /<section class="ursa-section[^"]*" data-level="(\d)"[^>]*>|<\/section>|<h([1-6]) id="([^"]*)"/g;
  for (const m of html.matchAll(re)) {
    if (m[1]) tokens.push(`S${m[1]}[`);
    else if (m[2]) tokens.push(`h${m[2]}#${m[3]}`);
    else tokens.push("]");
  }
  return tokens.join(" ");
}

const EXPECTED = "S1[ h1#fighter S2[ h2#hit-points h3#level-1 ] S2[ h2#hit-points-2 ] ] S1[ h1#subclasses ]";

describe("slugs", () => {
  it("lowercases, keeps letters and digits in any script, and hyphenates the rest", () => {
    expect(slugify("Hit Points")).toBe("hit-points");
    expect(slugify("  Rogue's Tools & Kits! ")).toBe("rogues-tools-kits");
    expect(slugify("Über Straße 2")).toBe("über-straße-2");
    expect(slugify("???")).toBe("section");
  });

  it("de-duplicates with -2, -3 in document order", () => {
    const slug = createSlugger();
    expect([slug("A"), slug("A"), slug("a"), slug("A-2")]).toEqual(["a", "a-2", "a-3", "a-2-2"]);
  });
});

describe("sections at render time", () => {
  it("Markdown: one section per h1, one per h2 inside it; the preamble is unwrapped", () => {
    const html = markdownToHtml("intro\n\n# Fighter\n\n## Hit Points\n\n### Level 1\n\n## Hit Points\n\n# Subclasses\n");
    expect(outline(html)).toBe(EXPECTED);
    expect(html.trimStart().startsWith("<p>intro</p>")).toBe(true);
  });

  it("Markdown: tables scroll, asides are marked", () => {
    const html = markdownToHtml("| a |\n|---|\n| 1 |\n\n::: aside\nnote\n:::\n");
    expect(html).toMatch(/<div class="ursa-table-scroll">\s*<table>/);
    expect(html).toContain('<aside class="ursa-aside">');
  });

  it("MDX: the same structure as Markdown", async () => {
    const { html } = await renderMDX({
      source: "# Fighter\n\n## Hit Points\n\n### Level 1\n\n## Hit Points\n\n# Subclasses\n",
      filePath: "/tmp/structure.mdx",
      sourceRoot: "/tmp",
    });
    expect(outline(html)).toBe(EXPECTED);
  });

  it("wikitext: the same structure, with the heading's classes and style on its section", () => {
    const { html } = wikiToHtml({
      wikitext: "=Fighter|warrior|color: red=\n==Hit Points==\n===Level 1===\n==Hit Points==\n=Subclasses=\n",
      articleName: "fighter",
      args: { db: "classes" },
    });
    expect(outline(html)).toBe(EXPECTED);
    expect(html).toContain('<section class="ursa-section warrior" data-level="1" style="color: red">');
  });

  it("wikitext: |right makes a sidebar with no heading", () => {
    const { html } = wikiToHtml({ wikitext: "=Main=\ntext\n=Notes|right=\nside\n", articleName: "x", args: { db: "d" } });
    expect(html).toMatch(/<aside class="ursa-sidebar">\s*<p>side<\/p>\s*<\/aside>/);
    expect(html).not.toContain("Notes");
  });

  it("wikitext: legacy constructs use ursa- markup and anchors use slugs", () => {
    const { html } = wikiToHtml({
      wikitext: "=T=\n++big++ +++bigger+++\n..one\n...two\n[[#Hit Points]] [[Wizard#Spell List]]\n[[Image:a.png|200|right|A caption]]\n{|\n|1\n|}\n",
      articleName: "t",
      args: { db: "classes" },
    });
    expect(html).toContain('<span class="ursa-big" data-level="1">big</span>');
    expect(html).toContain('<span class="ursa-big" data-level="2">bigger</span>');
    expect(html).toContain('<div class="ursa-indent" data-level="1">one</div>');
    expect(html).toContain('<div class="ursa-indent" data-level="2">two</div>');
    expect(html).toContain('href="#hit-points"');
    expect(html).toContain('<a class="ursa-wikilink" data-article="Wizard" href="/classes/Wizard#spell-list">');
    expect(html).toContain('<figure data-align="end"><img src="/classes/img/a.png" alt="A caption" style="width: 200px;"><figcaption>A caption</figcaption></figure>');
    expect(html).toContain('<div class="ursa-table-scroll"><table');
  });
});

describe("document box", () => {
  it("gives a document without a leading h1 a title section around its preamble", () => {
    const body = '<p>intro</p>\n<section class="ursa-section" data-level="2"><h2 id="a">A</h2></section>\n<section class="ursa-section" data-level="1"><h1 id="b">B</h1></section>';
    expect(outline(ensureTitleSection(body, "Doc"))).toBe("S1[ h1#doc S2[ h2#a ] ] S1[ h1#b ]");
    const titled = '<section class="ursa-section" data-level="1"><h1 id="x">X</h1></section>';
    expect(ensureTitleSection(titled, "Doc")).toBe(titled);
    expect(ensureTitleSection('<h2 id="doc">Doc</h2>', "Doc")).toContain('<h1 id="doc-2">Doc</h1>');
  });

  it("wraps furniture in the document header and footer, and omits them when empty", () => {
    expect(docWithFurniture({ body: "<p>b</p>" })).toBe("<p>b</p>");
    const html = docWithFurniture({ header: "<nav>crumbs</nav>\n", body: "<p>b</p>", footer: "<nav>m</nav>" });
    expect(html).toBe('<header class="ursa-doc-header">\n<nav>crumbs</nav>\n</header>\n<p>b</p>\n<footer class="ursa-doc-footer">\n<nav>m</nav>\n</footer>');
  });
});
