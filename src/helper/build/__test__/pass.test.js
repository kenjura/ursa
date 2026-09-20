/**
 * The build pass against the acceptance scenarios in docs/SERVE.md §10.
 *
 * Each scenario runs a cold build, mutates the source, runs a warm pass, and
 * checks two things: that exactly the expected outputs were rewritten
 * (minimality) and that the output directory equals a clean build of the same
 * tree (convergence), modulo the footer's per-run build metadata (§7).
 */

import { join, relative } from "path";
import { mkdtemp, mkdir, writeFile, rm, readFile, rename, unlink, readdir } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { createBuild } from "../pass.js";
import { hashBytes } from "../tracedFs.js";
import { deflateSync } from "zlib";

let tempDir;
let source;
let meta;
let output;

const TEMPLATE = `<!DOCTYPE html>
<html><head><title>\${title}</title>
<link rel="stylesheet" href="/public/base.css" />
\${styleLink}
</head>
<body><nav id="nav-main">\${menu}</nav><article>\${body}</article><footer>\${footer}</footer>
<script src="/public/app.js"></script>
\${customScript}
</body></html>`;

async function write(rel, contents) {
  const full = join(source, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents);
}

async function writeMeta(rel, contents) {
  const full = join(meta, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents);
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ursa-pass-"));
  source = join(tempDir, "src");
  meta = join(tempDir, "meta");
  output = join(tempDir, "out");
  await mkdir(source, { recursive: true });
  await writeMeta("templates/default-template/index.html", TEMPLATE);
  await writeMeta("templates/default-template/base.css", "body { font-family: url(font.woff) }\n");
  await writeMeta("templates/default-template/app.js", "fetch('/public/menu-data.json');\n");
  await writeMeta("shared/font.woff", "FONT-V1");

  await write("index.md", "# Home\n\nSee [rules](/rules/) and [grappling](/rules/grappling).\n");
  await write("rules/index.md", "---\nmenu-label: The Rules\n---\n\n# Rules\n\nBody.\n");
  await write("rules/combat.md", "# Combat\n\n![map](img/map.png)\n");
  await write("character/powers/absorb.md", "---\nclass: Witch\n---\n\n# Absorb\n\nTouch.\n");
  await write("character/powers/blast.md", "# Blast\n\nBoom.\n");
  await write("style.css", "body { color: red }\n");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** A build over the fixture; `runPass` returns the summary with `wrote` (rels). */
async function build(opts = {}) {
  const wrote = [];
  const b = await createBuild({ source, meta, output, log: () => {}, ...opts });
  b.env.onWrite = (rel) => wrote.push(rel);
  return {
    b,
    async pass(passOpts) {
      wrote.length = 0;
      // No watcher here: re-check every leaf, as a warm start does
      const summary = await b.runPass({ rescan: true, ...passOpts });
      return { ...summary, wrote: [...wrote].sort() };
    },
    close: () => b.close(),
  };
}

async function coldBuild() {
  const built = await build({ clean: true });
  await built.pass();
  return built;
}

/** Output tree as rel → content hash, with per-run build metadata normalised. */
async function snapshot(dir) {
  const out = new Map();
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else {
        let buf = await readFile(p);
        if (entry.name.endsWith(".html")) {
          const text = buf
            .toString("utf8")
            .replace(/<div class="footer-meta">[\s\S]*?<\/div>/, "")
            .replace(/<!-- git: [^>]*-->/, "")
            .replace(/ data-build="\d+"/, "");
          buf = Buffer.from(text);
        }
        out.set(relative(dir, p), hashBytes(buf));
      }
    }
  };
  await walk(dir);
  return out;
}

/** The output converges on a clean build of the same source (§1, invariant 1). */
async function expectConverged() {
  // Same basename: the root page's title is derived from the docroot's name
  const cleanOut = join(tempDir, "clean", "out");
  const cleanSrc = join(tempDir, "clean", "src");
  // Copy the source (without .ursa) so the clean build has its own graph
  await copyTree(source, cleanSrc, (rel) => !rel.startsWith(".ursa"));
  const b = await createBuild({ source: cleanSrc, meta, output: cleanOut, clean: true, log: () => {} });
  await b.runPass();
  await b.close();
  const a = await snapshot(output);
  const c = await snapshot(cleanOut);
  const diff = [];
  // Recent activity is dated by mtime outside git, and the copy has new mtimes
  a.delete("public/recent-activity.json");
  c.delete("public/recent-activity.json");
  for (const [k, v] of a) if (c.get(k) !== v) diff.push(`${k}: ${c.has(k) ? "differs" : "extra in warm"}`);
  for (const k of c.keys()) if (!a.has(k)) diff.push(`${k}: missing from warm`);
  expect(diff).toEqual([]);
}

async function copyTree(from, to, keep) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const rel = relative(source, join(from, entry.name));
    if (!keep(rel)) continue;
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(src, dst, keep);
    else await writeFile(dst, await readFile(src));
  }
}

const read = (rel) => readFile(join(output, rel), "utf8");

// ---------------------------------------------------------------------------

describe("minimality: a pass rewrites only what consumed a changed input", () => {
  it("1. an article body edit touches only its outputs, the full-text index and recent activity", async () => {
    const built = await coldBuild();
    await write("character/powers/blast.md", "# Blast\n\nBigger boom.\n");
    const r = await built.pass();
    expect(r.wrote).toEqual([
      "character/powers/blast.html",
      "character/powers/blast.json",
      "character/powers/blast.xml",
      "public/fulltext-index.json",
      "public/recent-activity.json",
    ]);
    expect(await read("character/powers/blast.html")).toContain("Bigger boom");
    await built.close();
    await expectConverged();
  });

  it("2. a menu-label edit in a non-root article updates menu data and listings, not every page", async () => {
    const built = await coldBuild();
    await write("character/powers/absorb.md", "---\nclass: Witch\nmenu-label: Absorb!\n---\n\n# Absorb\n\nTouch.\n");
    const r = await built.pass();
    expect(r.wrote).toContain("public/menu-data.json");
    expect(r.wrote).toContain("character/powers/index.html"); // the listing shows the label
    expect(r.wrote).not.toContain("index.html"); // root-level menu unchanged
    expect(r.wrote).not.toContain("rules/combat.html");
    await built.close();
    await expectConverged();
  });

  it("4. touching a file without changing its bytes writes nothing", async () => {
    const built = await coldBuild();
    await new Promise((res) => setTimeout(res, 10));
    await write("style.css", "body { color: red }\n");
    const r = await built.pass();
    expect(r.wrote).toEqual([]);
    expect([...r.changedNodes]).toEqual([]);
    await built.close();
  });
});

describe("3. inherited stylesheets: the zone is the subtree", () => {
  it("creating, editing and deleting a folder's style.css rewrites exactly that subtree", async () => {
    const built = await coldBuild();

    await write("character/style.css", "p { color: blue }\n");
    let r = await built.pass();
    expect(r.wrote.sort()).toEqual([
      "character.html", // the folder's listing page lists the new file
      "character/index.html",
      "character/powers/absorb.html",
      "character/powers/blast.html",
      "character/powers/index.html",
      "public/character-powers.bundle.css",
      "public/character.bundle.css",
    ]);
    expect(await read("character/powers/absorb.html")).toMatch(/character-powers\.bundle\.css\?v=[0-9a-f]{16}/);

    await write("character/style.css", "p { color: green }\n");
    r = await built.pass();
    expect(r.wrote).toHaveLength(6);
    expect(r.wrote).not.toContain("rules/combat.html");

    await unlink(join(source, "character/style.css"));
    r = await built.pass();
    expect(r.wrote).toHaveLength(7);
    await built.close();
    await expectConverged();
  });

  it("renaming style.css to _style.css with the same content rewrites nothing (early cutoff)", async () => {
    await write("character/style.css", "p { color: blue }\n");
    const built = await coldBuild();
    await rename(join(source, "character/style.css"), join(source, "character/_style.css"));
    const r = await built.pass();
    // Only the listing page, which names the file; no bundle, no document page
    expect(r.wrote.filter((w) => w.endsWith(".html") || w.endsWith(".css"))).toEqual(["character.html"]);
    await built.close();
  });

  it("a root style.css edit rewrites every page, and the whole set converges", async () => {
    const built = await coldBuild();
    await write("style.css", "body { color: purple }\n");
    const r = await built.pass();
    const pages = r.wrote.filter((w) => w.endsWith(".html"));
    expect(pages).toContain("index.html");
    expect(pages).toContain("rules/combat.html");
    expect(pages).toContain("character/powers/index.html");
    await built.close();
    await expectConverged();
  });
});

describe("meta: templates and shared assets", () => {
  it("5. replacing a font in meta/shared rewrites the meta bundle and every page using the template", async () => {
    const built = await coldBuild();
    const before = await read("index.html");
    await writeMeta("shared/font.woff", "FONT-V2");
    const r = await built.pass();
    expect(r.wrote).toContain("public/font.woff");
    expect(r.wrote).toContain("public/default-template.bundle.css");
    expect(r.wrote).toContain("index.html");
    expect(await read("index.html")).not.toEqual(before);
    await built.close();
    await expectConverged();
  });

  it("6. editing a template's index.html rewrites pages using it, including generated index pages", async () => {
    const built = await coldBuild();
    await writeMeta("templates/default-template/index.html", TEMPLATE.replace("<article>", '<article class="v2">'));
    const r = await built.pass();
    expect(r.wrote).toContain("index.html");
    expect(r.wrote).toContain("character/index.html"); // auto-index page
    expect(r.wrote).toContain("character/powers.html"); // listing page
    expect(await read("character/index.html")).toContain('<article class="v2">');
    await built.close();
    await expectConverged();
  });
});

describe("7–8. several sources for one output", () => {
  it("index.mdx shadows index.md; deleting index.md changes nothing; deleting index.mdx hands over the page", async () => {
    const built = await coldBuild();
    // Same menu-label as index.md: the folder's root-level label must not move
    await write("rules/index.mdx", "---\nmenu-label: The Rules\n---\n\n# Rules from MDX\n");
    let r = await built.pass();
    expect(await read("rules/index.html")).toContain("Rules from MDX");

    await unlink(join(source, "rules/index.md"));
    r = await built.pass();
    expect(r.wrote).not.toContain("rules/index.html");
    expect(await read("rules/index.html")).toContain("Rules from MDX");

    await unlink(join(source, "rules/index.mdx"));
    r = await built.pass();
    expect(await read("rules/index.html")).toContain('class="auto-index');
    expect(r.deleted).toBeGreaterThan(0);
    await built.close();
    await expectConverged();
  });

  it("foo/index.md beside foo.md: two outputs, the file wins the extensionless URL", async () => {
    await write("character.md", "# Character Doc\n\nLink: [c](/character)\n");
    const built = await coldBuild();
    expect(await read("character.html")).toContain("Character Doc");
    expect(await read("character.html")).toContain('href="/character.html"');
    await write("character/index.md", "# Character Index\n");
    const r = await built.pass();
    expect(await read("character/index.html")).toContain("Character Index");
    expect(r.wrote).not.toContain("character.html");
    await built.close();
    await expectConverged();
  });

  it("a hand-written .html outranks a rendered document of the same name", async () => {
    await write("rules/combat.html", "<html><body>Hand-written</body></html>");
    const built = await coldBuild();
    expect(await read("rules/combat.html")).toContain("Hand-written");
    expect(existsSync(join(output, "rules/combat.json"))).toBe(false);
    await built.close();
  });
});

describe("9–10. renames and deletions leave no ghosts", () => {
  it("renaming a document removes its old outputs", async () => {
    const built = await coldBuild();
    await rename(join(source, "character/powers/blast.md"), join(source, "character/powers/blaze.md"));
    const r = await built.pass();
    expect(existsSync(join(output, "character/powers/blast.html"))).toBe(false);
    expect(existsSync(join(output, "character/powers/blast.json"))).toBe(false);
    expect(existsSync(join(output, "character/powers/blaze.html"))).toBe(true);
    expect(r.deleted).toBe(3);
    await built.close();
    await expectConverged();
  });

  it("renaming a folder removes the old subtree, its bundles and listing", async () => {
    await write("character/powers/style.css", "p{color:red}\n");
    const built = await coldBuild();
    expect(existsSync(join(output, "public/character-powers.bundle.css"))).toBe(true);
    await rename(join(source, "character/powers"), join(source, "character/spells"));
    await built.pass();
    expect(existsSync(join(output, "character/powers"))).toBe(false);
    expect(existsSync(join(output, "character/powers.html"))).toBe(false);
    expect(existsSync(join(output, "public/character-powers.bundle.css"))).toBe(false);
    expect(existsSync(join(output, "character/spells/absorb.html"))).toBe(true);
    expect(existsSync(join(output, "public/character-spells.bundle.css"))).toBe(true);
    const menu = JSON.parse(await read("public/menu-data.json"));
    expect(JSON.stringify(menu)).toContain("/character/spells/");
    expect(JSON.stringify(menu)).not.toContain("/character/powers/");
    await built.close();
    await expectConverged();
  });

  it("deleting the only index.md of a folder hands the URL to the auto-index in the same pass", async () => {
    const built = await coldBuild();
    await unlink(join(source, "rules/index.md"));
    await built.pass();
    const html = await read("rules/index.html");
    expect(html).toContain('class="auto-index');
    expect(html).toContain("combat");
    await built.close();
    await expectConverged();
  });
});

describe("11–12. dead links that come alive", () => {
  it("adding a missing image gives the page its preview and lightbox without editing the page", async () => {
    const built = await coldBuild();
    expect(await read("rules/combat.html")).toContain('<img src="/rules/img/map.png"');
    await write("rules/img/map.png", pngOf(1200, 900));
    let r = await built.pass();
    expect(r.wrote).toContain("rules/combat.html");
    expect(r.wrote).toContain("rules/img/map.png");
    expect(r.wrote).toContain("rules/img/map.preview.webp");
    const html = await read("rules/combat.html");
    expect(html).toMatch(/<a href="\/rules\/img\/map\.png" target="_blank" class="image-link"><img src="\/rules\/img\/map\.preview\.webp\?v=[0-9a-f]{16}"/);

    // Replacing the image changes the ?v= token
    await write("rules/img/map.png", pngOf(1300, 900));
    r = await built.pass();
    expect(r.wrote).toContain("rules/combat.html");
    expect(await read("rules/combat.html")).not.toEqual(html);
    await built.close();
    await expectConverged();
  });

  it("creating a linked-to document rewrites only the pages that link to it", async () => {
    const built = await coldBuild();
    expect(await read("index.html")).toContain('class="inactive" href="/rules/grappling"');
    await write("rules/grappling.md", "# Grappling\n");
    const r = await built.pass();
    expect(r.wrote).toContain("index.html");
    expect(r.wrote).not.toContain("character/powers/absorb.html");
    expect(await read("index.html")).toContain('href="/rules/grappling.html"');
    expect(await read("index.html")).not.toContain("inactive");
    await built.close();
    await expectConverged();
  });
});

describe("13. MDX components", () => {
  it("editing a .tsx re-renders exactly the documents that import it", async () => {
    await write("character/_components/Card.tsx", "export default function Card({name}) { return <b>{name}</b> }\n");
    await write("character/one.mdx", 'import Card from "_components/Card.tsx"\n\n# One\n\n<Card name="A" />\n');
    await write("character/powers/two.mdx", 'import Card from "_components/Card.tsx"\n\n# Two\n\n<Card name="B" />\n');
    const built = await coldBuild();
    await write("character/_components/Card.tsx", "export default function Card({name}) { return <i>{name}</i> }\n");
    const r = await built.pass();
    expect(r.wrote.filter((w) => w.endsWith(".html")).sort()).toEqual(["character/one.html", "character/powers/two.html"]);
    expect(await read("character/one.html")).toContain("<i>A</i>");
    await built.close();
    await expectConverged();
  }, 20000);
});

describe("16. failure", () => {
  it("a failing page keeps its previous output and is retried next pass", async () => {
    const built = await coldBuild();
    const before = await read("character/powers/blast.html");
    await write("character/powers/blast.md", "---\ntemplate: no-such-template\n---\n# Blast\n");
    let r = await built.pass();
    expect([...r.failures.keys()]).toEqual(["pageHtml:character/powers/blast.md"]);
    expect(await read("character/powers/blast.html")).toEqual(before);

    await write("character/powers/blast.md", "# Blast\n\nFixed.\n");
    r = await built.pass();
    expect(r.failures.size).toBe(0);
    expect(await read("character/powers/blast.html")).toContain("Fixed.");
    await built.close();
  });
});

describe("18. warm start", () => {
  it("changes made while ursa was not running are caught by the startup pass", async () => {
    const first = await coldBuild();
    await first.close();

    await unlink(join(source, "rules/combat.md"));
    await rename(join(source, "character/powers/absorb.md"), join(source, "character/powers/soak.md"));
    await write("rules/new.md", "# New\n");
    await write("style.css", "body { color: teal }\n");

    const second = await build();
    const r = await second.pass();
    expect(existsSync(join(output, "rules/combat.html"))).toBe(false);
    expect(existsSync(join(output, "character/powers/absorb.html"))).toBe(false);
    expect(existsSync(join(output, "character/powers/soak.html"))).toBe(true);
    expect(existsSync(join(output, "rules/new.html"))).toBe(true);
    expect(r.wrote).toContain("index.html");
    await second.close();
    await expectConverged();
  });

  it("an unchanged tree verifies clean: nothing written, nothing changed", async () => {
    const first = await coldBuild();
    await first.close();
    const second = await build();
    const r = await second.pass();
    expect(r.wrote).toEqual([]);
    expect([...r.changedNodes]).toEqual([]);
    await second.close();
  });
});

describe("hidden folders, whitelist and exclude", () => {
  it("hiding a folder with config.json deletes its outputs; unhiding restores them", async () => {
    const built = await coldBuild();
    expect(existsSync(join(output, "character/powers/absorb.html"))).toBe(true);
    await write("character/config.json", JSON.stringify({ hidden: true }));
    let r = await built.pass();
    expect(existsSync(join(output, "character/powers/absorb.html"))).toBe(false);
    expect(existsSync(join(output, "character"))).toBe(false);
    expect(await read("public/menu-data.json")).not.toContain("character");
    expect(r.deleted).toBeGreaterThan(0);

    await unlink(join(source, "character/config.json"));
    r = await built.pass();
    expect(existsSync(join(output, "character/powers/absorb.html"))).toBe(true);
    await built.close();
    await expectConverged();
  });

  it("editing the whitelist file adds and removes documents live", async () => {
    const whitelist = join(tempDir, "whitelist.txt");
    await writeFile(whitelist, "rules/\nindex.md\n");
    const built = await build({ clean: true, whitelist });
    await built.pass();
    expect(existsSync(join(output, "rules/combat.html"))).toBe(true);
    expect(existsSync(join(output, "character/powers/absorb.html"))).toBe(false);

    await writeFile(whitelist, "rules/\nindex.md\ncharacter/\n");
    await built.pass();
    expect(existsSync(join(output, "character/powers/absorb.html"))).toBe(true);

    await writeFile(whitelist, "index.md\n");
    await built.pass();
    expect(existsSync(join(output, "rules/combat.html"))).toBe(false);
    expect(existsSync(join(output, "character/powers/absorb.html"))).toBe(false);
    await built.close();
  });
});

describe("json-only", () => {
  it("a full build after a JSON-only build writes the HTML and XML", async () => {
    const jsonOnly = await build({ clean: true, jsonOnly: true });
    await jsonOnly.pass();
    await jsonOnly.close();
    expect(existsSync(join(output, "character/powers/absorb.json"))).toBe(true);
    expect(existsSync(join(output, "character/powers/absorb.html"))).toBe(false);

    const full = await build();
    await full.pass();
    await full.close();
    expect(existsSync(join(output, "character/powers/absorb.html"))).toBe(true);
    expect(existsSync(join(output, "character/powers/absorb.xml"))).toBe(true);
    await expectConverged();
  });
});

describe("determinism", () => {
  it("two clean builds of the same tree are byte-identical modulo build metadata", async () => {
    const built = await coldBuild();
    await built.close();
    await expectConverged();
  });
});

/** A tiny valid PNG of the given size (red). */
function pngOf(w, h) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0).fill(Buffer.from([255, 0, 0]))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
