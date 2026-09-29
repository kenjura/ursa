import {
  metadataToTable,
  injectFrontmatterTable,
  isRenderFrontmatterEnabled,
} from "../frontmatterTable.js";

describe("isRenderFrontmatterEnabled", () => {
  it("returns false for missing metadata", () => {
    expect(isRenderFrontmatterEnabled(null)).toBe(false);
    expect(isRenderFrontmatterEnabled(undefined)).toBe(false);
    expect(isRenderFrontmatterEnabled({})).toBe(false);
  });
  it("returns false when flag is missing", () => {
    expect(isRenderFrontmatterEnabled({ title: "Foo" })).toBe(false);
  });
  it("returns false when flag is false", () => {
    expect(isRenderFrontmatterEnabled({ "render-frontmatter": false })).toBe(false);
  });
  it("returns true when flag is boolean true", () => {
    expect(isRenderFrontmatterEnabled({ "render-frontmatter": true })).toBe(true);
  });
  it("returns true when flag is the string 'true'", () => {
    expect(isRenderFrontmatterEnabled({ "render-frontmatter": "true" })).toBe(true);
  });
});

describe("injectFrontmatterTable", () => {
  const body = "<h1>Title</h1>\n<p>Body</p>";

  it("does not inject when render-frontmatter flag is missing", () => {
    const result = injectFrontmatterTable(body, { type: "power", cost: 3 });
    expect(result).toBe(body);
    expect(result).not.toContain("ursa-frontmatter");
  });

  it("does not inject when render-frontmatter is false", () => {
    const result = injectFrontmatterTable(body, {
      "render-frontmatter": false,
      type: "power",
    });
    expect(result).toBe(body);
  });

  it("injects table after first H1 when render-frontmatter is true", () => {
    const result = injectFrontmatterTable(body, {
      "render-frontmatter": true,
      type: "power",
      cost: 3,
    });
    expect(result).toContain('<dl class="ursa-frontmatter">');
    expect(result).toContain("<dt>Type</dt>");
    expect(result).toContain("<dd>power</dd>");
    // Table appears after the </h1>
    expect(result.indexOf("</h1>")).toBeLessThan(result.indexOf("ursa-frontmatter"));
  });

  it("accepts string 'true' for the flag", () => {
    const result = injectFrontmatterTable(body, {
      "render-frontmatter": "true",
      type: "power",
    });
    expect(result).toContain('<dl class="ursa-frontmatter">');
  });

  it("does not include render-frontmatter itself as a row", () => {
    const result = injectFrontmatterTable(body, {
      "render-frontmatter": true,
      type: "power",
    });
    expect(result).not.toContain(">Render Frontmatter<");
  });

  it("returns body unchanged when no displayable entries exist", () => {
    const result = injectFrontmatterTable(body, {
      "render-frontmatter": true,
      title: "ignored",
    });
    expect(result).toBe(body);
  });
});

describe("metadataToTable", () => {
  it("still produces a table when called directly (used by other consumers)", () => {
    const html = metadataToTable({ type: "power", cost: 3 });
    expect(html).toContain('<dl class="ursa-frontmatter">');
    expect(html).toContain("<dt>Type</dt>");
  });
});
