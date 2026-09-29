# Spec: markup and CSS conventions

This is the contract between Ursa's renderers, its template scripts, its default stylesheet and every site stylesheet. [README.md](README.md) has the rationale; this file has the rules and the mapping.

- [1. Naming](#1-naming)
- [2. Page anatomy](#2-page-anatomy)
- [3. Document markup](#3-document-markup)
- [4. Components](#4-components)
- [5. CSS architecture](#5-css-architecture)
- [6. Tokens](#6-tokens)
- [7. Old → new mapping](#7-old--new-mapping)
- [Visual changes](#visual-changes)

---

## 1. Naming

### Namespace

Everything Ursa names starts with `ursa`:

| Kind | Form | Example |
|---|---|---|
| Class | `ursa-<component>[-<part>]` | `ursa-panel`, `ursa-panel-title` |
| ID | `ursa-<thing>` | `ursa-main`, `ursa-panel-toc` |
| Custom property, public | `--ursa-<name>` / `--ursa-<component>-<prop>` | `--ursa-accent`, `--ursa-topbar-bg` |
| Custom property, private | `--_<name>`, declared on the component that uses it | `--_bg` |
| `data-*` on an element Ursa owns | unprefixed | `.ursa-panel[data-widget="toc"]` |
| `data-*` on an element Ursa does not own | `data-ursa-<name>` | `h1[data-ursa-stuck]`, `a[data-ursa-broken]`, `body.ursa[data-ursa-menu-position]` |
| Keyframes | `ursa-<name>` | `ursa-spin` |
| Custom element | `ursa-<name>` | `<ursa-island>` |
| DOM event | `ursa:<name>` | `ursa:content-changed` |
| Storage key | `ursa-<name>` | `ursa-widget-toc` |

"Owns" means Ursa created the element and it carries an `ursa-` class. Headings, paragraphs and links in a document are the author's; the root element may be a host application's. Attributes Ursa adds to those are prefixed, so they never collide with an author's or host's own `data-*`.

### Classes

- **One class per component, one per part.** `ursa-<component>` on the component's root, `ursa-<component>-<part>` on parts that need a hook. No BEM `__`/`--`; the flat hyphenated form is what Ursa already uses in newer code (`ursa-lightbox-stage`, `ursa-image-frame`).
- **Classes name things, never states or variants.** A variant is an attribute on the component root (`data-layout="bar"`, `data-side="start"`, `data-placement="panel"`). A state is ARIA, `hidden`, or a `data-*` flag.
- **Don't add a class where the element is already unambiguous inside its component.** `.ursa-breadcrumbs a`, `.ursa-toc li`, `.ursa-frontmatter dt` are fine; the component class is the namespace.
- **Author content gets no Ursa classes** except where Ursa generated the construct (`ursa-section`, `ursa-figure`-less `figure`, `ursa-table-scroll`, `ursa-aside`, the wikitext legacy classes). A Markdown `# Heading` is a plain `<h1 id>`.

### State

| Meaning | Say it with |
|---|---|
| The page this link points to is this page | `aria-current="page"` |
| The TOC entry for the section in view | `aria-current="true"` |
| An ancestor of the current page, in a menu | `data-trail` |
| A control's panel/menu is open | `aria-expanded="true"` on the control, with `aria-controls` |
| A search result is keyboard-selected | `aria-selected="true"` (listbox option) |
| Not shown | `hidden` (the reset makes it beat any `display`) |
| Anything else | a `data-*` flag or enum on the element: `data-state="updated"`, `data-pannable`, `data-ursa-stuck` |

### IDs

- IDs are for **fragment targets and ARIA references only** (`href="#…"`, `aria-controls`, `aria-labelledby`, `aria-activedescendant`). No stylesheet — Ursa's or a site's — should select by ID. Scripts may look one up, but prefer the class.
- **Chrome IDs are all `ursa-` prefixed.** Document heading IDs are slugs of the heading text and live in the author's namespace, so the two can never collide (today a heading called "Global Search" and the search box compete for `#global-search`-style names).
- Heading IDs are generated **at render time**, not by `toc-generator.js`, so they are stable across builds and present in `bodyHtml`. Duplicate slugs get `-2`, `-3`.

---

## 2. Page anatomy

Server markup for the default template. `[js]` marks what scripts build or change. The full example, with content, is [examples/page.html](examples/page.html).

```html
<body class="ursa" data-ursa-template="default" data-ursa-menu-position="side|top"
      data-ursa-build="…" [data-ursa-sitenav="open|closed"] [data-ursa-color-scheme="light|dark"]>

  <a class="ursa-skip-link" href="#ursa-main">Skip to content</a>

  <header class="ursa-topbar">                                    <!-- banner -->
    <div class="ursa-topbar-start">
      <button class="ursa-button ursa-sitenav-toggle" aria-controls="ursa-sitenav"
              aria-expanded data-icon="menu|close|home">…3 icons…</button>
      <div class="ursa-toolbar">
        <button class="ursa-button" data-widget="recent-activity" aria-controls="ursa-panel-recent-activity" aria-expanded="false">…</button>
        <button class="ursa-button" data-widget="suggested" …>…</button>
      </div>
      <output class="ursa-status" data-state="updating|updated" hidden>…</output>   <!-- serve only -->
    </div>
    <div class="ursa-topbar-center">
      <nav class="ursa-nav ursa-topnav" data-layout="bar" aria-label="Site"></nav>  <!-- [js], top position -->
      <search class="ursa-search" data-placement="topbar">…</search>
    </div>
    <div class="ursa-topbar-end">
      <div class="ursa-toolbar"> toc · search · profile buttons </div>
    </div>
  </header>

  <nav class="ursa-nav ursa-sitenav" id="ursa-sitenav" data-layout="columns|tree" aria-label="Site">
    <script type="application/json" id="ursa-menu-data">…</script>   <!-- was script#menu-config -->
    <ul class="ursa-nav-list">…root level, server-rendered…</ul>     <!-- [js] upgrades to columns / tree -->
  </nav>

  <main class="ursa-main" id="ursa-main">
    <article class="ursa-doc" data-ursa-path="/folder/name">
      <header class="ursa-doc-header"> breadcrumbs, top-injected / leading menus </header>
      <section class="ursa-section" data-level="1"> <h1 id="…">…</h1> … </section>
      …
      <footer class="ursa-doc-footer"> bottom-injected menus </footer>
    </article>
  </main>

  <aside class="ursa-panel" id="ursa-panel-toc" data-widget="toc" data-side="end" aria-labelledby="…" hidden>…</aside>
  <aside class="ursa-panel" id="ursa-panel-search" data-widget="search" data-side="end" hidden>…</aside>
  <aside class="ursa-panel" id="ursa-panel-profile" data-widget="profile" data-side="end" hidden>…</aside>
  <aside class="ursa-panel" id="ursa-panel-recent-activity" data-widget="recent-activity" data-side="start" hidden>…</aside>
  <aside class="ursa-panel" id="ursa-panel-suggested" data-widget="suggested" data-side="start" hidden>…</aside>

  <footer class="ursa-sitefooter">…</footer>                       <!-- contentinfo -->

  [js] <dialog class="ursa-lightbox">…</dialog>
</body>
```

Notes:

- `data-ursa-sitenav` is absent until the user toggles the menu; absent means the viewport default (open on desktop, closed on mobile). It replaces `nav#nav-main.collapsed` / `.active`, and lives on the root so the frame can respond to it without `:has()`.
- `ursa-doc-header` and `ursa-doc-footer` are only emitted when non-empty.
- Every panel is its own `<aside>` (was: two shared `div.widget-dropdown` containers swapping `.widget-content.active` children and advertising the visible one in `data-active-widget`). `.ursa-panel[data-widget="toc"]` is the per-widget styling hook.
- `data-ursa-path` is the document's URL path without extension. It gives site CSS a per-document hook without per-document stylesheets.
- Other templates keep their own markup but must use `class="ursa"` on `<body>`, `class="ursa-doc"` on the document container, and the `ursa-` component markup for anything Ursa renders into them (breadcrumbs, menus, sections).

### Embedding

A document's JSON carries `bodyHtml`: the document's **sections only** — no breadcrumbs, no injected menus, no page header/footer. An embedder renders it into one element that is both root and document:

```html
<link rel="stylesheet" href="/public/ursa-content.css">   <!-- ursa-base.css + ursa-content.css -->
<article class="ursa ursa-doc">${bodyHtml}</article>
```

and adapts it with tokens on that element. See [examples/embed.html](examples/embed.html).

---

## 3. Document markup

What the renderers emit inside `.ursa-doc`.

### Sections

```html
<section class="ursa-section" data-level="1">
  <h1 id="fighter">Fighter</h1>
  …
  <section class="ursa-section" data-level="2">
    <h2 id="hit-points">Hit Points</h2>
    …
  </section>
</section>
```

- One section per h1, nested one per h2 inside it. h3 and below are not sectioned.
- Content before the first heading is not wrapped.
- **Not** `aria-labelledby`: a labelled `<section>` becomes a `region` landmark, and a wiki page would have dozens. The heading already gives the section its outline position.
- Wikitext `=Title|classes|style=` arguments: author classes are kept on the section as-is (they are the author's); the style argument becomes the section's `style`. `=Title|right=` becomes `<aside class="ursa-sidebar">` (no heading), as today.
- Sticky headings stick within their own section, so a stuck h2 lets go when its h2 section ends — the section nesting is what makes that work.

### Headings while scrolled `[js]`

`sticky.js` sets `data-ursa-stuck` on stuck h1–h3 and writes the stuck h2/h3 text into the h1's `data-ursa-trail` (`"Hit Points › Level 1"`). CSS renders it with `::after`. The heading's own DOM is never rewritten (today its `textContent` is replaced, which destroys any markup inside the heading).

### Other generated constructs

| Construct | Markup |
|---|---|
| Frontmatter table (`table: true`) | `<dl class="ursa-frontmatter"><div><dt>Key</dt><dd>Value</dd></div>…</dl>` |
| Markdown `::: aside` | `<aside class="ursa-aside">…</aside>` |
| Markdown image with preview | `<a class="ursa-image-link" href="full" target="_blank"><img …></a>` |
| Wikitext image | `<figure data-align="start\|end\|center"><img …><figcaption>…</figcaption></figure>`; size arguments stay inline `width`/`height` |
| Wikitext table | `<div class="ursa-table-scroll"><table>…</table></div>` — also wraps Markdown tables |
| Wikitext indent `::` / `:::` | `<div class="ursa-indent" data-level="1\|2">` |
| Wikitext `++big++` | `<span class="ursa-big" data-level="1\|2">` (was inline `font-size`) |
| Wikitext link | `<a class="ursa-wikilink" href="…" data-article="…">` |
| Link to a missing document | `data-ursa-broken` added to the `<a>` (was `class="inactive"`) |
| Auto-index | `<nav class="ursa-autoindex" aria-label="Contents"><ul>` nested `<ul>` per level (was `ul.auto-index.depth-N`) |
| MDX island | `<ursa-island data-island="n" data-component="Name">` (unchanged) |
| Author opt-out | `class="ursa-unstyled"` on any element (unchanged) |

Wikitext `'''bold'''`/`''italic''` stay `<b>`/`<i>`: the source doesn't say whether it means importance or just typography, which is exactly what `b`/`i` are for.

Author-facing attributes written in Markdown — `data-no-lightbox`, `data-no-preview` — are content, not styling hooks, and keep their names.

---

## 4. Components

Each is one scope in `ursa-chrome.css`. Tokens listed are the component's public knobs (see §6).

### Buttons

`.ursa-button` is every icon button in the frame: the menu toggle, toolbar buttons, panel close, search clear. `--_size` sets its square. A toolbar button whose panel is open (`[aria-controls][aria-expanded="true"]`) takes the panel's background.

### Navigation — `.ursa-nav`

```html
<nav class="ursa-nav …" data-layout="bar|tree|columns" aria-label="…">
  <div class="ursa-nav-text"><p>Label:</p></div>                  <!-- menu-file prose -->
  <ul class="ursa-nav-list">
    <li class="ursa-nav-item" [data-branch] [data-trail] [data-index] [data-home]>
      <a class="ursa-nav-link" href="…" [aria-current="page"] [data-ursa-broken]>Label</a>
      <!-- or <span class="ursa-nav-link"> for an entry with no page -->
      <ul class="ursa-nav-list">…</ul>                              <!-- bar, tree -->
    </li>
  </ul>
</nav>
```

| Instance | Extra class | Layout |
|---|---|---|
| Side menu, desktop | `ursa-sitenav` | `columns`: each level is a `ursa-nav-list` column inside `.ursa-nav-viewport > .ursa-nav-track`; plus `.ursa-nav-scroll[data-direction="back|forward"]` and `.ursa-nav-jump` |
| Side menu, mobile | `ursa-sitenav` | `tree` with touch-sized rows |
| Top menu | `ursa-topnav` | `bar`; dropdowns scroll, so flyouts are `position: fixed` and placed by `menu.js` |
| Named menu (`{menu:id}`, `inject-menu`) | `ursa-menu`, plus `data-menu-id` | `bar` (`appearance: horizontal`) or `tree` (`appearance: vertical`) |

`data-branch` marks an item with children even when they are not nested in the DOM (columns). Tokens: `--ursa-nav-item-padding`, `--ursa-sitenav-width`, `--ursa-sitenav-column-width`.

### Breadcrumbs — `.ursa-breadcrumbs`

```html
<nav class="ursa-breadcrumbs" aria-label="Breadcrumbs">
  <ol><li><a href="/">Home</a></li> … <li><a href="…" aria-current="page">Fighter</a></li></ol>
</nav>
```

Separators are CSS (`li + li::before`, hidden from assistive tech), not `<span>`s. Token: `--ursa-breadcrumb-separator`.

### Search — `.ursa-search`

```html
<search class="ursa-search" data-placement="topbar|panel">
  <input class="ursa-search-input" type="search" role="combobox"
         aria-expanded aria-controls="…results id" aria-activedescendant="…">
  <button class="ursa-button ursa-search-clear" aria-label="Clear search" hidden>×</button>
  <div class="ursa-search-results" id="…" role="listbox" hidden>
    <div class="ursa-search-group" role="group" aria-labelledby="…">
      <h3 class="ursa-search-group-title" id="…">Pages</h3>
      <div class="ursa-search-result" role="option" id="…" aria-selected="false">
        <span class="ursa-search-result-title">…</span>
        <span class="ursa-search-result-path">…</span>
      </div>
    </div>
    <button class="ursa-search-more">Show more</button>
    <p class="ursa-panel-message">No results</p>
  </div>
</search>
```

One component in two placements (today there are two sets of classes: `search-*` and `widget-search-*`). `search.js` and `widgets.js` should share one renderer.

### Panels — `.ursa-panel`

```html
<aside class="ursa-panel" id="ursa-panel-{widget}" data-widget="{widget}" data-side="start|end"
       aria-labelledby="ursa-panel-{widget}-title" hidden>
  <header class="ursa-panel-header">
    <h2 class="ursa-panel-title" id="ursa-panel-{widget}-title">…</h2>
    <button class="ursa-button ursa-panel-close" aria-label="Close">✕</button>
  </header>
  …body…
</aside>
```

Bodies: `nav.ursa-toc > ol > li[data-level] > a[aria-current]` (TOC); `.ursa-search[data-placement="panel"]`; `ul.ursa-linklist > li > a + .ursa-linklist-meta` (recent activity uses `<time class="ursa-linklist-meta" datetime>`, suggested a `<span>`); `.ursa-profile`; `p.ursa-panel-message` for loading/empty in any of them. The TOC panel becomes a margin panel on wide screens and a bottom strip under 1280px, as today. Tokens: `--ursa-panel-bg`, `--ursa-panel-border`, `--ursa-panel-width`, `--ursa-toc-gutter`, `--ursa-toc-max-width`.

### Site footer — `.ursa-sitefooter`

```html
<footer class="ursa-sitefooter">
  <div class="ursa-sitefooter-content">…footer.md…</div>
  <p class="ursa-sitefooter-meta"><small>v1.2.0 • build … • <time datetime="…">…</time> • Generated by <a>ursa</a> v…</small></p>
  <p class="ursa-sitefooter-copyright"><small>© 2026 …</small></p>
</footer>
```

### Image actions and lightbox

`lightbox.js` wraps each document image in `span.ursa-image-frame` and adds `span.ursa-image-actions > button.ursa-image-action[data-action]`. The viewer is a `<dialog class="ursa-lightbox">` opened with `showModal()`, which gives Ursa the top layer, `::backdrop`, focus containment and Escape for free (replacing the hand-rolled `role="dialog"` div, its backdrop element, and `body.ursa-lightbox-open`). Parts: `-stage[data-pannable][data-panning]`, `-image[data-placeholder]`, `-loading`, `-toolbar`, `-zoom`, `-level` (an `<output>`), and `.ursa-lightbox-button[data-action="zoom-in|zoom-out|download|close"]`.

### Live-reload status

`<output class="ursa-status" data-state="updating|updated" hidden>` with a `.ursa-spinner` (was `#ursa-update-indicator.ursa-update-gray|green` with inline `display:none`). Token: `--ursa-spinner-color`, `--ursa-spinner-size`.

---

## 5. CSS architecture

### Files and order

```
ursa-base.css      @layer order · tokens · reset         page + embed
ursa-content.css   @layer ursa.content                   page + embed
ursa-chrome.css    @layer ursa.chrome                    page only
site style.css …   unlayered, root folder first, nearest folder last
```

The meta bundle concatenates the first three for pages (`/public/ursa.css`) and emits the first two alone as `/public/ursa-content.css` for embedders.

### Layers

```css
@layer ursa.reset, ursa.tokens, ursa.content, ursa.chrome;
```

Chrome is later than content, so where an Ursa component sits inside a document (a named menu, breadcrumbs) its own rules win over the prose rules without specificity games. Site CSS is unlayered and beats all four.

### Scopes

| Scope | Covers | Stops at |
|---|---|---|
| `:where(.ursa)` (reset, tokens) | the root | — |
| `@scope (.ursa-doc)` | document content | `.ursa-unstyled`, `.ursa-breadcrumbs`, `.ursa-nav` |
| `@scope (body.ursa)` | the frame | `.ursa-doc > *` (the document box itself is in, its content is out) |
| `@scope (.ursa-nav)`, `@scope (.ursa-breadcrumbs)` | one component each | — |
| `@scope (.ursa-main .ursa-doc)` | page-only document behaviour (sticky headings) | as the content scope |
| `@scope (.ursa)` | image actions, lightbox, spinner | `.ursa-unstyled` |

The frame is rooted at `body.ursa`, not `.ursa`, so an embed wrapper with class `ursa` never picks up page-frame rules.

### Rules for Ursa's own CSS

1. Every rule is inside a layer and a scope (or `:where(.ursa)`).
2. Selectors are one class, optionally with attributes, pseudo-classes, or a type selector for parts inside a component. No IDs. No descendant chains more than two deep outside a component scope.
3. No literal colours outside `ursa-base.css`, except white/black on imagery (image actions, lightbox) where the theme is irrelevant.
4. Logical properties (`inline-size`, `margin-inline-start`, `inset-inline-end`) throughout.
5. `!important` only in the reset's `[hidden]` rule.
6. Media queries are the only place a length is duplicated (they cannot read custom properties): 800px (narrow) and 1280px (TOC strip).

### Rules for site CSS

The short form of [MIGRATION.md](MIGRATION.md):

1. Theme with tokens on `.ursa` first.
2. Write element rules for content inside `@scope (.ursa-doc) to (.ursa-unstyled) { … }`.
3. Restyle a component with its public tokens, then with one class (`.ursa-sitefooter { … }`).
4. Never select by ID, never use `!important`, never wrap site CSS in a layer (it would lose to Ursa's).

---

## 6. Tokens

All declared on `.ursa` in `ursa-base.css` unless noted. Colours are `light-dark()` pairs.

**Colour — base** (override these)

| Token | Default (light / dark) | Used for |
|---|---|---|
| `--ursa-bg` | `#fff` / `#121212` | page background |
| `--ursa-fg` | `#000` / `#f2f2f2` | text |
| `--ursa-surface` | `#f2f2f2` / `#242424` | topbar, panels, dropdowns, stuck headings |
| `--ursa-accent` | `#00a3a3` / `#00ffff` | current page, active TOC entry, focus |
| `--ursa-link` | `#0645ad` / `#8ab4f8` | document links |
| `--ursa-link-visited` | `#551a8b` / `#c58af9` | visited document links |

**Colour — derived** (tints of `currentColor`, so they follow any subtree's `color`)

| Token | Recipe |
|---|---|
| `--ursa-muted` | currentColor 60% |
| `--ursa-border` | currentColor 15% |
| `--ursa-hover` | currentColor 10% |
| `--ursa-selected` | currentColor 18% |
| `--ursa-highlight` | accent 20% |
| `--ursa-shadow` | `0 4px 12px rgb(0 0 0 / .2)` |

**Type:** `--ursa-font-body`, `--ursa-font-heading`, `--ursa-font-chrome`, `--ursa-font-mono`, `--ursa-line-height`.

**Layout:** `--ursa-doc-width` (50rem), `--ursa-topbar-height` (48px), `--ursa-sitenav-width` (260px), `--ursa-gutter`, `--ursa-radius`, `--ursa-space-xs|s|m|l`, `--ursa-icon-size`, `--ursa-transition`.

**Sticky headings:** `--ursa-sticky-top` (defaults to the topbar height), `--ursa-sticky-h1|h2|h3`.

**Stacking:** `--ursa-z-sticky|sitenav|topbar|dropdown|panel`.

**Component knobs** (not declared; read with a fallback, so they track the base tokens until set):
`--ursa-topbar-bg`, `--ursa-topbar-fg`, `--ursa-panel-bg`, `--ursa-panel-border`, `--ursa-panel-width`, `--ursa-toc-gutter`, `--ursa-toc-max-width`, `--ursa-nav-item-padding`, `--ursa-sitenav-column-width`, `--ursa-breadcrumb-separator`, `--ursa-figure-max-width`, `--ursa-sticky-bg`, `--ursa-spinner-color`, `--ursa-spinner-size`.

**Scheme:** `.ursa` has `color-scheme: light dark`. `data-ursa-color-scheme="light|dark"` on the root pins one. `color-scheme` on any element flips that subtree.

---

## 7. Old → new mapping

The complete list, for the implementation and for [MIGRATION.md](MIGRATION.md). "—" means removed with no replacement.

### Page and frame

| Old | New |
|---|---|
| `body[data-template-id]` | `body.ursa[data-ursa-template]` |
| `body[data-menu-position]` | `.ursa[data-ursa-menu-position]` |
| `body[data-custom-menu]` | `.ursa[data-ursa-custom-menu]` |
| `body[data-build]` | `.ursa[data-ursa-build]` |
| `nav#nav-global` | `header.ursa-topbar` |
| `.nav-left-controls` / `.nav-center` / `.nav-right-controls` | `.ursa-topbar-start` / `-center` / `-end` |
| `button.menu-button[data-icon]` | `button.ursa-button.ursa-sitenav-toggle[data-icon]` |
| `.widget-bar`, `.widget-bar-left` | `.ursa-toolbar` |
| `.widget-button[data-widget]`, `.widget-button.active` | `.ursa-button[data-widget]`, `[aria-expanded="true"]` |
| `.widget-icon` | — (the `<svg class="ursa-icon">` is the button's child) |
| `#ursa-update-indicator`, `.ursa-update-indicator`, `.ursa-update-gray/-green` | `output.ursa-status[data-state]` |
| `nav#nav-main` | `nav.ursa-nav.ursa-sitenav#ursa-sitenav` |
| `nav#nav-main.collapsed` / `.active` | `.ursa[data-ursa-sitenav="closed"]` / `="open"` |
| `nav#nav-main-top` | `nav.ursa-nav.ursa-topnav` |
| `script#menu-config` | `script#ursa-menu-data` |
| `article#main-content` | `main.ursa-main > article.ursa-doc` |
| `#global-nav` (empty div) | — |
| `footer#site-footer` | `footer.ursa-sitefooter` |
| `.footer-content` / `.footer-meta` / `.footer-copyright` | `.ursa-sitefooter-content` / `-meta` / `-copyright` |

### Panels and widgets

| Old | New |
|---|---|
| `#widget-dropdown`, `#widget-dropdown-left`, `.widget-dropdown(-left)` | one `aside.ursa-panel[data-widget][data-side]` per widget |
| `.widget-dropdown[data-active-widget="x"]` | `.ursa-panel[data-widget="x"]` |
| `.widget-dropdown.hidden`, `.widget-content.active` | `[hidden]` |
| `#widget-content-{x}`, `.widget-content` | `#ursa-panel-{x}` (the panel is the content) |
| `.widget-header` / `.widget-header-title` / `.widget-close-btn` | `.ursa-panel-header` / `h2.ursa-panel-title` / `.ursa-button.ursa-panel-close` |
| `#toc`, `#widget-content-toc ul`, `li.toc-h1/2/3`, `a.active` | `nav.ursa-toc > ol > li[data-level] > a[aria-current="true"]` |
| `.toc-sentinel` | — (use `IntersectionObserver` on headings) |
| `.recent-activity-list/-items/-item/-link/-time` | `ul.ursa-linklist > li > a + time.ursa-linklist-meta` |
| `.suggested-content-list/-items/-item/-link/-meta` | `ul.ursa-linklist > li > a + span.ursa-linklist-meta` |
| `.recent-activity-loading/-empty`, `.suggested-empty`, `.menu-loading` | `p.ursa-panel-message` / `.ursa-nav-message` |
| `.widget-profile-placeholder/-avatar/-signin/-note` | `.ursa-profile`, `.ursa-profile-avatar/-signin/-note` |

### Search

| Old | New |
|---|---|
| `#global-search`, `.widget-search-input` | `input.ursa-search-input[type=search]` |
| `.search-wrapper(-inline)`, `.widget-search-wrapper` | `search.ursa-search[data-placement="topbar\|panel"]` |
| `.search-clear-button(.hidden)` | `.ursa-button.ursa-search-clear[hidden]` |
| `#search-results`, `.search-results(.hidden)`, `.widget-search-results` | `.ursa-search-results[role=listbox][hidden]` |
| `.search-section` / `.search-section-header` | `.ursa-search-group` / `.ursa-search-group-title` |
| `.search-result-item(.selected)` | `.ursa-search-result[aria-selected]` |
| `.search-result-title` / `-path` | `.ursa-search-result-title` / `-path` |
| `.search-result-message` | `.ursa-panel-message` |
| `.search-show-more` | `.ursa-search-more` |

### Navigation

| Old | New |
|---|---|
| `.menu-columns-container` / `.menu-columns-wrapper` | `.ursa-nav-viewport` / `.ursa-nav-track` |
| `.menu-column`, `.menu-column-list` | `ul.ursa-nav-list` (one per column) |
| `.menu-column-item`, `.menu-column-item-row` | `li.ursa-nav-item` (the item is the row) |
| `.menu-column-label` | `.ursa-nav-link` |
| `.menu-column-arrow` | — (`[data-branch]::after`) |
| `.has-children`, `.has-dropdown`, `.has-flyout` | `[data-branch]` |
| `.selected` | `[data-trail]` |
| `.current-page`, `.mobile-menu-current` | `.ursa-nav-link[aria-current="page"]` |
| `.is-index` | `[data-index]` |
| `.menu-scroll-btn.scroll-left/-right` | `.ursa-nav-scroll[data-direction="back\|forward"]` |
| `.menu-scroll-indicator .scroll-to-current` | `.ursa-nav-jump` |
| `.mobile-menu-list/-item/-label`, `.mobile-menu-depth-N` | `.ursa-sitenav[data-layout="tree"]` nested `ul.ursa-nav-list` |
| `.mobile-menu-home` | `.ursa-nav-item[data-home]` |
| `.top-menu-level/-item/-label/-dropdown/-flyout`, `.dropdown-item/-label`, `.flyout-indicator` | `.ursa-topnav[data-layout="bar"]` nested lists; indicators are `::after` |
| `ul.menu-level`, `li.menu-item`, `.menu-item-row`, `.menu-label`, `.menu-more`, `.menu-icon` (the root level `automenu.js`/`customMenu.js` render into `${menu}`) | the same `.ursa-nav-list` / `.ursa-nav-item` / `.ursa-nav-link` markup `menu.js` uses, so the pre-JS menu is a working list and upgrading it to columns doesn't change vocabulary; the home icon is an `.ursa-icon` |
| `.menu-breadcrumb`, `.menu-back`, `.menu-home`, `.menu-current-path` | — (rendered with `display:none`, never shown, no styles) |
| `nav.ursa-menu.ursa-menu-horizontal/-vertical` | `nav.ursa-nav.ursa-menu[data-layout="bar\|tree"]` |
| `.ursa-menu-level[data-depth]`, `.ursa-menu-item` | `.ursa-nav-list`, `.ursa-nav-item` |
| `.ursa-menu-has-children` / `-current` / `-active` | `[data-branch]` / `[aria-current="page"]` on the link / `[data-trail]` |
| `.ursa-menu-text` | `.ursa-nav-text` |
| `nav.breadcrumbs`, `.breadcrumb-link`, `.breadcrumb-current`, `.breadcrumb-sep` | `nav.ursa-breadcrumbs > ol > li > a[aria-current]`; separators are CSS |

### Document

| Old | New |
|---|---|
| `section.sectionOuter` (sectionify.js) | `section.ursa-section[data-level="1"]` (render time) |
| `--section-index` (inline) | — (use a CSS counter) |
| wikitext `div.sectionOuter.sectionOuter1` > `h1` + `a[name]` + `div.section.section1` | `section.ursa-section[data-level="1"]` > `h1[id]` + content |
| wikitext `div.sectionOuter2` > `h2` + `a[name]` + `div.section2` | `section.ursa-section[data-level="2"]` > `h2[id]` + content |
| `aside.sidebarSection`, `aside.right.sidebarSection` | `aside.ursa-sidebar` |
| `div.indent1` / `div.indent2` | `div.ursa-indent[data-level="1\|2"]` |
| `span[style="font-size: 150%"]` / `200%` | `span.ursa-big[data-level="1\|2"]` |
| `div.tableContainer` | `div.ursa-table-scroll` |
| `a.wikiLink[data-article]` | `a.ursa-wikilink[data-article]` |
| `img.wikiImage.wiki-image`, `span.wiki-image-container`, `.wikiImage_caption`, `.noImage` | `figure[data-align] > img + figcaption` |
| `table.frontmatter-table` | `dl.ursa-frontmatter` |
| `ul.auto-index.depth-N` | `nav.ursa-autoindex > ul` (nested) |
| `a.image-link` | `a.ursa-image-link` |
| `a.inactive` | `a[data-ursa-broken]` |
| `h1/h2/h3.stuck` | `[data-ursa-stuck]` |
| `h1[data-original-text]` + rewritten text | `h1[data-ursa-trail]` + `::after` |
| heading ids `heading-N-text` (client) | slug ids (server) |

### Image actions and lightbox

| Old | New |
|---|---|
| `.ursa-image-controls` / `.ursa-image-btn` | `.ursa-image-actions` / `.ursa-image-action[data-action]` |
| `div.ursa-lightbox[role=dialog][hidden]` | `dialog.ursa-lightbox` |
| `.ursa-lightbox-backdrop` | `::backdrop` |
| `body.ursa-lightbox-open` | `.ursa:has(> .ursa-lightbox[open])` |
| `.is-pannable` / `.is-panning` / `.is-placeholder` | `[data-pannable]` / `[data-panning]` / `[data-placeholder]` |
| `.ursa-lightbox-btn[data-zoom]`, `.ursa-lightbox-download`, `.ursa-lightbox-close` | `.ursa-lightbox-button[data-action="zoom-in\|zoom-out\|download\|close"]` |

### Custom properties

| Old | New |
|---|---|
| `--bg-color` | `--ursa-bg` |
| `--text-color` | `--ursa-fg` |
| `--nav-top-bg` | `--ursa-surface` (or `--ursa-topbar-bg` for the topbar alone) |
| `--widget-bg` | `--ursa-surface` (or `--ursa-panel-bg`) |
| `--widget-border` | `--ursa-border` (or `--ursa-panel-border`) |
| `--link-color` (referenced, never defined) | `--ursa-link` |
| `--article-width` | `--ursa-doc-width` |
| `--global-nav-height` | `--ursa-topbar-height` |
| `--ursa-toc-gutter`, `--ursa-toc-max` (private) | `--ursa-toc-gutter`, `--ursa-toc-max-width` (public) |
| `--twisty-size` (unused) | — |
| `aqua` / `rgba(0,255,255,…)` literals | `--ursa-accent`, `--ursa-highlight` |
| `rgba(128,128,128,.1–.2)` literals | `--ursa-hover`, `--ursa-selected`, `--ursa-border` |

---

## Visual changes

The new stylesheet reproduces the current look. Where it doesn't, on purpose:

- **Document links** use `--ursa-link` instead of browser defaults, so they are readable in dark mode (today they are the UA's dark blue on `#121212`).
- **Borders and tints** are `currentColor` mixes instead of fixed greys; in the default palette the difference is a few levels of grey.
- **Menu toggle** gets the same hover as the other toolbar buttons (background tint, full opacity) instead of dimming to 70%.
- **Mobile menu** indents nested levels with nested lists (separators indent too) instead of flat rows with depth classes.
- **Sticky h1** gets `white-space: nowrap` so its existing `text-overflow: ellipsis` actually applies; the scrolled-into trail is separated by `›`.
- **`::: aside`** gets a left rule; wikitext **sidebars** float right; **indents** indent; **frontmatter** is a two-column grid. None of these had default styles.
- **Focus** is visible on toolbar buttons and the search input (accent outline).
