# 0.67.0

## Performance Improvements

Based on profiling of full docroot (no whitelist):
- Process images: 54.4% (23.42s)
- Build navigation: 21.4% (9.22s)
- Process articles: 15.2% (6.56s)
- Write search index: 5.7% (2.44s)
- Process directories: 2.8% (1.19s)

### Image Processing (54.4% - TOP PRIORITY)

- [x] **Cache processed images**: Skip re-processing images that haven't changed (check mtime/size)
- [x] **Parallel image processing**: Use worker threads or increase batch concurrency for CPU-bound sharp operations
- [x] **Skip preview for small images**: Don't generate preview if original is already smaller than preview size
- [x] **Lazy preview generation**: In serve mode, generate previews on-demand when first requested rather than upfront

### Build Navigation (21.4% - HIGH PRIORITY)

- [x] **Cache navigation structure**: Store nav tree in .ursa folder, only rebuild when file list changes
- [x] **Incremental nav updates**: When single file changes, patch nav tree instead of full rebuild
- [x] **Simplify path matching**: Profile `buildNavigation` to find slow regex/loops; consider trie structure

### Process Articles (15.2% - MEDIUM PRIORITY)

- [ ] **Parallel markdown parsing**: Use worker threads for CPU-bound markdown/wikitext conversion
- [ ] **Lazy metadata transform**: Defer `getTransformedMetadata` until needed (it may read files)
- [ ] **Stream large files**: For very large markdown files, use streaming instead of loading entire file

### Search Index (5.7% - LOW PRIORITY)

- [ ] **Incremental index updates**: Only re-index changed documents, merge with cached index
- [ ] **Build index in background**: Start serving before search index is ready

### General Optimizations

- [ ] **Prioritize critical path**: In serve mode, generate requested document first, others in background
- [ ] **Smarter caching**: Extend hash cache to cover more phases (nav, search index, etc.)
- [ ] **Profile hot paths**: Add sub-phase timing within major phases to identify specific bottlenecks


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