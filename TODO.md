# 0.67.0


## New feature: custom menu parameters
When definining a custom menu (menu.md), you can now specify additional parameters in the frontmatter of each menu item.
- auto-generate-menu: boolean (default: false) - when true, the menu item will be auto-generated based on the folder contents (similar to existing auto-index feature)
- menu-position: 'top' | 'side' (default: 'side') - specifies whether the menu item should appear in the top navigation bar or the side navigation bar.

The markup of the auto-generated menu should the same as the existing site menu, namely:
- The entire nav is in a <ul> element inside <nav> element
- Each menu item on a given level is an <li> element, with the link text in an <a> element
- Sub-menus are nested <ul> elements inside the parent <li>

For menu position 'top', the following is true:
- Render the menu in a new <nav id="nav-main-top"> which is in the position the search input currently occupies (at least in default-template.html)
- The style of the menu differs:
  - Top level elements are inline-block, stacking left-to-right (in ltr mode). Overflow should be clipped by the current container box of input#global-search.
  - Top-level elements with a submenu spawn a dropdown on hover, with submenu items stacked vertically. These are '2nd level' menus.
  - Sub-level menus of 2nd level menus are rendered as flyout menus to the right of the parent menu item on hover.
  - All level 1 items should occupy the full vertical height of the nav#nav-global container, with horizontal padding similar to the vertical padding (although vertical centering will probably be accomplished with line-height or flexbox rather than padding, but visually they should match).
  - All level 2+ items should have a similar, slightly smaller vertical size as the level 1 items.
  - The 'hit area' for the anchor tag should be the entire area of the LI including padding (less any sub-menus).
  - The z-index should be such that all top menu elements, of any level, appear above the main article content.
  - The search button, in this mode, will be pushed to the right side of the nav bar, just next to the profile button. When clicked, the search input will expand to the left, overlaying the menu items if necessary.
  - When this top menu is present, the side menu (nav#nav-global) should be hidden. However, it can be restored by clicking the 'hamburger' menu button in the top left corner, which will toggle the visibility of the side menu. This is useful for backing out of the current custom-menu domain.

## QOL Improvements
- [ ] In serve mode, whenever a document changes, all of its images will be checked and re-processed if necessary. This ensures that changes to images are reflected immediately without needing to restart the serve command.

### Dev Mode ✅
New command: `ursa dev`

In this mode, ursa does not pre-process the docroot. Instead, it immediately starts a web server, which renders individual documents on demand. Every page load should:
- Locate the requested document using the standard path resolution logic (e.g. /foo/bar -> docroot/foo/bar.md or docroot/foo/bar/index.md)
- Find all images in the document, and process them to generate previews if necessary (caching results to avoid re-processing unchanged images)
- Look up all linked documents to determine if they are active/inactive, to render the navigation correctly
- Find the nearest menu.md in the document's path or parent tree, or else fall back to the standard auto-menu

Some considerations for first-load performance:
- Search index will not be built prior to first render. Afterward, the search index will be built in the background. If the user attempts to search before the index is ready, it will show a message that search is still being prepared and to check back later. Once the search index is ready, it will be used for search queries as normal. This does not require a hard refresh.
- The main menu will not be pre-rendered, but built in the background after first render. When ready, it will be pushed to the client. Subsequent loads of the same document, or other documents in the same menu tree, will use the cached menu for first render, but will also do a quick check to see if anything changed.
- Custom styles will be processed for first render, but after rendering (if not the first render), the server will check for any changes to stylesheets in the document's path or parent tree. If changes are detected, it will re-process the styles and push updates to the client.

In the background, after the server is ready to serve, it does the following:
- Process the docroot tree and cache it, so that:
  - Future renders can determine active/inactive without file system lookups
  - The search index can be built and cached for faster search results
- Pre-scan for menu.md files and build a path → nearest menu mapping
- Build the auto-menu navigation structure for fallback when no menu.md exists
- Map directories to their nearest style.css for faster CSS lookups
- Pre-load and cache templates from meta directory
- Scan for config.json files that affect rendering (icons, hidden folders, etc.)
- Optionally: start processing image previews for unvisited documents to pre-warm cache


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

- [x] **Parallel markdown parsing**: Use worker threads for CPU-bound markdown/wikitext conversion
- [x] **Lazy metadata transform**: Defer `getTransformedMetadata` until needed (it may read files)
- [x] **Stream large files**: For very large markdown files, use streaming instead of loading entire file

### Search Index (5.7% - LOW PRIORITY)

- [x] **Incremental index updates**: Only re-index changed documents, merge with cached index
- [x] **Build index in background**: Start serving before search index is ready

### General Optimizations

- [ ] **Prioritize critical path**: In serve mode, generate requested document first, others in background
- [ ] **Smarter caching**: Extend hash cache to cover more phases (nav, search index, etc.)
- [ ] **Profile hot paths**: Add sub-phase timing within major phases to identify specific bottlenecks


## Custom Scripts ✅
Much like menu.md and style.css, script.js files can be placed in any directory and will be applied to all documents in that directory and its subdirectories. They will be processed and copied to the output directory, and included in the generated HTML. This allows for custom çJavaScript to be easily added on a per-folder basis.

These should be rendered using a simple script tag at the bottom of the body, with the exact contents of script.js.

In the future, we may consider supporting multiple scripts (for instance, script.js could load ES modules using relative paths, and ursa could serve these with the correct MIME type and caching). But for now, we will just support a single script.js per folder.

## MDX Support
Files in the docroot with the `.mdx` extension will be processed as MDX files, using mdx-bundler with React SSR to produce static HTML output. This allows for embedding React/JSX components directly in documentation.

### Example Usage
```
/campaigns/my-campaign/index.mdx
/campaigns/my-campaign/components/StatBlock.tsx
```

**index.mdx:**
```mdx
---
title: My Campaign
---
import { StatBlock } from './components/StatBlock.tsx'

# Welcome to My Campaign

Here's a monster stat block:

<StatBlock name="Goblin" hp={7} ac={15} />
```

### Implementation Tasks

#### Phase 1: Core MDX Rendering ✅
- [x] **Install dependencies**: Add `mdx-bundler`, `esbuild`, `react`, `react-dom` to package.json
- [x] **Create mdxRenderer.js**: New helper module that:
  - Uses `bundleMDX()` to compile MDX source with component imports
  - Uses `getMDXComponent()` to get the React component
  - Uses `renderToStaticMarkup()` to produce static HTML
  - Extracts frontmatter via mdx-bundler's built-in gray-matter support
- [x] **Add `.mdx` to file type detection**: Update classification in generate.js and dev.js to recognize `.mdx` files as articles
- [x] **Update fileRenderer.js**: Add case for `.mdx` that calls mdxRenderer

#### Phase 2: Component Resolution ✅
- [x] **Configure esbuild options**: Set up loaders for `.tsx`, `.ts`, `.jsx`, `.js`
- [x] **Set working directory**: Pass `cwd` to bundleMDX for relative import resolution
- [x] **Handle component paths**: Support imports from:
  - Same directory: `./MyComponent.tsx`
  - Components subfolder: `./components/MyComponent.tsx`
  - Absolute paths from docroot: `/shared/components/MyComponent.tsx`

#### Phase 3: Integration with Build Pipeline ✅
- [x] **Update generate.js**: Process `.mdx` files in article batch processing
- [x] **Update dev.js**: Handle `.mdx` files in on-demand rendering
- [x] **Metadata extraction**: Ensure frontmatter from MDX files works with existing metadata pipeline
- [x] **Link validation**: Ensure internal links in MDX content are validated like MD files

#### Phase 4: Search and Navigation ✅
- [x] **Search indexing**: Include MDX content in full-text search index
- [x] **Menu generation**: Include `.mdx` files in auto-menu generation
- [x] **Valid paths**: Add `.mdx` source files to valid paths for link checking

#### Phase 5: Error Handling and DX ✅
- [x] **Compilation errors**: Display helpful error messages when MDX/component compilation fails
- [x] **Missing component errors**: Clear error when imported component doesn't exist
- [x] **TypeScript support**: Ensure TSX components compile without separate tsconfig
- [x] **Hot reload**: In dev mode, detect changes to both `.mdx` files and imported components

#### Phase 6: Optional Enhancements
- [ ] **Shared components**: Support a global `_components/` directory for site-wide components
- [ ] **MDX plugins**: Allow remark/rehype plugins via config
- [ ] **Client hydration opt-in**: For interactive components, optionally include React runtime and hydrate






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