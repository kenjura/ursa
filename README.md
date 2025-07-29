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
# Basic usage
ursa <source-directory>

# With custom meta and output directories
ursa content --meta=templates --output=dist

# Using default meta and output directories (meta/ and output/)
ursa content
```

### CLI Options

- `<source>` - Source directory containing markdown/wikitext files (required)
- `--meta, -m` - Meta directory containing templates and styles (default: "meta")
- `--output, -o` - Output directory for generated site (default: "output")

## Library Usage

### ES Modules (recommended)

```javascript
import generateSite, { generate } from '@kenjura/ursa';

// Using the default export
await generateSite({
  source: './content',
  meta: './meta',
  output: './dist'
});

// Using the named export (matches internal API)
await generate({
  _source: './content',
  _meta: './meta', 
  _output: './dist'
});
```

### CommonJS

```javascript
const generateSite = require('@kenjura/ursa').default;
const { generate } = require('@kenjura/ursa');

// Usage is the same as above
```

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