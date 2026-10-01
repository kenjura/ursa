import { join } from "path";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import {
  isBuildConfigPath,
  loadBuildConfig,
  mergeBuildOptions,
  parseDirectoryDepth,
} from "../buildConfig.js";

let dir;
const warnings = [];
const warn = (m) => warnings.push(m);
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ursa-buildconfig-"));
  warnings.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isBuildConfigPath", () => {
  it("is true for an existing .json/.yml/.yaml file, false for a directory or a missing file", async () => {
    await writeFile(join(dir, "prod.yml"), "source: docs\n");
    await mkdir(join(dir, "docs.json")); // a directory that happens to end in .json
    expect(isBuildConfigPath(join(dir, "prod.yml"))).toBe(true);
    expect(isBuildConfigPath(join(dir, "docs.json"))).toBe(false);
    expect(isBuildConfigPath(join(dir, "missing.yml"))).toBe(false);
    expect(isBuildConfigPath(dir)).toBe(false);
  });
});

describe("loadBuildConfig", () => {
  it("reads YAML, resolving paths against the config file's folder", async () => {
    const path = join(dir, "prod.yml");
    await writeFile(
      path,
      "source: docs\noutput: ../site\nmeta: /abs/meta\nexclude: [legacy/a, legacy/b]\njson-only: true\ndirectory-depth: 2\n"
    );
    expect(loadBuildConfig(path, { warn })).toEqual({
      source: join(dir, "docs"),
      output: join(dir, "..", "site"),
      meta: "/abs/meta",
      exclude: "legacy/a,legacy/b",
      "json-only": true,
      "directory-depth": 2,
    });
  });

  it("reads JSON and accepts camelCase keys", async () => {
    const path = join(dir, "dev.json");
    await writeFile(path, JSON.stringify({ source: "docs", strictPort: true, port: 3000, directoryJson: false }));
    expect(loadBuildConfig(path, { command: "serve", warn })).toEqual({
      source: join(dir, "docs"),
      "strict-port": true,
      port: 3000,
      "directory-json": false,
    });
  });

  it("warns about unknown keys and keys for the other command", async () => {
    const path = join(dir, "c.yml");
    await writeFile(path, "source: docs\nport: 3000\nwat: 1\n");
    expect(loadBuildConfig(path, { command: "generate", warn })).toEqual({ source: join(dir, "docs") });
    expect(warnings.join("\n")).toMatch(/unknown option "wat"/);
    expect(warnings.join("\n")).toMatch(/"port" has no effect on `ursa generate`/);
  });

  it("rejects a wrongly typed value", async () => {
    const path = join(dir, "c.yml");
    await writeFile(path, "clean: yes please\n");
    expect(() => loadBuildConfig(path, { warn })).toThrow(/clean must be true or false/);
  });
});

describe("parseDirectoryDepth", () => {
  it("accepts integers and spellings of unlimited", () => {
    expect(parseDirectoryDepth(0)).toBe(0);
    expect(parseDirectoryDepth("3")).toBe(3);
    for (const v of [null, undefined, "infinite", "Infinity", "unlimited", -1, "-1"]) {
      expect(parseDirectoryDepth(v)).toBe(Infinity);
    }
    expect(() => parseDirectoryDepth(1.5)).toThrow();
    expect(() => parseDirectoryDepth("deep")).toThrow();
  });
});

describe("mergeBuildOptions", () => {
  it("layers defaults < file < command line", () => {
    const merged = mergeBuildOptions(
      { source: "/site/docs", output: "/site/out", port: 3000, clean: true },
      { port: 4000, output: "build", source: undefined },
      "/cwd"
    );
    expect(merged).toMatchObject({
      source: "/site/docs",
      output: "/cwd/build",
      port: 4000,
      clean: true,
      explain: false,
      "directory-json": true,
      "directory-depth": Infinity,
    });
  });

  it("defaults output to ./output under the working directory", () => {
    expect(mergeBuildOptions({}, { source: "docs" }, "/cwd")).toMatchObject({ source: "/cwd/docs", output: "/cwd/output" });
  });
});
