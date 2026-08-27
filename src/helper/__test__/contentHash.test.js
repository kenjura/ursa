import { join } from "path";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import {
  enforceCacheVersion,
  getUrsaDir,
  loadHashCache,
  saveHashCache,
} from "../contentHash.js";

let sourceDir;
beforeEach(async () => {
  sourceDir = await mkdtemp(join(tmpdir(), "ursa-cachestamp-"));
});
afterEach(async () => {
  await rm(sourceDir, { recursive: true, force: true });
});

/** Write a populated `.ursa/` as an older build of ursa would have left it. */
async function seedCache(stampVersion) {
  const ursaDir = getUrsaDir(sourceDir);
  await mkdir(ursaDir, { recursive: true });
  await saveHashCache(sourceDir, new Map([["/site/a.md", "abc123"]]));
  if (stampVersion !== null) {
    await writeFile(
      join(ursaDir, "cache-stamp.json"),
      JSON.stringify({ ursaVersion: stampVersion })
    );
  }
}

describe("enforceCacheVersion", () => {
  it("stamps a first build without reporting a reset", async () => {
    const result = await enforceCacheVersion(sourceDir, "1.0.0");

    expect(result).toEqual({ reset: false, previous: null, version: "1.0.0" });
    const stamp = JSON.parse(
      await readFile(join(getUrsaDir(sourceDir), "cache-stamp.json"), "utf8")
    );
    expect(stamp.ursaVersion).toBe("1.0.0");
  });

  it("keeps the cache when the stamp matches", async () => {
    await seedCache("1.0.0");

    const result = await enforceCacheVersion(sourceDir, "1.0.0");

    expect(result.reset).toBe(false);
    expect(await loadHashCache(sourceDir)).toEqual(
      new Map([["/site/a.md", "abc123"]])
    );
  });

  it("discards the cache when ursa has been upgraded", async () => {
    await seedCache("1.0.0");

    const result = await enforceCacheVersion(sourceDir, "1.1.0");

    expect(result).toEqual({ reset: true, previous: "1.0.0", version: "1.1.0" });
    expect(await loadHashCache(sourceDir)).toEqual(new Map());
  });

  it("discards the cache when ursa has been downgraded", async () => {
    await seedCache("1.1.0");

    const result = await enforceCacheVersion(sourceDir, "1.0.0");

    expect(result.reset).toBe(true);
    expect(await loadHashCache(sourceDir)).toEqual(new Map());
  });

  it("discards a cache left by a version that predates stamping", async () => {
    await seedCache(null);

    const result = await enforceCacheVersion(sourceDir, "1.0.0");

    expect(result).toEqual({ reset: true, previous: null, version: "1.0.0" });
    expect(await loadHashCache(sourceDir)).toEqual(new Map());
  });

  it("discards the cache when the stamp is unreadable", async () => {
    await seedCache("1.0.0");
    await writeFile(join(getUrsaDir(sourceDir), "cache-stamp.json"), "not json");

    const result = await enforceCacheVersion(sourceDir, "1.0.0");

    expect(result.reset).toBe(true);
    expect(await loadHashCache(sourceDir)).toEqual(new Map());
  });

  it("leaves a stamp that the next run accepts", async () => {
    await seedCache("1.0.0");

    await enforceCacheVersion(sourceDir, "1.1.0");
    await saveHashCache(sourceDir, new Map([["/site/a.md", "def456"]]));
    const second = await enforceCacheVersion(sourceDir, "1.1.0");

    expect(second.reset).toBe(false);
    expect(await loadHashCache(sourceDir)).toEqual(
      new Map([["/site/a.md", "def456"]])
    );
  });

  it("removes every cache file in .ursa, not just the hashes", async () => {
    await seedCache("1.0.0");
    const navCache = join(getUrsaDir(sourceDir), "nav-cache.json");
    await writeFile(navCache, JSON.stringify({ stale: true }));

    await enforceCacheVersion(sourceDir, "1.1.0");

    expect(existsSync(navCache)).toBe(false);
  });
});
