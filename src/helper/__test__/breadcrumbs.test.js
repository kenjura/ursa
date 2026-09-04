import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { generateBreadcrumbs } from "../breadcrumbs.js";
import { clearConfigCache } from "../folderConfig.js";

let source;
beforeEach(async () => {
  source = await mkdtemp(join(tmpdir(), "ursa-breadcrumbs-"));
  clearConfigCache();
});
afterEach(async () => {
  await rm(source, { recursive: true, force: true });
  clearConfigCache();
});

describe("generateBreadcrumbs", () => {
  it("names folder segments the way the menu does", async () => {
    await mkdir(join(source, "campaigns", "bnw"), { recursive: true });
    await writeFile(
      join(source, "campaigns", "bnw", "index.md"),
      "---\nmenu-label: 'BNW - Brave New World'\n---\n# Brave New World\n"
    );

    const html = generateBreadcrumbs("campaigns/bnw/", "quests", null, source);

    expect(html).toContain(">BNW - Brave New World</a>");
    expect(html).toContain('aria-current="page">Quests</span>');
  });

  it("falls back to config.json when a folder has no index", async () => {
    await mkdir(join(source, "campaigns", "hfr"), { recursive: true });
    await writeFile(
      join(source, "campaigns", "hfr", "config.json"),
      JSON.stringify({ label: "HFR - Hyacinth: Fury Road" })
    );

    const html = generateBreadcrumbs("campaigns/hfr/", "sessions", null, source);

    expect(html).toContain(">HFR - Hyacinth: Fury Road</a>");
  });

  it("uses the folder label for the current crumb on a folder's index page", async () => {
    await mkdir(join(source, "campaigns", "bnw"), { recursive: true });
    await writeFile(
      join(source, "campaigns", "bnw", "index.md"),
      "---\nmenu-label: 'BNW - Brave New World'\n---\n# Brave New World\n"
    );

    const html = generateBreadcrumbs("campaigns/bnw/", "index", null, source);

    expect(html).toContain('aria-current="page">BNW - Brave New World</span>');
  });

  it("keeps the document's own frontmatter override for the last crumb", () => {
    const withMenuLabel = generateBreadcrumbs("guides/", "setup", {
      "menu-label": "Getting Started",
      title: "Setup Guide",
    });
    expect(withMenuLabel).toContain('aria-current="page">Getting Started</span>');

    // menu-label absent: title still wins, as it always has
    const withTitle = generateBreadcrumbs("guides/", "setup", { title: "Setup Guide" });
    expect(withTitle).toContain('aria-current="page">Setup Guide</span>');
  });

  it("preserves interior capitalization without a source root", () => {
    const html = generateBreadcrumbs("campaigns/SoL/", "index", null);
    expect(html).toContain('aria-current="page">SoL</span>');
  });
});
