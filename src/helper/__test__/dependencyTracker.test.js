import { join } from "path";
import { mkdtemp, rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import {
  DependencyTracker,
  loadDependencyTracker,
  saveDependencyTracker,
  getDependencyGraphPath,
} from "../dependencyTracker.js";

let tempDir;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ursa-deptracker-"));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeTracker(sourceDir) {
  const tracker = new DependencyTracker();
  tracker.init(sourceDir);
  return tracker;
}

describe("serialize / load", () => {
  it("round-trips registrations through serialize + load", () => {
    const t1 = makeTracker("/site/docs");
    t1.registerDocument("/site/docs/a.md", {
      templateName: "default-template",
      cssPaths: ["/site/docs/style.css"],
      scriptPaths: ["/site/docs/script.js"],
    });
    t1.registerDocument("/site/docs/sub/b.md", {
      templateName: "wiki",
      cssPaths: ["/site/docs/style.css", "/site/docs/sub/style.css"],
    });

    const data = JSON.parse(JSON.stringify(t1.serialize()));
    const t2 = makeTracker("/site/docs");
    expect(t2.load(data)).toBe(true);

    expect([...t2.getAffectedDocuments("/site/docs/style.css")].sort()).toEqual([
      "/site/docs/a.md",
      "/site/docs/sub/b.md",
    ]);
    expect([...t2.getDocumentsUsingTemplate("wiki")]).toEqual(["/site/docs/sub/b.md"]);
    expect(t2.getStats()).toEqual(t1.getStats());
  });

  it("merges with current-run registrations, which take precedence", () => {
    const t1 = makeTracker("/site/docs");
    t1.registerDocument("/site/docs/a.md", { templateName: "old-template" });
    t1.registerDocument("/site/docs/b.md", { templateName: "default-template" });
    const persisted = t1.serialize();

    // New run: a.md was re-rendered with a different template before load
    const t2 = makeTracker("/site/docs");
    t2.registerDocument("/site/docs/a.md", { templateName: "new-template" });
    expect(t2.load(persisted)).toBe(true);

    // Live registration wins; persisted fills in the hash-skipped doc
    expect([...t2.getDocumentsUsingTemplate("new-template")]).toEqual(["/site/docs/a.md"]);
    expect([...t2.getDocumentsUsingTemplate("old-template")]).toEqual([]);
    expect([...t2.getDocumentsUsingTemplate("default-template")]).toEqual(["/site/docs/b.md"]);
  });

  it("rejects mismatched schema versions and source dirs", () => {
    const t = makeTracker("/site/docs");
    expect(t.load(null)).toBe(false);
    expect(t.load({ version: 99, documents: {} })).toBe(false);
    const other = makeTracker("/different/source").serialize();
    other.documents["/different/source/a.md"] = ["template:default-template"];
    expect(t.load(other)).toBe(false);
    expect(t.getStats().totalDocuments).toBe(0);
  });
});

describe("prune", () => {
  it("drops registrations for documents not in the keep set", () => {
    const t = makeTracker("/site/docs");
    t.registerDocument("/site/docs/keep.md", { cssPaths: ["/site/docs/style.css"] });
    t.registerDocument("/site/docs/deleted.md", { cssPaths: ["/site/docs/style.css"] });

    t.prune(new Set(["/site/docs/keep.md"]));

    expect([...t.getAffectedDocuments("/site/docs/style.css")]).toEqual(["/site/docs/keep.md"]);
    expect(t.getStats().totalDocuments).toBe(1);
  });
});

describe("file persistence helpers", () => {
  it("saves to and loads from .ursa/dependency-graph.json", async () => {
    const t1 = makeTracker(tempDir);
    t1.registerDocument(join(tempDir, "a.md"), {
      templateName: "default-template",
      cssPaths: [join(tempDir, "style.css")],
    });
    expect(await saveDependencyTracker(tempDir, t1)).toBe(true);
    expect(existsSync(getDependencyGraphPath(tempDir))).toBe(true);
    const onDisk = JSON.parse(await readFile(getDependencyGraphPath(tempDir), "utf8"));
    expect(onDisk.version).toBe(1);

    const t2 = makeTracker(tempDir);
    expect(await loadDependencyTracker(tempDir, t2)).toBe(true);
    expect([...t2.getAffectedDocuments(join(tempDir, "style.css"))]).toEqual([
      join(tempDir, "a.md"),
    ]);
  });

  it("returns false when no persisted graph exists", async () => {
    const t = makeTracker(tempDir);
    expect(await loadDependencyTracker(tempDir, t)).toBe(false);
  });
});

describe("getMetaInvalidationPlan", () => {
  it("does not force a full rebuild for static assets in meta", () => {
    const t = makeTracker("/site/docs");
    t.registerDocument("/site/docs/a.md", { templateName: "default-template" });

    for (const file of ["logo.png", "font.woff2", "manual.pdf", "icon.SVG"]) {
      const plan = t.getMetaInvalidationPlan(`/site/meta/shared/${file}`, "/site/meta");
      expect(plan.requiresFullRebuild).toBe(false);
      expect(plan.affectedDocuments).toEqual([]);
    }
  });

  it("still regenerates documents for template and css/js meta changes", () => {
    const t = makeTracker("/site/docs");
    t.registerDocument("/site/docs/a.md", { templateName: "default-template" });

    // New folder structure: templates/{name}/index.html → name from the folder
    const tplPlan = t.getMetaInvalidationPlan(
      "/site/meta/templates/default-template/index.html",
      "/site/meta"
    );
    expect(tplPlan.requiresFullRebuild).toBe(false);
    expect(tplPlan.affectedDocuments).toEqual(["/site/docs/a.md"]);

    // Legacy flat structure: {name}.html at the meta root
    const legacyPlan = t.getMetaInvalidationPlan(
      "/site/meta/default-template.html",
      "/site/meta"
    );
    expect(legacyPlan.requiresFullRebuild).toBe(false);
    expect(legacyPlan.affectedDocuments).toEqual(["/site/docs/a.md"]);

    const cssPlan = t.getMetaInvalidationPlan("/site/meta/shared/theme.css", "/site/meta");
    expect(cssPlan.requiresFullRebuild).toBe(false);
    expect(cssPlan.affectedDocuments).toEqual(["/site/docs/a.md"]);

    // Unknown meta file types still fall back to a full rebuild
    const unknownPlan = t.getMetaInvalidationPlan("/site/meta/shared/data.json", "/site/meta");
    expect(unknownPlan.requiresFullRebuild).toBe(true);
  });
});
