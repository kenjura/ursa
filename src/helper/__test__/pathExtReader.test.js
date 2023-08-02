import { hasExt } from "../pathExtReader.js";
// import { expect } from "chai";

describe("hasExt", () => {
  it("returns true for /foo/bar.html", () => {
    expect(hasExt("/foo/bar.html")).toEqual(true);
  });
  it("returns true for /foo/bar.md", () => {
    expect(hasExt("/foo/bar.md")).toEqual(true);
  });
  it("returns true for /foo/bar.json", () => {
    expect(hasExt("/foo/bar.json")).toEqual(true);
  });
  it("returns true for /bar.html", () => {
    expect(hasExt("/bar.html")).toEqual(true);
  });
  it("returns true for /bar.html?query=string#anchor", () => {
    expect(hasExt("/bar.html?query=string#anchor")).toEqual(true);
  });
  it("returns false for /foo/bar", () => {
    expect(hasExt("/foo/bar")).toEqual(false);
  });
  it("returns false for /foo", () => {
    expect(hasExt("/foo")).toEqual(false);
  });
  it("returns false for /foo/bar.", () => {
    expect(hasExt("/foo/bar.")).toEqual(false);
  });
  it("returns false for /foo/bar?query=string#anchor", () => {
    expect(hasExt("/foo/bar?query=string#anchor")).toEqual(false);
  });
  it("returns false for /", () => {
    expect(hasExt("/")).toEqual(false);
  });
  it('returns false for ""', () => {
    expect(hasExt("")).toEqual(false);
  });
});
