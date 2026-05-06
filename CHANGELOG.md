# 0.82.0
2026-05-06

- **Frontmatter table is now opt-in**: The HTML frontmatter table that was previously injected into every Markdown/MDX document after the first H1 is now only rendered when the document's frontmatter sets `render-frontmatter: true` (boolean `true` or string `"true"`). Documents without the flag (or with it set to `false`) no longer have the table injected. The `render-frontmatter` key itself is excluded from the rendered table.

# 0.81.4
2026-05-04

- bug fix: directory index html files were never being written...impossibly, but there it is

# 0.81.3
2026-04-14

- bug fix: When script.js changes in serve mode, the bundle cache wasn't being cleared, so documents kept using stale bundles.
  - Added clearScriptCache() and clearStyleCache() functions in generate.js
  - Updated serve.js to call these functions when CSS/JS files change


# 0.81.2
2026-03-28

- MDX hydration: MDX documents now support hydration of embedded React components, allowing for interactive content within static pages.

- **Fixed Recent Activity tracking**: The Recent Activity widget now properly tracks when document content actually changed, rather than relying on file system modification times (mtime). 
  - Previously, Recent Activity used filesystem mtime, which doesn't work correctly after git clone (git doesn't preserve timestamps) or when all files are built simultaneously.
  - Now, content change timestamps are stored in `.ursa.json` (in the source directory), which:
    - Survives `--clean` builds (unlike the `.ursa/` cache folder)
    - Can be committed to git to preserve wiki history across clones
    - Falls back to file mtime for files that haven't been tracked yet (backward compatibility)
  - Both full builds and single-file regeneration (serve/dev mode) now update content timestamps when content actually changes (detected by hash comparison).

# 0.80.1
2026-02-16

- Fixed package.json issue

# 0.80.0
2026-02-16

- Added remark extensions to ensure MDX has the same extended markdown features as regular markdown (e.g. footnotes, definition lists, etc.)

# 0.79.0
2026-02-14

- Menu fixes:
  - Zero-item submenus will no longer be hidden if they have subfolders with one+ item
  - Bug fix for missing menu items
  - Level 2+ menus now have overflow:scroll (vertical only)

# 0.78.0
2026-02-13

- added release-it
- --clean now fully deletes the .ursa cache folder and clears the output directory before generation, ensuring a completely fresh build without any stale files. Previously, --clean only ignored the cache but left existing output files in place, which could cause issues with stale auto-generated indexes and other files blocking new generation. This change provides a more robust clean build experience.

# 0.77.0
2026-02-13

QOL:
- When 'serve' encounters an occupied port 8080, prompt the user to find an available port instead of just exiting with an error. Will check open ports and find the closest port to 8080, then ask the user if they want to use it.

Meta cleanup:
- Templates should have their own folder, including default
- All static files for a template should be in the template's folder, and probably in the right subfolder (e.g. public/default.css should be in templates/default/public/default.css or something like that).
- Template filenames should be templates/{templateName}/index.html
- Ursa should throw a warning if it finds orphaned static files in meta that aren't referenced by a template

Static assets revamp:
- Revamped the building of static assets (stylesheets and scripts). The new logic is:
  - All meta scripts and stylesheets should be bundled together into a single CSS file and a single JS file for the entire site. This applies to build mode; in dev mode, they are served individually for easier debugging and regeneration.
  - Bundle-able document files (style.css, script.js, menu.md) will be bundled together on a per-folder basis. Each document will include the bundles from its own folder and all parent folders (where they exist).

Regeneration revamp:
- Existing logic:
  - On first generation, save a cache of document output given some sort of hash of the source file and metadata (e.g. mtime, size, etc.)
    - All static files (meta and document) should include a datetime or hash-based cache-buster in their query strings / filenames, so they can be invalidated as needed
  - On subsequent generations, if the source file's hash is unchanged, skip regeneration and reuse the existing output file. (Note: this doesn't handle cases where the statis files changed and the document didn't; see below)
  - Push a notification to the client when a file is regenerated, so the client can update the page if it's currently being viewed
- New logic is as above, plus: (some of this is partially complete, but these are the complete requirements)
  - When any file being watched is changed, determine the list of affected files. For instance:
    - A normal document will obviously invalidate that exact document.
    - Special Ursa static files (menu.md, style.css, and script.js) are inherited by all documents in the current folder and all subfolders, so they will invalidate all documents in the current folder and all subfolders.
    - Meta static files:
      - A template file in meta will invalidate all documents that use that template.
      - A stylesheet or script file in meta will invalidate all documents that inherit from that meta (which is probably everything).
    - All other static files in the docroot (assuming they're linked at all by any document) should be invalidated thus:
      - Calculate a new hash for the static file
      - Find all documents that reference that static file
      - Regenerate the html (even if the source md/mdx/txt file is unchanged) for those documents to update the cache-busting query string for the static file reference
- This should catch all the various edge cases that previously required restarting the server or doing a full regeneration.
- Regeneration priority order:
  - When regeneration is triggered, check for connected WebSocket clients and get their current URL.
  - If their current URL is affected by the change (document, static asset, template, anything), prioritize the necessary documents and assets to serve that URL before all others, and when they are regenerated, send the push notification to reload.
  - After that, regenerate the rest of the affected documents in the background.
  - In cases of rapid changing of files, do the following:
    - Debounce all file system change events within a short time window (e.g. 500ms); wait for at least 500ms of no changes before starting regeneration. This helps in cases where a script or bot is making many changes to many files.
  - When a change is detected, before any complex processing, send a ping to WebSocket-connected clients that an update is in progress, but it isn't known yet if it will affect their page.
  - When it is determined that a change will affect the current page of a connected client, send another push to let the client know.
  - Handle the above two notifications in the UI thus:
    - When updates start, add a subtle loading indicator to the right of all left widgets, such as <Loader color="gray" />
    - If it turns out the update doesn't need a refresh, remove the indicator.
    - If it does need a refresh, change the indicator to a <Loader color="green" />.
    - When the hot refresh actually happens, the indicator shouldn't be there anymore.
- Cache changes (under consideration):
  - Before the cache was implemented, every file change triggered a complete regeneration of the entire site. This was slow, obviously. First, an in-memory cache was added to speed up the regeneration of unchanged files. But since the watcher back then missed a lot of regeneration cases (such as all meta changes), killing 'serve' and restarting it was quite common. Thus, the cache was persisted to disk, so that even in the case of a full regeneration (such as after a restart), unchanged files would still be skipped. This has worked fairly well, but for the invalidation edge cases described above (already fixed).
  - However, considering that we now have a robust regeneration system that can handle all edge cases and push updates to the client, we may want to consider removing the cache entirely. The cache adds complexity and can sometimes get into a bad state, requiring manual deletion. With the new regeneration system, we could keep the cache in-memory, and rarely will the user need to kill 'serve' and restart just to get an update (ideally, never). In-memory cache is even faster than disk, so this might be a better experience overall.
- Regeneration cases still unhandled:
  - User updates Ursa itself (e.g. npm update) while serve is active. I mean, this shouldn't be very common outside of Ursa devs, but's determine:
    - Does the current system actually catch the meta changes?



Top Menu improvements:
- When a submenu overflows the available viewport height, it should become scrollable instead of overflowing off the screen. This can be achieved with CSS by setting a max-height and overflow-y: auto on the submenu container.
    
New Widgets:
- Suggested Content
  - A new left-side widget that shows a list of suggested content based on the current page. Categories of suggested content:
    - Content you frequently view (uses localStorage to track page views and show most viewed content)
    - Future ideas:
      - LLM-guided suggestions based on frequently viewed content, suggested related documents you haven't viewed yet, etc.

Bugs:
- [x] When using menu.md with auto-generation, the top menu's Home href is "//index.html" instead of "/index.html". On localhost, this ends up working fine, but on https://realdomain.com, this loads https://index.html which obviously doesn't work. The current logic seems to prefer absolute URLs, so in this case, the url for home should be "/index.html" (not double slash).
- [x] Site style.css is not present on auto-generated index pages
- Regeneration issues:
  - Create a power, that power page now exists. But powers.json doesn't have it.

# 0.76.0
2026-02-11

- **New Feature: Recent Activity widget.** A new topbar widget shows the 10 most recently modified documents in the docroot, sorted by modification date (most recent first). The widget appears on the left side of the top nav (to the right of the home icon) and is open by default.
  - Recent activity data is collected during the generate phase by stat-ing each article file, then written to `public/recent-activity.json`.
  - In serve/dev mode, the recent activity list is built during background cache initialization and updated live when article files are changed.
  - The single-file regeneration path (`regenerateSingleFile`) also updates the recent activity JSON incrementally.
- **Widget system improvements:**
  - All widgets now have a close (✕) button in the upper-right corner of their panel header. Clicking it closes the widget and deselects the corresponding icon in the top bar.
  - Widget open/closed state is now persisted in localStorage. Widgets that were open will remain open after a page reload, and widgets that were closed will remain closed. Widgets with no saved state fall back to their default (Recent Activity defaults to open; others default to closed).
  - The widget system now supports both left-side and right-side widget panels, which operate independently (one widget per side can be open at a time).

# 0.75.0
2026-02-10

- Top Menu changes: the top menu is now the default first-level navigation. Top-left nav is either root, or 'hamburger' on smaller screens.
  - Right column is now a standardized widget zone, with TOC, Search, and Profile widgets implemented.
- Default header: documents without an initial H1 will now have their title rendered as an H1 header at the top of the article. Index/home pages will default to the parent folder name if not overridden.
- Breadcrumbs: added breadcrumbs to the top of each article for easier navigation and context

# 0.74.0
2026-02-08

- added a feature to skip preview generation and swapping on a per-image basis. You can use the data-no-preview tag in html, and the ?no-preview query parameter in markdown or wikitext images.
- when building automenus and autoindex pages, folders with no md/mdx/txt/html documents anywhere in their tree will not be shown.

# 0.73.0
2026-02-07

- fixed build pipeline blocker

# 0.72.0
2026-02-07

- MDX support: Ursa can now process .mdx files with embedded JSX components
  - MDX files are parsed and rendered to HTML with React components
  - Custom components can be imported and used within MDX content
  - MDX documents are fully integrated with Ursa's build and serve processes, including hot reloading in dev mode
  - This allows for rich interactive content while still benefiting from Ursa's static site generation features

# 0.71.0
2026-02-05

- 'Dev mode': new mode similar to serve, but only generates documents on-demand to save time.
  - When running `ursa dev`, the server starts immediately without a full build
  - Documents are generated on-the-fly when requested, with caching for subsequent requests
  - Ideal for development with large sites where full builds are slow
  - Still supports hot reloading and file watching for dynamic updates
- Custom menus can now include auto-generated menus in addition to custom content
- Custom menus are displayed on the top bar instead of the side

# 0.70.0
2026-02-04

- **Navigation Cache**: Dramatically improved navigation build time
  - Navigation structure cached in `.ursa/nav-cache.json`
  - Cache validated by file list hash + metadata file stats (index.md, config.json)
  - Parallel stat operations for faster cache validation
  - Result: Navigation build drops from ~9s to ~50ms on cached runs (99% improvement)

# 0.69.0
2026-02-04

- **Image Processing Performance**: Dramatically improved image processing speed
  - Persistent image cache: images are only re-processed when source file changes (mtime/size check)
  - Parallel processing: 8 images processed concurrently instead of sequentially
  - Smart preview skipping: images smaller than 800x800 skip preview generation (already small enough)
  - Result: Image processing drops from ~23s to ~16ms on cached runs (99.9% improvement)

# 0.68.0
2026-02-04

- **Build Performance Profiling**: Added comprehensive profiling to identify performance bottlenecks
  - Each build phase is now timed with millisecond precision
  - Visual bar chart report shows percentage of total build time per phase
  - Phases tracked: Scan source files, Filter & classify, Build navigation, Load cache, Copy meta files, Process images, Process articles, Write search index, Write menu data, Process directories, Process static files, Auto-index generation, Finalization
  - Report displayed at end of each build for performance analysis

# 0.67.0
2026-02-04

- All images referenced in whitelisted documents should be processed and copied, even if the images themselves are not in the whitelist

# 0.66.0
2026-02-04

- Links to a markdown file in source will now render as a link to the corresponding .html file even if the target file does not exist yet
- Relative URLs in raw HTML elements (img src, video src, etc.) embedded in markdown files are now resolved relative to the document's location
- Relative URLs in inline style `url()` values (e.g., `background-image: url('./img/foo.webp')`) are now resolved relative to the document's location

# 0.65.0
2026-02-01

- Fixed issue where images wrapped in an anchor tag were incorrectly given a click handler to open in a new tab

# 0.64.0
2026-01-31

- Handles scenario where a new image is added while serving (previously the image wouldn't show without a full restart)
  - New images are now processed on-the-fly when detected in serve mode
  - Image previews are generated and copied to output automatically
  - HTML is updated to use preview images without needing a full rebuild

# 0.63.0
2026-01-31

- Images inside an anchor tag will no longer have a click handler added to open the image in a new tab
  

# 0.62.2
2026-01-29

- Fixed CI issue with pnpm using npm-specific syntax

# 0.62.1
2026-01-29

- CI now uses pnpm to avoid redundant package managers

# 0.62.0
2026-01-29

- **Enhanced Auto-Index**: Index documents can now configure auto-index generation via frontmatter
  - `generate-auto-index: true` - Include an auto-generated index listing in the page
  - `auto-index-depth: N` - Control recursion depth (1 = current folder, 2 = current + subfolders, etc.)
  - `auto-index-position: top|bottom` - Insert the auto-index before or after the document content

- **Faster Serve Mode**: The `serve` command now uses deferred image processing for significantly faster startup
  - HTML files are generated immediately with original image paths
  - Image preview generation runs in the background after HTML is ready
  - Site is browsable within seconds instead of waiting for full image processing
  - Images will display as originals until preview generation completes (then show optimized WebP previews)
  - Added hot reloading for regeneration

- **Bug Fixes**:
  - Fixed issue where style.css changes were not reflected until server restart in `serve` mode
  - Fixed issue where root-level auto-index had incorrect HREFs
  - Fixed issue where re-generating an index document with `generate-auto-index:true` did not include the auto-index until server restart
  - Fixed issue where auto-indexer was rendering 'img' folders

# 0.61.1
2026-01-14

- Fix: package-lock.json version mismatch

# 0.61.0
2026-01-14

- Image Handling
  - [x] When an image tag is encountered, and the image is found in the static assets:
    - [x] Process the image to a preview size (max width/height == article width (50rem) or px equivalent), and convert to webp with reasonable compression. Copy the original image as well as the preview.
    - [x] Generate the HTML img tag as is currently done, but:
      - [x] Use the preview image as the src
      - [x] Use the original image as the data-fullsrc attribute
      - [x] On click, open the original image in a new tab

# 0.60.0
2026-01-03

- added `menu-label` frontmatter field to override default menu labels
- added `menu-sort-as` frontmatter field for custom sort ordering
- metadata-only index.md files now trigger auto-index generation
- index files sorted to top of menu panes with distinct styling
- fixed menu column vertical scrolling
- excluded Ursa-internal fields from frontmatter table display

# 0.59.0
2026-01-01

- added frontmatter rendering

# 0.58.0
2025-12-26

- new menu UI with 2-pane horizontal layout

# 0.57.0
2025-12-26

- added full-text indexing and search using lunr.js
- all links in generated html will be full links with extensions (e.g. /folder/page.html)

# 0.56.0
2025-12-23

- restored metadata to directory index JSON files

# 0.55.0
2025-12-21

- custom menus (menu.md|txt) override the automenu when present

# 0.54.0
2025-12-21

- added cache-busting timestamps to static files
- cleaned up generate.js by moving helper functions to separate files


# 0.53.0
2025-12-21

### Menu Size Optimization
- **External Menu JSON**: Menu data is now stored in `/public/menu-data.json` instead of being embedded in every HTML file. This dramatically reduces HTML file sizes for sites with large folder structures (e.g., from 2-3MB per file down to ~50KB).
- **Async Menu Loading**: Menu data is fetched asynchronously after page render, showing a "Loading menu..." indicator until ready.
- **Debug Fields Removed**: Menu JSON no longer includes debug/inactive fields, reducing JSON size further.
- **Gzip Compression**: Development server now uses gzip compression for all responses, significantly reducing transfer size for JSON and HTML files.

# 0.52.0
2025-12-21

- Fixed search results not displaying correctly when no matches are found

# 0.51.0
2025-12-21

- Existing .html files are no longer overwritten by generated documents.

# 0.50.0
2025-12-21

### Performance Optimizations
- **CSS Path Caching**: Implemented caching for `findStyleCss()` lookups during generation. Reduces redundant filesystem walks for documents in the same directory tree.
- **Template Replacement Optimization**: Changed from 8 sequential `string.replace()` calls to a single regex pass, reducing intermediate string allocations.
- **Wikitext Regex Pre-compilation**: Pre-compiled ~40 regex patterns at module load time instead of compiling on every `wikiToHtml()` call.

### New Features
- **Static File Watch**: `ursa serve` now watches for new/changed static files (images, fonts, PDFs, etc.) and automatically copies them to output without requiring a full rebuild.

### Bug Fixes
- **Menu Folder Expansion**: Fixed issue where navigating to `/folder` wouldn't auto-expand the menu, but `/folder/index.html` would. Both now behave consistently by normalizing trailing slashes in URL comparison.


# 0.49.0
2025-12-20

- Fixed more instances of false inactive links, this time in wikitext files (.txt)
- **Auto-Index Style Fix**: Auto-generated index pages now correctly inherit `style.css` from parent folders, just like normal documents
- **Clean Build Fix**: The `--clean` flag now properly clears the output directory before generation. Previously it only ignored the hash cache, which could leave stale files (like old auto-generated indexes) that would block new generation.


# 0.48.0
2025-12-20

- **External CSS**: CSS files are now externally linked via `<link>` tags instead of being embedded in each HTML page. This significantly reduces HTML file sizes and improves browser caching.
- **Fast CSS Updates**: CSS file changes in watch mode now just copy the file to output (~1ms) instead of triggering a full rebuild
- **Fast Single-File Regeneration**: Article changes in watch mode use a new fast-path that regenerates only the changed file (~50-100ms) instead of scanning all source files
- **Clickable Folder Links**: All folders in the navigation menu are now clickable links (auto-index ensures every folder has an index.html)
- **Menu Collapse Fix**: Fixed issue where clicking the caret on a folder containing the current page wouldn't collapse it
- **URL Encoding Fix**: Fixed menu not highlighting current page when URLs contain spaces or special characters
- **Link Validation Fix**: Links to folders are no longer incorrectly marked as inactive (folders now included in valid paths since auto-index generates index.html for all)
- **WikiText Link Fix**: Fixed wikitext links (in .txt files) being incorrectly marked as inactive. Link validation is now handled centrally by the link validator after HTML generation.
- **Folder/Index Link Fix**: Links to folders containing a `(foldername).md` file (instead of `index.md`) are now correctly recognized as valid

# 0.47.0
2025-12-20

- Improved handling of trailing slashes in URLs to ensure consistency across all links and resources

# 0.46.0
2025-12-20

- Normalized handling of trailing slashes in URLs

# 0.45.0
2025-12-20

- Added --exclude flag to ignore specified files or directories during generation
- Improved performance of the serve command with optimized file watching
- Automatically generating index.html for directories without an index file

# 0.44.0
2025-12-16

- Added 'sections' metadata property with hierarchical section structure

# 0.43.0
2025-12-14

- Added buildId and .ursa.json
- Added full datetime to footer
- Added commit hash to footer as comment

# 0.42.0
2025-12-14

- Automenu will now remove dashes from file names

# 0.41.0
2025-12-13

- Fixed footer bug

# 0.40.0
2025-12-13

- Added footer

# 0.39.0
2025-12-13

- Updated to node 24.5 to satisfy npm Trusted Publishing
- Refactored Github Actions
- Added CONTRIBUTING.md

# 0.38.0
2025-12-13

- Updated Github Actions workflow to use OIDC for authentication

# 0.37.0
2025-12-13

- Added Github Actions workflow for CI/CD (npm publish)

# 0.36.0
2025-12-13

- Links to a valid .md file in source will now render as a link to the corresponding .html file (and show as an active link)

# 0.35.0
2025-12-11

- Fixed issue where directory indices were empty

# 0.34.0
2025-12-11

- Added config.json with folder-specific settings for label, icon, and visibility
- Root-level config.json can specify open menu items

# 0.33
2025-12-10

- Fixed the broke-ass menu

# 0.32
2025-12-10

- Using .ursa folder in source directory for content hash cache
- Added --clean flag to ignore cache and regenerate all files
- Set up npm config for public package publishing

# 0.31
2025-12-09

- Added URL property to JSON directory indices
- Ensured directory indices are recursive

# 0.30
2025-12-07

- Fixed broken link detection to correctly identify broken internal links

# 0.29.0
2025-12-07

- New nav-main style, two-levels only (but supports any depth), looks way better

# 0.28.0
2025-12-07

- Added broken link detection and styles
- Fixed hole in "serve" logic that didn't regenerate style.css

# 0.27.0
2025-12-07

- Capitalizing nav-main labels

# 0.26.0
2025-12-06
- Fixed global nav styles in desktop
- Updated main nav style to match TOC

# 0.25.0

2025-12-06

- Enhanced mobile navigation with hamburger toggle that changes to X when menu is open
- Improved button accessibility with dynamic aria-label updates

# 0.24.0

2025-12-06

- Added support for index files in folder links
- Folders with index.md/txt/yml now link to /folder/index.html
- Folders without index files render as non-clickable text

# 0.23.0

2025-12-04

- Implemented incremental build support with content hashing
- Source file changes now only regenerate modified files
- Meta file changes still trigger full rebuild
- Added .content-hashes.json cache for tracking file changes

# 0.22.0

2025-12-04

- New Notion-style nav-main sidebar design
- Added folder/document icons with custom icon support
- Collapsible menu items with expand arrows
- Responsive flexbox layout for nav-global

# 0.21.0

2025-12-01

- Enhanced error handling for template retrieval
- Better error messages when templates are not found

# 0.20.0

2025-12-01

- Added fault tolerance to generate command
- Individual file errors no longer stop entire build
- Errors collected and written to _errors.log

# 0.19.0

2025-11-21

- Fixed YAML parsing issues with horizontal rules being mistaken for front matter
- Improved regex to require closing --- on its own line

# 0.18.0

2025-11-21

- Fixed errors with wikitext rendering
- Better handling of undefined args.db

# 0.17.0

2025-10-23

- Added Table of Contents (TOC) generation
- Smooth scrolling to headings with offset adjustment
- Active heading tracking in TOC

# 0.16.0

2025-10-22

- AI-implemented search feature with typeahead
- Search index built from all articles during generation

# 0.15.0

2025-10-22

- Improved mobile responsiveness
- Better media query breakpoint (800px)
- Enhanced h1 styling and article width for mobile

# 0.14.0

2025-10-22

- Fixed sticky header generation
- Enhanced sticky header functionality
- Added responsive navigation styles

# 0.13.0

2025-10-07

- Added whitelist feature for selective file generation
- Added sectionify script for content organization
- Fixed bugs in node-watch for file monitoring
- Working sticky headers implementation

# 0.12.0

2025-10-06

- Added debug CLI mode
- Fixed embedded style issues
- Added site navigation
- Total rewrite of base CSS (article and topnav)
- Added custom CSS support (disabled by default)

# 0.11.0

2025-07-28

- added CLI commands (e.g. "ursa src" and "ursa serve src")

# 0.10.0

2024-03-13

- Will no longer write an autoindex when index document already exists

# 0.9.0

2024-02-10

- Removed spammy debug data from json

# 0.8.0

2023-12-31

- Fixed recursive-readdir to actually return directories, not just files

# 0.7.0

2023-08-01

- removed all non-public modules

# 0.6.0

2023-08-01

- removed some dependencies that required private auth for npm install

# 0.5.0

2023-05-08

- added INCLUDE_FILTER env var

# 0.4.2

2023-03-01

- bug fixes

# 0.4.0

2023-03-31

- Now a library

# 0.3.0

2022-10-17

- Using express instead of http/node-static for serve
- Serve now waits for generation to finish
- Formatted files using prettier

# 0.2.0

2022-03-30

- Added serve command
- Workaround for node-static broken npm package
- Added source static files and menu
- Lots of default styling (not that meta should be in there at all)
- Added TODO

# 0.1.0

2022-03-30

- Initial POC
