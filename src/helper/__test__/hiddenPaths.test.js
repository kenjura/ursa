import {
  HIDDEN_OR_SYSTEM_DIRS,
  HIDDEN_OR_SYSTEM_DIRS_DEV,
  isHiddenOrSystemPath,
  toSourceRelative,
} from "../hiddenPaths.js";

describe("toSourceRelative", () => {
  it("strips the docroot and keeps a leading separator", () => {
    expect(toSourceRelative("/srv/site/a/b.md", "/srv/site")).toBe("/a/b.md");
  });

  it("does not care whether the docroot has a trailing slash", () => {
    expect(toSourceRelative("/srv/site/a.md", "/srv/site/")).toBe("/a.md");
    expect(toSourceRelative("/srv/site/a.md", "/srv/site")).toBe("/a.md");
  });

  it("returns '/' for the docroot itself", () => {
    expect(toSourceRelative("/srv/site", "/srv/site")).toBe("/");
    expect(toSourceRelative("/srv/site/", "/srv/site")).toBe("/");
  });

  it("passes through a path outside the docroot unchanged", () => {
    expect(toSourceRelative("/elsewhere/a.md", "/srv/site")).toBe(
      "/elsewhere/a.md"
    );
  });
});

describe("isHiddenOrSystemPath", () => {
  it("hides a dot-folder inside the docroot", () => {
    expect(isHiddenOrSystemPath("/srv/site/.drafts/a.md", "/srv/site")).toBe(
      true
    );
  });

  it("hides a dot-folder nested inside the docroot", () => {
    expect(isHiddenOrSystemPath("/srv/site/a/.x/b.md", "/srv/site")).toBe(true);
  });

  it("hides node_modules and _templates inside the docroot", () => {
    expect(
      isHiddenOrSystemPath("/srv/site/node_modules/p/a.md", "/srv/site")
    ).toBe(true);
    expect(isHiddenOrSystemPath("/srv/site/_templates/a.md", "/srv/site")).toBe(
      true
    );
  });

  it("does not hide an ordinary article", () => {
    expect(isHiddenOrSystemPath("/srv/site/a/b.md", "/srv/site")).toBe(false);
  });

  /*
   * The regression this module exists for.
   *
   * Every one of these docroots is perfectly ordinary; only its ANCESTRY
   * contains a dot-directory. Testing the absolute path marked all of them
   * hidden, so `generate` classified zero articles, reported success, and wrote
   * an empty site.
   */
  it.each([
    ["a git worktree", "/Users/x/repo/.claude/worktrees/wt/docs/help"],
    ["a dotfile config dir", "/Users/x/.config/site"],
    ["~/.local", "/Users/x/.local/share/site"],
  ])("does not hide the docroot because of %s", (_label, root) => {
    expect(isHiddenOrSystemPath(`${root}/index.md`, root)).toBe(false);
    expect(isHiddenOrSystemPath(`${root}/api/action-api.md`, root)).toBe(false);
  });

  it("still hides a dot-folder inside a docroot that is itself under one", () => {
    const root = "/Users/x/repo/.claude/worktrees/wt/docs/help";
    expect(isHiddenOrSystemPath(`${root}/.drafts/a.md`, root)).toBe(true);
  });

  it("does not treat '..' as a hidden folder", () => {
    expect(isHiddenOrSystemPath("/srv/site/a/../b.md", "/srv/site")).toBe(false);
  });

  it("accepts an alternative pattern for the dev server", () => {
    const root = "/srv/site";
    // The dev pattern omits _templates, which dev mode does not process.
    expect(
      isHiddenOrSystemPath(
        `${root}/_templates/a.md`,
        root,
        HIDDEN_OR_SYSTEM_DIRS_DEV
      )
    ).toBe(false);
    expect(
      isHiddenOrSystemPath(`${root}/.x/a.md`, root, HIDDEN_OR_SYSTEM_DIRS_DEV)
    ).toBe(true);
  });

  it("exports patterns that are not sticky or global", () => {
    // A /g or /y regex would carry lastIndex between calls and answer
    // differently on alternate invocations.
    for (const re of [HIDDEN_OR_SYSTEM_DIRS, HIDDEN_OR_SYSTEM_DIRS_DEV]) {
      expect(re.global).toBe(false);
      expect(re.sticky).toBe(false);
    }
    const p = "/srv/site/.x/a.md";
    expect(isHiddenOrSystemPath(p, "/srv/site")).toBe(true);
    expect(isHiddenOrSystemPath(p, "/srv/site")).toBe(true);
  });
});
