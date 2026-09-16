# MDX Island Hydration

**Status:** implemented in 0.96.0
**Written:** 2026-09-16 (file/line references are as of v0.95.0)

## Problem

`hydrate: true` on an `.mdx` page breaks the page's layout, and the break gets worse the
more headings the page has.

The hydration script (`src/helper/mdxRenderer.js` `generateHydrationScript`) calls
`ReactDOM.hydrateRoot(#main-content, <Component/>)`: it hands React the whole article and
the whole MDX component and expects them to match. They never do:

1. The template puts things *inside* `#main-content` that are not part of the MDX render —
   breadcrumbs (`generate.js` ~line 810) and, when the body does not start with `<h1`, a
   title heading (~line 803).
2. The default template's `sectionify.js` runs on `DOMContentLoaded` and rewrites
   `#main-content`, wrapping each H1 and what follows it in `<section class="sectionOuter">`.
   That wrapper is what the sticky-header CSS keys on.
3. The hydration script also waits for `DOMContentLoaded`, and because it is the last script
   in the body its listener is registered last, so it always runs on the already-sectioned DOM.

React reports the mismatch (error #418), throws the server-rendered DOM away and renders
the component from scratch. What is left has no sections (so every H1 is `position: sticky`
against the article and they pile up on top of each other), no breadcrumbs, and — because
React 19's `renderToString` emits `<link rel="preload">` ahead of any `<img>`, which defeats
the "body starts with `<h1`" check — a duplicated title that the TOC generator lists twice.
Every `.mdx` page with `hydrate: true` has this today; it is only less obvious on pages with
few H1s.

## Design

Hydrate the components, not the page. The markdown around them is static and never needs
React; only the components imported into the MDX do.

**Build time.** An esbuild plugin, prepended to mdx-bundler's plugin list, intercepts
every import whose importer is the `.mdx` entry, resolves it normally, and — if it is a
`.jsx`/`.tsx` file, or a `.js`/`.ts` file inside a `_components/` directory — replaces it
with a virtual module that re-exports the real one with its default export wrapped:

```js
import __C from '/abs/path/PowerList.jsx';
export * from '/abs/path/PowerList.jsx';
import { island } from 'ursa:island';
export default island(__C, 'PowerList');
```

Only direct imports from the MDX file are wrapped. A component that imports another
component (`PowerList` → `TraitList`) does so through a normal relative import, so the inner
one is not an island — nesting would put one React root inside another. Named exports pass
through unwrapped; `island()` also returns non-functions untouched, so a JSON or data import
is unaffected.

**Server.** `island(C)` renders `<ursa-island data-island="N">` around `C`'s output. `N`
is a per-render counter assigned in `useState`'s lazy initializer, so it increments once per
mount, in tree order. Each `renderMDX` evaluates a fresh module (mdx-bundler's
`getMDXComponent` uses `new Function`), so the counter starts at 0 for every page.

**Client.** The bundled MDX module is rendered into a *detached* `createRoot`. That runs
the same tree in the same order, so each `island(C)` sees the same `N` and the real props —
including function props like `filter={fn}`, which is why the whole module runs on the
client rather than serialized props being replayed. Instead of rendering `C`, the client
`island` finds `ursa-island[data-island="N"]` in the live document and calls
`hydrateRoot(target, <C {...props}/>)` on it in an effect. Each island is its own React
root, hydrated against exactly the markup the server produced for it, wherever `sectionify`
moved it. The surrounding article is never touched by React.

**Runtime.** `react-runtime.js` now also exposes `createRoot`. `buildReactRuntime` used to
skip the build whenever the file existed; it now checks for a version marker so an old
runtime in `output/public/` is rebuilt.

**Late content.** Hydration itself changes nothing, but an island that fetches and then renders
headings adds them after `sticky.js` and `toc-generator.js` have taken their one look at the
article — so its H2s never roll up into the stuck H1 (they stack instead) and the TOC omits
them. `content-hooks.js` adds `window.ursa.contentChanged(root)`, which dispatches
`ursa:content-changed` on `document`; both scripts re-collect headings on it (the TOC rebuilds
in place, keeping existing ids). Components call it from an effect once their content is in the
DOM. Coalesced with `setTimeout(0)` rather than `requestAnimationFrame`, which does not fire in
a hidden tab.

**Title check.** `renderMDX` strips React's hoisted `<link rel="preload" as="image">` tags
from the output. They carry the un-rewritten relative `href`, so they fetched nothing useful,
and their position ahead of the first `<h1>` is what produced the duplicate title.

## Consequences

- `hydrate: true` keeps its meaning: it controls whether the client bundle is emitted.
  Without it, islands are server-rendered and inert, with the wrapper still present.
- React context does not cross island boundaries. MDX pages have no provider above the
  components, so nothing relied on this.
- `ursa-island` is a custom element with `display: contents`, so it has no box of its own
  and does not affect layout. It parses anywhere, including inside a `<p>`.
- Components used as islands must render the same markup on server and client on first
  render (the normal hydration contract). `TraitList`'s "Loading…" placeholder does; it
  fetches in an effect.

## Not done

- Auto-detecting islands so `hydrate: true` becomes unnecessary. Straightforward (emit the
  client bundle iff the render contains `<ursa-island`), but the flag is also what
  `generate.js` and `dev.js` read to decide whether to ask for client code; left for later.
- A build-time data-loader for MDX (rendering a list from a directory JSON at generate time).
  Islands make the runtime-fetch approach work; the build-time variant is a separate spec.
