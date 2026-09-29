# Semantic markup and CSS v2

**Status:** implemented in 0.101.0 (breaking, see [Versioning](#versioning)).

Ursa's markup and default stylesheet go back more than a decade: `div.sectionOuter`, `#main-content`, `nav#nav-global`, `.widget-dropdown.hidden`, three different class vocabularies for the same menu, and colours pasted as `rgba(128,128,128,0.15)` or `aqua` wherever they are used. 0.8x's `@scope`/`@layer` work stopped content and chrome styles from fighting, but kept the old selectors. This change replaces them.

## Goals

1. **HTML5 semantics.** Landmarks (`header`, `nav`, `main`, `aside`, `footer`, `search`), real sections, list markup for lists, `dl` for key/value data, `dialog` for the lightbox. State through ARIA and `hidden` wherever there is a native way to say it.
2. **One naming convention** for classes, attributes, IDs, custom properties, events and storage keys, stated once and followed everywhere.
3. **Scopes built for customisation and isolation.** A site's CSS always wins without IDs, long selectors or `!important`; Ursa's CSS never matches anything outside its own root, so a document's HTML can be dropped into another application.
4. **Tokens and the cascade instead of repetition.** Every colour, font, size and z-index in the default stylesheet comes from a small set of custom properties; tints derive from `currentColor`; light and dark are one `light-dark()` declaration, not two blocks.
5. **No compatibility layer.** Old selectors stop working in one release. The migration is done once, per site, with the [migration guide](MIGRATION.md).

## Files

| File | What it is |
|---|---|
| [SPEC.md](SPEC.md) | The conventions, the page anatomy, and the complete old → new mapping, component by component. |
| [ursa-base.css](../../../../meta/templates/default-template/ursa-base.css) | Layer order, tokens, root reset. Page *and* embed. |
| [ursa-content.css](../../../../meta/templates/default-template/ursa-content.css) | Portable document styles. Page *and* embed. |
| [ursa-chrome.css](../../../../meta/templates/default-template/ursa-chrome.css) | The frame and Ursa's components (menus, panels, search, breadcrumbs, sticky headings, lightbox). Page only. Replaces `default.css` and `lightbox.css`. |
| [examples/page.html](examples/page.html) | Example render: a full default-template page after scripts have run. Opens standalone. |
| [examples/embed.html](examples/embed.html) | Example render: a document's `bodyHtml` inside a host application. |
| [examples/site-minimal.css](examples/site-minimal.css) | A site stylesheet that is only tokens. |
| [examples/site-grimoire.css](examples/site-grimoire.css) | A fully themed site: fonts, both schemes, content rules in `@scope`, chrome touches. |
| [examples/folder-classes-style.css](examples/folder-classes-style.css) | A folder-level `style.css` layered on the site one. |
| [examples/site-color-scheme.css](examples/site-color-scheme.css) | Light/dark patterns: follow the OS, pin one scheme, user toggle, one region inverted. |
| [MIGRATION.md](MIGRATION.md) | Guideline for agents migrating an existing site's stylesheets. |
| [TODO.md](TODO.md) | Implementation plan. |

The CSS files are the default stylesheet (they live in the default template), written to reproduce today's look under the new markup (deliberate differences are listed in [SPEC.md § Visual changes](SPEC.md#visual-changes)). They were checked by rendering `examples/page.html` in Chromium in light, dark and mobile viewports, with and without `site-grimoire.css`.

## Key decisions

**D1. Everything Ursa ships is layered.** `@layer ursa.reset, ursa.tokens, ursa.content, ursa.chrome`. A site's stylesheet is unlayered, so any site rule beats any Ursa rule regardless of specificity — for content *and* chrome. Today chrome is deliberately unlayered, so a site's `a { … }` can't restyle the navigation; the price is that restyling the navigation means out-specifying `nav#nav-main .menu-column-item.selected > .menu-column-item-row`. v2 takes the other side of that trade: chrome is customised by tokens first and single-class selectors second, and a site keeps its broad element rules off the chrome by writing them inside `@scope (.ursa-doc)` — which the examples and the migration guide do throughout. (Considered and rejected: wrapping site CSS in a layer at bundle time — it would make chrome un-overridable except by token.)

**D2. `.ursa` is the root; nothing matches outside it.** On a page it is `<body>`; an embedder puts it on the element that holds the document. No rule in any Ursa stylesheet targets `html`, `:root` or bare `body`; tokens are declared on `.ursa`, not `:root`. The only global is `@keyframes ursa-spin`.

**D3. Content and frame are separate files.** `ursa-content.css` styles a document and assumes nothing about the page around it (no topbar offset, no widths, no sticky headings), so it is safe to load in a host app. Page-only document behaviour lives in `ursa-chrome.css`, scoped to `.ursa-main .ursa-doc`.

**D4. Sections are built at render time.** `sectionify.js` goes; the Markdown and wikitext renderers both emit nested `<section class="ursa-section" data-level="n">`, one per h1 and h2, so the JSON's `bodyHtml`, the HTML page and MDX hydration all see the same structure. Heading IDs become server-side slugs.

**D5. One navigation component.** The side menu (columns), the mobile menu (tree), the top menu (bar) and named in-document menus (bar/tree) share one markup vocabulary — `.ursa-nav` › `.ursa-nav-list` › `.ursa-nav-item` › `.ursa-nav-link` — and differ by `data-layout`. This replaces the `menu-column-*`, `mobile-menu-*`, `top-menu-*`/`dropdown-*` and `ursa-menu-*` class sets.

**D6. State is attributes, not classes.** `aria-current`, `aria-expanded`, `aria-selected` and `hidden` where they mean the right thing; `data-*` otherwise. No `.active`, `.hidden`, `.selected`, `.stuck`, `.collapsed`, `.is-*`.

**D7. Baseline raised.** `light-dark()` needs Chrome 123, Safari 17.5, Firefox 120; `<search>` degrades to a plain block elsewhere. With `@scope` already requiring Chrome 118 / Safari 17.4 / Firefox 128, the effective floor becomes **Chrome 123, Safari 17.5, Firefox 128**.

## Versioning

**Recommendation: stay on 0.x and release this as a minor version** (it shipped as 0.101.0, since 0.100.0 went to custom menus). Keep 1.0 for the stability commitment already sketched in `docs/1.0/`.

- Under semver, anything goes in 0.x, and the ecosystem's convention for "breaking" in 0.x is the **minor** number. npm's caret ranges already encode it: `^0.99.0` means `>=0.99.0 <0.100.0`, so nobody on a caret range picks up 0.100.0 by accident. The release is as loud as a major bump for exactly the people it would break.
- **0.100.0 is valid semver.** Components are integers, not decimals; there is no rollover to 1.0 after 0.99.
- 1.0 says "the public API is defined and will only break with a major version." That is a promise about the whole surface — CLI flags, folder conventions, `config.json` keys, JSON output shape, template placeholders *and* CSS — not about readiness. Ursa is still reshaping several of those (the 1.0 doc's Factory/Regeneration rewrite, `dev`'s future), so 1.0 now would be followed by 2.0 and 3.0 soon after, which dilutes what the major number tells users.
- This change is, however, the first time Ursa's styling surface is *designed as an API* (the token list and the class/attribute contract in SPEC.md). That makes it a good **1.0 prerequisite**: add "styling contract frozen" to the 1.0 checklist.
- "General readiness" is better signalled in the README (a Status section: what's stable, what's moving) than by the version number.

The CHANGELOG entry for 0.101.0 opens with **Breaking:** and links MIGRATION.md.
