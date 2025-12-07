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
