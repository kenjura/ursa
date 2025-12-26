# Ursa Static Site Generator

A flexible static site generator that converts Markdown, Wikitext, and YAML files into beautiful HTML sites.

There are many like it, but this one's mine.

## Installation

### As a CLI tool (global installation)
```bash
npm install -g @kenjura/ursa
```

### As a library dependency
```bash
npm install @kenjura/ursa
```

## CLI Usage

After global installation, you can use the `ursa` command:

```bash
# Generate site once
ursa <source-directory>
ursa generate <source-directory>

# Development server with live reloading
ursa serve <source-directory>

# With custom meta and output directories
ursa content --meta=templates --output=dist
ursa serve content --meta=templates --output=dist --port=3000

# Using a whitelist file to filter which files are processed
ursa content --whitelist=my-whitelist.txt
ursa serve content --whitelist=my-whitelist.txt

# Using default meta and output directories (meta/ and output/)
ursa content
ursa serve content
```

If not installed, you can run:
```bash
node bin/ursa (same args)
```

### CLI Commands

#### `ursa [generate] <source>`
Generate a static site once and exit.

#### `ursa serve <source>`
Start a development server that:
- Generates the site initially
- Starts an HTTP server to serve the output directory
- Watches source and meta directories for changes
- Automatically regenerates the site when files change

### CLI Options

- `<source>` - Source directory containing markdown/wikitext files (required)
- `--meta, -m` - Meta directory containing templates and styles (default: "meta")
- `--output, -o` - Output directory for generated site (default: "output")
- `--port, -p` - Port for development server (default: 8080, serve command only)
- `--whitelist, -w` - Path to whitelist file containing patterns for files to include
- `--exclude, -e` - Folders to exclude: comma-separated paths relative to source, or path to file with one folder per line
- `--clean` - Clear output directory and ignore cache, forcing full regeneration

### Whitelist File Format

The whitelist file is a plain text file where each line specifies a pattern for files to include. Patterns can be:

```text
# Comments start with # and are ignored
# Empty lines are also ignored

# Full absolute paths
/full/path/to/file.md

# Relative paths from source root
character/classes/psion.md
character/classes/

# Directory paths (include trailing slash to match directories)
spells/
documentation/

# Just filenames (matches anywhere in the source tree)
index.md
README.md

# Partial path matches
important-document
classes/wizard
```

### Exclude Option

The `--exclude` option allows you to skip certain folders during generation. This can be specified as:

1. **Comma-separated paths** directly on the command line:
```bash
ursa content --exclude=archive,drafts,old-content
ursa serve content --exclude=test,backup
```

2. **A file path** containing one folder per line:
```bash
ursa content --exclude=exclude-list.txt
```

The exclude file format is similar to the whitelist:

```text
# Comments start with # and are ignored
# Empty lines are also ignored

# Folders to exclude (relative to source)
archive
drafts
old-content/v1
test/fixtures
```

### Large Workloads

For sites with many documents (hundreds or thousands), you may need to increase Node.js memory limits:

```bash
# Increase heap size to 8GB for large sites
node --max-old-space-size=8192 $(which ursa) serve content

# Or use the npm scripts
npm run serve:large content
npm run generate:large content

# You can also set environment variables to tune batch processing
URSA_BATCH_SIZE=25 ursa serve content  # Process fewer files at once (default: 50)
```

**Environment Variables for Performance Tuning:**
- `URSA_BATCH_SIZE` - Number of files to process concurrently (default: 50). Lower values use less memory but are slower.
- `NODE_OPTIONS="--max-old-space-size=8192"` - Increase Node.js heap size for very large sites.

## Library Usage

### ES Modules (recommended)

```javascript
import generateSite, { generate, serve } from '@kenjura/ursa';

// One-time generation using the default export
await generateSite({
  source: './content',
  meta: './meta',
  output: './dist',
  whitelist: './my-whitelist.txt' // optional
});

// One-time generation using the named export (matches internal API)
await generate({
  _source: './content',
  _meta: './meta', 
  _output: './dist',
  _whitelist: './my-whitelist.txt' // optional
});

// Development server with live reloading
await serve({
  _source: './content',
  _meta: './meta',
  _output: './dist',
  port: 3000  // optional, defaults to 8080
});
```

### CommonJS

```javascript
const generateSite = require('@kenjura/ursa').default;
const { generate, serve } = require('@kenjura/ursa');

// Usage is the same as above
```

### Library Functions

#### `generateSite({ source, meta, output })`
Default export. Generates the site once with user-friendly parameter names.

#### `generate({ _source, _meta, _output })`
Named export that matches the internal API. Generates the site once.

#### `serve({ _source, _meta, _output, port? })`
Starts a development server with live reloading:
- Generates the site initially
- Starts HTTP server on specified port (default: 8080)
- Watches for file changes in source and meta directories
- Automatically regenerates when changes are detected

## Project Structure

Your project should have the following structure:

```
your-project/
├── source/           # Source files (markdown, wikitext, yaml)
│   ├── index.md     # Required: main page
│   └── ...
├── meta/            # Templates, styles, and configuration
│   ├── templates/
│   ├── styles/
│   └── ...
└── output/          # Generated site (created automatically)
```

## Developing

For development on ursa itself:

```bash
npm run serve
```

Watches source and meta folder; on change, writes HTML to build folder.

### Environment Variables

- `SOURCE`: path to the source folder, default `${cwd}/source`
- `META`: path to the meta folder, default `${cwd}/meta`
- `BUILD`: path to the build folder, default `${cwd}/build`

## Running Locally

```bash
npm start
```

Generates the site once using default directories.

## Requirements

SOURCE folder should have at least an index.md in it.


## Link logic
Links are allowed to be extensionless. Link resolution works as follows:
- If link has an extension, look for exact match, and 404 if not found
- If link has no extension:
  - Look for exact match with .md, .txt, .yml extensions (in that order)
  - If not found, assume the path is a folder, and look for:
    - index.md, index.txt, _index.md, _index.txt
    - home.md, home.txt, _home.md, _home.txt
    - (folder name).md, (folder name).txt
  - If any of these are found, link to that file's html version
  - If still not found, 404
