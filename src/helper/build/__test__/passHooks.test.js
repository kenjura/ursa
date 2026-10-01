/**
 * The hooks other programs build on (ursa-server): which outputs a pass wrote
 * and deleted, a cache kept outside the docroot, and invalidate().
 */

import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm, readdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { createBuild } from "../pass.js";

let tempDir, source, meta, output;

const TEMPLATE = `<!DOCTYPE html><html><head><title>\${title}</title>\${styleLink}</head>
<body><nav>\${menu}</nav><article>\${body}</article><footer>\${footer}</footer>\${customScript}</body></html>`;

async function put(root, rel, contents) {
  const full = join(root, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents);
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ursa-hooks-"));
  source = join(tempDir, "src");
  meta = join(tempDir, "meta");
  output = join(tempDir, "out");
  await put(meta, "templates/default-template/index.html", TEMPLATE);
  await put(source, "index.md", "# Home\n\nHello.\n");
  await put(source, "a.md", "# A\n\nAlpha.\n");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const opts = () => ({ source, meta, output, log: () => {}, directoryJson: false });

describe("written and deleted paths", () => {
  it("reports each output written, through the callback and the summary", async () => {
    const seen = [];
    const b = await createBuild({ ...opts(), onOutputWrite: (rel) => seen.push(rel) });
    const s = await b.runPass();
    await b.close();
    expect(s.writtenPaths).toContain("a.html");
    expect(s.writtenPaths).toContain("index.html");
    expect(s.writtenPaths.length).toBe(s.written);
    expect(new Set(seen)).toEqual(new Set(s.writtenPaths));
  });

  it("a warm pass reports only what changed, and deletions", async () => {
    let b = await createBuild(opts());
    await b.runPass();
    await b.close();

    await unlink(join(source, "a.md"));
    const deleted = [];
    b = await createBuild({ ...opts(), onOutputDelete: (rel) => deleted.push(rel) });
    const s = await b.runPass({ rescan: true });
    await b.close();
    expect(s.deletedPaths).toContain("a.html");
    expect(new Set(deleted)).toEqual(new Set(s.deletedPaths));
    expect(s.writtenPaths).not.toContain("a.html");
  });

  it("an unchanged warm pass writes nothing", async () => {
    let b = await createBuild(opts());
    await b.runPass();
    await b.close();
    b = await createBuild(opts());
    const s = await b.runPass({ rescan: true });
    await b.close();
    expect(s.writtenPaths).toEqual([]);
    expect(s.deletedPaths).toEqual([]);
  });
});

describe("cacheDir", () => {
  it("keeps the graph and build state out of the docroot, and warm-starts from it", async () => {
    const cacheDir = join(tempDir, "cache");
    let b = await createBuild({ ...opts(), cacheDir });
    await b.runPass();
    await b.close();
    expect(existsSync(join(source, ".ursa"))).toBe(false);
    expect(existsSync(join(source, ".ursa.json"))).toBe(false);
    expect(await readdir(cacheDir)).toEqual(expect.arrayContaining(["graph.json", "cache-stamp.json", "ursa.json"]));

    b = await createBuild({ ...opts(), cacheDir });
    const s = await b.runPass({ rescan: true });
    await b.close();
    expect(s.writtenPaths).toEqual([]);
  });

  it("refuses to clear a non-empty folder ursa did not write", async () => {
    const cacheDir = join(tempDir, "precious");
    await put(cacheDir, "keep.txt", "mine");
    await expect(createBuild({ ...opts(), cacheDir })).rejects.toThrow(/not an ursa cache/);
    await expect(createBuild({ ...opts(), cacheDir, clean: true })).rejects.toThrow(/not an ursa cache/);
    expect(existsSync(join(cacheDir, "keep.txt"))).toBe(true);
  });
});

describe("invalidate()", () => {
  it("marks changed files for the next pass without a rescan", async () => {
    const b = await createBuild(opts());
    await b.runPass();
    await put(source, "a.md", "# A\n\nAlpha, edited.\n");
    b.invalidate([join(source, "a.md")]);
    const s = await b.runPass();
    expect(s.writtenPaths).toContain("a.html");

    // A new folder: one event for the directory finds the files inside it
    await put(source, "sub/b.md", "# B\n");
    b.invalidate([join(source, "sub")]);
    const s2 = await b.runPass();
    expect(s2.writtenPaths).toContain("sub/b.html");
    await b.close();
  });
});
