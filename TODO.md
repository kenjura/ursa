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