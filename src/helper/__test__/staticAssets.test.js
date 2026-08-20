import {
  isImage,
  isMedia,
  isStaticAsset,
} from "../staticAssets.js";

describe("staticAssets", () => {
  it("treats the image formats as images", () => {
    for (const f of ["a.jpg", "a.jpeg", "a.PNG", "a.gif", "a.webp", "a.svg", "a.ico"]) {
      expect(isImage(f)).toBe(true);
      expect(isMedia(f)).toBe(false);
    }
  });

  // The regression this module exists for: generate() copied images and HTML
  // and nothing else, so every one of these 404'd in a built site.
  it("treats fonts, audio, video and documents as media", () => {
    for (const f of ["a.woff", "a.woff2", "a.ttf", "a.eot", "a.otf", "a.pdf",
      "a.mp3", "a.m4a", "a.wav", "a.flac", "a.mp4", "a.m4v", "a.webm", "a.ogv", "a.ogg", "a.zip"]) {
      expect(isMedia(f)).toBe(true);
      expect(isImage(f)).toBe(false);
    }
  });

  it("counts both as static assets", () => {
    expect(isStaticAsset("clip.mp4")).toBe(true);
    expect(isStaticAsset("Herculanum Regular.ttf")).toBe(true);
    expect(isStaticAsset("photo.jpg")).toBe(true);
  });

  it("leaves the processed formats alone", () => {
    for (const f of ["page.md", "page.mdx", "page.html", "style.css", "script.js", "data.json"]) {
      expect(isStaticAsset(f)).toBe(false);
    }
  });

  it("matches on the extension, not on a name that merely contains one", () => {
    expect(isStaticAsset("mp4")).toBe(false);
    expect(isStaticAsset("notes-about-mp4-encoding.md")).toBe(false);
    expect(isStaticAsset("my.mp4.md")).toBe(false);
  });

  it("is case insensitive, as filesystems are not", () => {
    expect(isStaticAsset("CLIP.MP4")).toBe(true);
    expect(isStaticAsset("Font.TTF")).toBe(true);
  });
});
