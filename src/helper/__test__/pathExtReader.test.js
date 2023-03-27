import { hasExt } from "../pathExtReader.js";
import { expect } from "chai";

describe("hasExt", () => {
  it("returns true for /foo/bar.html", () => {
    expect(hasExt("/foo/bar.html")).to.eq(true);
  });
  it("returns true for /foo/bar.md", () => {
    expect(hasExt("/foo/bar.md")).to.eq(true);
  });
  it("returns true for /foo/bar.json", () => {
    expect(hasExt("/foo/bar.json")).to.eq(true);
  });
  it("returns true for /bar.html", () => {
    expect(hasExt("/bar.html")).to.eq(true);
  });
  it("returns true for /bar.html?query=string#anchor", () => {
    expect(hasExt("/bar.html?query=string#anchor")).to.eq(true);
  });
  it("returns false for /foo/bar", () => {
    expect(hasExt("/foo/bar")).to.eq(false);
  });
  it("returns false for /foo", () => {
    expect(hasExt("/foo")).to.eq(false);
  });
  it("returns false for /foo/bar.", () => {
    expect(hasExt("/foo/bar.")).to.eq(false);
  });
  it("returns false for /foo/bar?query=string#anchor", () => {
    expect(hasExt("/foo/bar?query=string#anchor")).to.eq(false);
  });
  it("returns false for /", () => {
    expect(hasExt("/")).to.eq(false);
  });
  it('returns false for ""', () => {
    expect(hasExt("")).to.eq(false);
  });
});
