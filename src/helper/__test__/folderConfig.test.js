import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { jest } from "@jest/globals";
import {
  clearConfigCache,
  isFolderHidden,
  isFolderSelfHidden,
  isFolderMetadataFile,
  readFolderMetadata,
  resolveFolderPath,
  resolveFolderThumbnail,
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

describe("readFolderMetadata", () => {
  let warn;
  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("returns null when the folder has no metadata file", () => {
    expect(readFolderMetadata(source)).toEqual({ metadata: null, sources: [] });
  });

  it("reads metadata.yml", async () => {
    await writeFile(join(source, "metadata.yml"), "label: Rules\nhidden: false\ntags:\n  - a\n");
    expect(readFolderMetadata(source).metadata).toEqual({ label: "Rules", hidden: false, tags: ["a"] });
  });

  it("merges the files key by key, metadata.yml > metadata.json > config.json", async () => {
    await writeFile(join(source, "config.json"), JSON.stringify({ a: 1, b: 1, c: 1 }));
    await writeFile(join(source, "metadata.json"), JSON.stringify({ a: 2, b: 2 }));
    await writeFile(join(source, "metadata.yml"), "a: 3\n");
    const { metadata, sources } = readFolderMetadata(source);
    expect(metadata).toEqual({ a: 3, b: 2, c: 1 });
    expect(sources).toEqual(["metadata.yml", "metadata.json", "config.json"]);
  });

  it("hides a folder from metadata.yml, as config.json does", async () => {
    const dir = join(source, "secret");
    await mkdir(dir);
    await writeFile(join(dir, "metadata.yml"), "hidden: true\n");
    expect(isFolderSelfHidden(dir)).toBe(true);
    expect(isFolderHidden(join(dir, "x.md"), source)).toBe(true);
  });

  it("skips a file that does not parse to a mapping, with a warning", async () => {
    await writeFile(join(source, "metadata.yml"), "- just\n- a list\n");
    await writeFile(join(source, "metadata.json"), JSON.stringify({ ok: true }));
    expect(readFolderMetadata(source).metadata).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("metadata.yml"));
  });
});

describe("isFolderMetadataFile", () => {
  it("names the three metadata files and nothing else", () => {
    expect(["metadata.yml", "metadata.json", "config.json"].every(isFolderMetadataFile)).toBe(true);
    expect(isFolderMetadataFile("metadata.md")).toBe(false);
    expect(isFolderMetadataFile("index.yml")).toBe(false);
  });
});

describe("resolveFolderThumbnail", () => {
  it("resolves a relative path against the folder and a leading slash against the docroot", () => {
    expect(resolveFolderPath("campaigns/bnw", "img/bnw.webp")).toBe("/campaigns/bnw/img/bnw.webp");
    expect(resolveFolderPath("campaigns/bnw", "./img/bnw.webp")).toBe("/campaigns/bnw/img/bnw.webp");
    expect(resolveFolderPath("campaigns/bnw", "/img/everdew.png")).toBe("/img/everdew.png");
    expect(resolveFolderPath("", "cover.png")).toBe("/cover.png");
    expect(resolveFolderPath("x", "https://example.com/a.png")).toBe("https://example.com/a.png");
  });

  it("uses a thumb/thumbnail image when the metadata names none", () => {
    for (const name of ["thumb.jpg", "thumbnail.PNG", "thumb.jpeg", "thumbnail.webp", "thumb.svg", "thumb.gif"]) {
      expect(resolveFolderThumbnail({ dirRel: "a", metadata: null, fileNames: ["x.md", name] })).toEqual({
        thumbnail: `/a/${name}`,
        conflict: null,
      });
    }
    expect(resolveFolderThumbnail({ dirRel: "a", metadata: {}, fileNames: ["thumbs.png", "mythumb.png"] }).thumbnail).toBeNull();
  });

  it("prefers the metadata value and reports the conflict", () => {
    expect(resolveFolderThumbnail({ dirRel: "a", metadata: { thumbnail: "cover.png" }, fileNames: ["thumb.png"] })).toEqual({
      thumbnail: "/a/cover.png",
      conflict: { explicit: "cover.png", image: "thumb.png" },
    });
  });
});
