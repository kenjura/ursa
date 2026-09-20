import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { generateAutoIndexHtmlFromSource } from "../autoIndex.js";

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
});

describe("folders ignored via config.json { hidden: true }", () => {
  it("omits a hidden folder from an auto-index built from source", async () => {
    await mkdir(join(source, "_art"), { recursive: true });
    await writeFile(join(source, "_art", "config.json"), JSON.stringify({ hidden: true }));
    await writeFile(join(source, "_art", "prompts.md"), "# Prompts\n");
    await mkdir(join(source, "people"), { recursive: true });
    await writeFile(join(source, "people", "alice.md"), "# Alice\n");

    const html = await generateAutoIndexHtmlFromSource(source, 2);

    expect(html).toContain("people");
    expect(html).not.toContain("_art");
    expect(html).not.toContain("prompts");
  });

  it("does not count documents inside a hidden subfolder when deciding a folder has content", async () => {
    // `notes` holds nothing but a hidden subfolder, so it produces no pages
    // and must not be linked as though it did.
    await mkdir(join(source, "notes", "_art"), { recursive: true });
    await writeFile(
      join(source, "notes", "_art", "config.json"),
      JSON.stringify({ hidden: true })
    );
    await writeFile(join(source, "notes", "_art", "prompts.md"), "# Prompts\n");
    await mkdir(join(source, "people"), { recursive: true });
    await writeFile(join(source, "people", "alice.md"), "# Alice\n");

    const html = await generateAutoIndexHtmlFromSource(source, 2);

    expect(html).toContain("people");
    expect(html).not.toContain("notes");
  });
});
