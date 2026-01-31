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
