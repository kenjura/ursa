/**
 * `generate({ _jsonOnly: true })` — emit the data files and nothing else.
 *
 * The load-bearing claim is not "fewer files": it is that the .json a JSON-only
 * build writes is byte-identical to the one a full build writes. Every step the
 * mode skips operates on the assembled page, never on the JSON. If that ever
 * stops being true, `identical to a full build's JSON` fails here rather than
 * silently shipping different data to a consumer.
 */

import { join } from "path";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { generate } from "../generate.js";
import { clearConfigCache } from "../../helper/folderConfig.js";

const META = join(process.cwd(), "meta");

let source;
let output;

async function doc(relPath, contents) {
  const full = join(source, relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents);
  return full;
}

beforeEach(async () => {
  source = await mkdtemp(join(tmpdir(), "ursa-jsononly-src-"));
  output = await mkdtemp(join(tmpdir(), "ursa-jsononly-out-"));
  clearConfigCache();

  await doc("index.md", "# Home\n\nWelcome.\n");
  await doc(
    "character/powers/absorb-magic.md",
    [
      "---",
      "class: Witch",
      "name: Absorb Magic",
      "school: Antimagic",
      "brief: Absorb energy from a touched spell",
      "---",
      "",
      "# Absorb Magic",
      "",
      "Touch a spell and take it apart.",
      "",
      "## Range",
      "",
      "Touch.",
      "",
    ].join("\n")
  );
  await doc("character/powers/mind-blast.md", "# Mind Blast\n\nA blast, of the mind.\n");
});

afterEach(async () => {
  await rm(source, { recursive: true, force: true });
  await rm(output, { recursive: true, force: true });
});

const run = (opts) =>
  generate({ _source: source, _meta: META, _output: output, _clean: true, ...opts });

describe("generate --json-only", () => {
  it("writes the document JSON", async () => {
    await run({ _jsonOnly: true });
    expect(existsSync(join(output, "character/powers/absorb-magic.json"))).toBe(true);
    expect(existsSync(join(output, "index.json"))).toBe(true);
  });

  it("writes the directory record lists, which are the point of the mode", async () => {
    await run({ _jsonOnly: true });
    const listPath = join(output, "character/powers.json");
    expect(existsSync(listPath)).toBe(true);

    const records = JSON.parse(await readFile(listPath, "utf8"));
    const absorb = records.find((r) => r.name === "absorb-magic");
    expect(absorb).toBeDefined();
    expect(absorb.url).toBe("/character/powers/absorb-magic.html");
    expect(absorb.metadata.school).toBe("Antimagic");
  });

  it("writes no HTML and no XML", async () => {
    await run({ _jsonOnly: true });
    expect(existsSync(join(output, "index.html"))).toBe(false);
    expect(existsSync(join(output, "character/powers/absorb-magic.html"))).toBe(false);
    expect(existsSync(join(output, "character/powers/absorb-magic.xml"))).toBe(false);
    // The directory listing page, distinct from the record list above.
    expect(existsSync(join(output, "character/powers.html"))).toBe(false);
  });

  it("writes no meta assets, search index, menu data or recent activity", async () => {
    await run({ _jsonOnly: true });
    expect(existsSync(join(output, "public", "search-index.json"))).toBe(false);
    expect(existsSync(join(output, "public", "fulltext-index.json"))).toBe(false);
    expect(existsSync(join(output, "public", "menu-data.json"))).toBe(false);
    expect(existsSync(join(output, "public", "recent-activity.json"))).toBe(false);
  });

  it("produces JSON identical to a full build's", async () => {
    await run({ _jsonOnly: true });
    const jsonOnly = await readFile(
      join(output, "character/powers/absorb-magic.json"),
      "utf8"
    );
    const jsonOnlyList = await readFile(join(output, "character/powers.json"), "utf8");

    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await run({ _jsonOnly: false });

    const full = await readFile(join(output, "character/powers/absorb-magic.json"), "utf8");
    const fullList = await readFile(join(output, "character/powers.json"), "utf8");

    expect(jsonOnly).toBe(full);
    expect(jsonOnlyList).toBe(fullList);
  });

  it("still emits everything on a normal build", async () => {
    await run({ _jsonOnly: false });
    expect(existsSync(join(output, "character/powers/absorb-magic.html"))).toBe(true);
    expect(existsSync(join(output, "character/powers/absorb-magic.xml"))).toBe(true);
    expect(existsSync(join(output, "public", "menu-data.json"))).toBe(true);
  });
});

describe("mixing modes against one source tree", () => {
  // The hash cache lives in the SOURCE tree and is shared by both modes, so the
  // per-document output check has to be mode-aware or one mode's cache entries
  // would convince the other that its own missing outputs are up to date.

  it("a full build after a JSON-only build still writes the HTML", async () => {
    await run({ _jsonOnly: true });
    expect(existsSync(join(output, "character/powers/absorb-magic.html"))).toBe(false);

    // Warm: no --clean, so the hash cache from the JSON-only run is in play.
    await generate({ _source: source, _meta: META, _output: output, _jsonOnly: false });
    expect(existsSync(join(output, "character/powers/absorb-magic.html"))).toBe(true);
    expect(existsSync(join(output, "character/powers/absorb-magic.xml"))).toBe(true);
  });

  it("a JSON-only build after a full build leaves the JSON in place", async () => {
    await run({ _jsonOnly: false });
    const before = await readFile(join(output, "character/powers/absorb-magic.json"), "utf8");

    await generate({ _source: source, _meta: META, _output: output, _jsonOnly: true });
    const after = await readFile(join(output, "character/powers/absorb-magic.json"), "utf8");

    expect(after).toBe(before);
  });
});
