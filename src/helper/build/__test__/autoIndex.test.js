import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { generateAutoIndices } from "../autoIndex.js";

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
