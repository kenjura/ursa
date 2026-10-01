# The build as a library

`@kenjura/ursa/build` exposes the incremental build and the development
server behind `ursa serve`, for programs that decide themselves when to build
and what to do with the output — such as
[ursa-server](https://github.com/kenjura/ursa-server), which watches remote
sources and deploys changed files to a bucket or over rsync.

```js
import { createBuild, createDevServer, createIgnoreFilter } from "@kenjura/ursa/build";
```

For one-off builds, `generate` / `serve` from `@kenjura/ursa` remain the
simpler entry points.

## `createBuild(options)`

Creates a build: the build graph (docs/SERVE.md §4) plus the site's node
definitions, loaded from the persisted cache when there is one. Returns
`{ runPass, invalidate, graph, cacheDir, close }`.

| Option | Default | Meaning |
|---|---|---|
| `source`, `meta`, `output` | required | Absolute paths. |
| `whitelist`, `exclude`, `jsonOnly`, `directoryJson`, `directoryDepth`, `concurrency`, `explain` | as the CLI | See BUILD_CONFIG.md. |
| `clean` | `false` | Discard the cache and empty `output` first. |
| `cacheDir` | `<source>/.ursa` | Keep the build cache (graph, cache stamp, document-template bases, build id) here instead of in the docroot. A non-empty folder ursa did not write is refused, never cleared. |
| `onOutputWrite(rel)` | — | Called for each output file (relative to `output`) whose bytes changed and were written. Files whose bytes did not change are not written and not reported. |
| `onOutputDelete(rel)` | — | Called for each output file deleted. |
| `log(msg)` | `console.log` | |

### `build.invalidate(paths)`

Marks absolute paths (in the docroot or meta) as possibly changed. Directories,
and paths that no longer exist, have their whole subtree re-checked. Call it
with every path a watcher reports, then run a pass.

### `build.runPass(options)` → summary

Runs one pass (docs/SERVE.md §5). Only one may run at a time; the caller
serialises them.

| Option | Meaning |
|---|---|
| `rescan` | Re-check every known leaf rather than only invalidated ones. For callers without a watcher, or that may have missed events. |
| `viewedOutputs` | Output paths to build first. |
| `onDirty(dirty, changedLeaves)`, `onNodeDone(id, err)` | Progress hooks. |

The summary includes `writtenPaths` and `deletedPaths` (output paths,
relative), `written` / `deleted` counts, `failures` (a Map of node id →
error), `changedNodes`, `timings` and `elapsed`.

A clean build (`clean: true`) empties `output` without reporting each file
removed; compare against your own record of the previous output if you need
those deletions.

### `build.close()`

Stops the parser worker pool.

## `createDevServer(options)`

The HTTP server of `ursa serve`: static files from `outputDir`, extensionless
URLs, a hot reload script in every page, and a WebSocket at `/__ursa/ws` on
the same port.

| Option | Meaning |
|---|---|
| `outputDir` | Directory to serve (absolute). |
| `port`, `host` | Where to listen. `port: 0` picks a free port (read it back from `.port`). |
| `mount(app)` | Add Express routes ahead of the site's own. |

Returns `{ listen(), runPass(build, passOpts), notifyUpdateStart(), notifyNoAffect(), viewedOutputs(), app, httpServer, port, close() }`.
`runPass` runs `build.runPass` with the pages connected browsers are viewing
built first, and tells each browser when to reload.

## `createIgnoreFilter({ source, output, cacheDir })`

Returns `(absPath) => boolean`: true for paths that are never build inputs
(ursa's own cache and output, `.git`, `node_modules`, dot-files, editor
scratch files). Use it to filter a watcher's events.
