import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import {
  clearConfigCache,
  isFolderHidden,
  isFolderSelfHidden,
} from "../folderConfig.js";

let source;
beforeEach(async () => {
  source = await mkdtemp(join(tmpdir(), "ursa-folderconfig-"));
  clearConfigCache();
});
afterEach(async () => {
  await rm(source, { recursive: true, force: true });
});

async function hide(...segments) {
  const dir = join(source, ...segments);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.json"), JSON.stringify({ hidden: true }));
  return dir;
}

describe("isFolderHidden", () => {
  it("matches the hidden folder itself", async () => {
    const art = await hide("everdew", "_art");
    expect(isFolderHidden(art, source)).toBe(true);
  });

  it("matches a descendant folder of a hidden folder", async () => {
    await hide("everdew", "_art");
    const nested = join(source, "everdew", "_art", "prompts", "people");
    await mkdir(nested, { recursive: true });
    expect(isFolderHidden(nested, source)).toBe(true);
  });

  it("matches file paths, not just directories", async () => {
    // The build filters one list holding both files and directories through
    // this predicate, so a file must resolve via its ancestors.
    await hide("everdew", "_art");
    expect(
      isFolderHidden(join(source, "everdew", "_art", "prompts.md"), source)
    ).toBe(true);
    expect(
      isFolderHidden(join(source, "everdew", "_art", "img", "map.png"), source)
    ).toBe(true);
  });

  it("leaves siblings and ancestors of a hidden folder visible", async () => {
    await hide("everdew", "_art");
    await mkdir(join(source, "everdew", "people"), { recursive: true });
    expect(isFolderHidden(join(source, "everdew", "people"), source)).toBe(false);
    expect(isFolderHidden(join(source, "everdew"), source)).toBe(false);
    expect(
      isFolderHidden(join(source, "everdew", "people", "alice.md"), source)
    ).toBe(false);
  });

  it("ignores a config.json that does not set hidden", async () => {
    const dir = join(source, "everdew");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.json"), JSON.stringify({ label: "Everdew" }));
    expect(isFolderHidden(dir, source)).toBe(false);
  });

  it("tolerates a trailing slash on the docroot", async () => {
    const art = await hide("everdew", "_art");
    expect(isFolderHidden(art, source + "/")).toBe(true);
  });
});

describe("isFolderSelfHidden", () => {
  it("is true only for the folder carrying the config, not its descendants", async () => {
    const art = await hide("everdew", "_art");
    const nested = join(art, "prompts");
    await mkdir(nested, { recursive: true });

    expect(isFolderSelfHidden(art)).toBe(true);
    expect(isFolderSelfHidden(nested)).toBe(false);
  });

  it("is false for a folder with no config.json", async () => {
    const dir = join(source, "people");
    await mkdir(dir, { recursive: true });
    expect(isFolderSelfHidden(dir)).toBe(false);
  });
});
