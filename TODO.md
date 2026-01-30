# 0.62.0

- [x] Add support for auto-index in a defined index document, rather than only when index document is absent.
- [x] Auto-index has configurable depth and placement (top/bottom).
- [x] Serve command will wait to generate images until HTML files are generated and served.
- [x] Bug: serve a docs folder with no style.css at the root. Add a style.css. Expected: on reload, style changes are visible. Observed: styles do not change until serve command is restarted. Note that 'copied style.css' is shown in server logs, but the HTML does not load this stylesheet (until restart).
- [x] Bug: when generating auto-index at root level, the HREFs are incorrect (missing leading slash).
- [x] Bug: When re-generating an index document with generate-auto-index:true, the new html doesn't have the auto-index. Restarting the serve command fixes the issue.
- [x] Auto-indexer no longer renders 'img' folders


# 0.61.0

- Image Handling
  - [x] When an image tag is encountered, and the image is found in the static assets:
    - [x] Process the image to a preview size (max width/height == article width (50rem) or px equivalent), and convert to webp with reasonable compression. Copy the original image as well as the preview.
    - [x] Generate the HTML img tag as is currently done, but:
      - [x] Use the preview image as the src
      - [x] Use the original image as the data-fullsrc attribute
      - [x] On click, open the original image in a new tab


# 0.60.0

- [ ] Change the way index.md is positioned in the menu
- [ ] Markdown files can specify menu-label in the frontmatter to override their menu label
- [ ] Folder index.md files can specify menu-label in the frontmatter to override their menu label

# 0.57.0

- [x] All links in generated html will be full links with extensions (e.g. /folder/page.html)
- [x] Restore missing folder icons (config.json)
- [ ] Fix menu depth issue (sometimes /foo/bar expands bar, sometimes foo)

# Basic Functionality

- [x] Enable static assets from meta in build (perhaps by copying them?)
- [x] Enable static assets from source in build
- [ ] Handle menus at different levels
- [x] Add a live-serve command that translates from source in real time (for testing)
- [ ] Deal with crashes when no menu file is found


# Wikitext
- [ ] Support original site styles
- [ ] Support original menu
- [ ] Fix links

# Mobile UI
- [ ] Konsta UI