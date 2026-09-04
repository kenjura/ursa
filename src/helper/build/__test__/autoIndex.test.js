import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { generateAutoIndices, generateAutoIndexHtmlFromSource } from "../autoIndex.js";

let tempDir;
let source;
let output;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ursa-autoindex-"));
  source = join(tempDir, "source");
  output = join(tempDir, "output");
  await mkdir(source, { recursive: true });
  await mkdir(output, { recursive: true });
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const TEMPLATE =
  "<html><head>${styleLink}</head><body>${menu}${body}${footer}${customScript}</body></html>";

function makeProgress() {
  const logs = [];
  return {
    logs,
    log: (msg) => logs.push(msg),
    status: () => {},
    done: () => {},
  };
}

function runAutoIndices(directories, generatedArticles, progress) {
  return generateAutoIndices(
    output,
    directories,
    source,
    { "default-template": TEMPLATE },
    "",
    "",
    generatedArticles,
    new Set(),
    new Set(),
    "20260101000000",
    progress,
    null
  );
}

describe("generateAutoIndices with empty source folders", () => {
  it("skips output directories that were never created instead of logging an error", async () => {
    // Source has an empty folder (guides) and a folder with a document (docs).
    // Only docs produced output files, so output/guides does not exist.
    await mkdir(join(source, "guides"));
    await mkdir(join(source, "docs"));
    await writeFile(join(source, "docs", "hello.md"), "# Hello\n\nWorld\n");
    await mkdir(join(output, "docs"));
    await writeFile(join(output, "docs", "hello.html"), "<html><body>Hello</body></html>");

    const progress = makeProgress();
    await runAutoIndices(
      [join(source, "guides"), join(source, "docs")],
      [join(source, "docs", "hello.md")],
      progress
    );

    const errors = progress.logs.filter((m) => /Error generating auto-index/i.test(m));
    expect(errors).toEqual([]);
    // The missing output directory is skipped, not created
    expect(existsSync(join(output, "guides"))).toBe(false);
    expect(existsSync(join(output, "guides", "index.html"))).toBe(false);
  });

  it("still generates auto-indices for folders that produced output", async () => {
    await mkdir(join(source, "guides"));
    await mkdir(join(source, "docs"));
    await writeFile(join(source, "docs", "hello.md"), "# Hello\n\nWorld\n");
    await mkdir(join(output, "docs"));
    await writeFile(join(output, "docs", "hello.html"), "<html><body>Hello</body></html>");

    const progress = makeProgress();
    await runAutoIndices(
      [join(source, "guides"), join(source, "docs")],
      [join(source, "docs", "hello.md")],
      progress
    );

    // Root and docs both exist in output, so both get an index.html
    const docsIndex = await readFile(join(output, "docs", "index.html"), "utf8");
    expect(docsIndex).toContain('<a href="hello.html">');
    const rootIndex = await readFile(join(output, "index.html"), "utf8");
    expect(rootIndex).toContain('<a href="docs/index.html">');
  });
});

describe("auto-index naming matches the automenu", () => {
  it("uses menu-label from a folder's index frontmatter, and config.json when there is no index", async () => {
    // bnw has a real index.md carrying the label; hfr has no index at all, so
    // it falls back to config.json — the same two-step the automenu uses.
    await mkdir(join(source, "bnw"));
    await writeFile(
      join(source, "bnw", "index.md"),
      "---\nmenu-label: 'BNW - Brave New World'\n---\n"
    );
    await writeFile(join(source, "bnw", "quests.md"), "# Quests\n");
    await mkdir(join(source, "hfr"));
    await writeFile(
      join(source, "hfr", "config.json"),
      JSON.stringify({ label: "HFR - Hyacinth: Fury Road" })
    );
    await writeFile(join(source, "hfr", "hfr.md"), "# Hyacinth\n");

    const html = await generateAutoIndexHtmlFromSource(source, 1);

    expect(html).toContain('<a href="bnw/index.html">BNW - Brave New World</a>');
    expect(html).toContain('<a href="hfr/index.html">HFR - Hyacinth: Fury Road</a>');
  });

  it("uses menu-label on individual documents and menu-sort-as for ordering", async () => {
    await writeFile(
      join(source, "zebra.md"),
      "---\nmenu-label: 'ZED - Zebra'\nmenu-sort-as: 'aardvark'\n---\n# Zebra\n"
    );
    await writeFile(join(source, "middle.md"), "# Middle\n");

    const html = await generateAutoIndexHtmlFromSource(source, 1);

    expect(html).toContain('<a href="zebra.html">ZED - Zebra</a>');
    // Sorted by menu-sort-as ("aardvark"), not by filename ("zebra")
    expect(html.indexOf("ZED - Zebra")).toBeLessThan(html.indexOf("Middle"));
  });

  it("preserves interior capitalization instead of title-casing it away", async () => {
    await mkdir(join(source, "SoL"));
    await writeFile(join(source, "SoL", "notes.md"), "# Notes\n");

    const html = await generateAutoIndexHtmlFromSource(source, 1);

    expect(html).toContain('<a href="SoL/index.html">SoL</a>');
  });

  it("labels generated index pages with the folder's menu-label", async () => {
    // No index.md content, so this folder gets an auto-generated index.html;
    // its <h1> should use the label rather than the raw folder name.
    await mkdir(join(source, "bnw"));
    await writeFile(
      join(source, "bnw", "config.json"),
      JSON.stringify({ label: "BNW - Brave New World" })
    );
    await writeFile(join(source, "bnw", "quests.md"), "# Quests\n");
    await mkdir(join(output, "bnw"));
    await writeFile(join(output, "bnw", "quests.html"), "<html><body>Quests</body></html>");

    await runAutoIndices([join(source, "bnw")], [join(source, "bnw", "quests.md")], makeProgress());

    const bnwIndex = await readFile(join(output, "bnw", "index.html"), "utf8");
    expect(bnwIndex).toContain("<h1>BNW - Brave New World</h1>");
    const rootIndex = await readFile(join(output, "index.html"), "utf8");
    expect(rootIndex).toContain('<a href="bnw/index.html">BNW - Brave New World</a>');
  });
});
