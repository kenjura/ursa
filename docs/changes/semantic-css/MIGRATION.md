# Migrating a site's styles to Ursa's v2 markup and CSS

**Audience:** an agent (or a person) asked to update an existing Ursa site so it renders correctly on Ursa 0.101.0 or later.
**Goal:** the site looks the way it did, its stylesheets are shorter than they were, and nothing in them depends on selectors Ursa no longer emits.

Read these first; this guide assumes them:
- [SPEC.md §1 Naming](SPEC.md#1-naming) and [§5 CSS architecture](SPEC.md#5-css-architecture) — the rules the output must follow.
- [SPEC.md §7 Old → new mapping](SPEC.md#7-old--new-mapping) — the lookup table. It is the single source of truth for renames; this guide does not repeat it.
- [examples/site-grimoire.css](examples/site-grimoire.css) — what a finished site stylesheet looks like.

There is no compatibility layer. Every old selector either gets translated or deleted.

---

## Ground rules

1. **Preserve the look, not the code.** The deliverable is visual parity (plus the fixes the site author wants). A rule that existed only to beat Ursa's old specificity has no reason to survive.
2. **Tokens before selectors.** If a rule sets a colour, font, width or height that Ursa has a token for, set the token instead and delete the rule.
3. **Never:** select by ID; use `!important`; wrap site CSS in `@layer` (a layered site rule *loses* to Ursa); declare tokens on `:root` or `html` (see [Pitfalls](#pitfalls)); style bare `body`/`html` (use `.ursa`).
4. **Content rules go in the content scope.** Any rule that targets document elements (`h1`, `p`, `a`, `table`, `img`, `blockquote`, `code`, …) goes inside `@scope (.ursa-doc) to (.ursa-unstyled) { … }`. This is what keeps a broad `a { … }` from restyling the navigation, since Ursa's chrome no longer out-specifies site rules.
5. **Chrome rules use one Ursa class**, optionally plus attributes: `.ursa-sitefooter`, `.ursa-panel[data-widget="toc"]`, `.ursa-sitenav .ursa-nav-link`. If you need more than two compound selectors, look for a token first.
6. **Don't touch documents unless asked.** Markdown/wikitext source is out of scope. Raw HTML embedded in documents that uses Ursa's *old* class names (`sectionOuter`, `wikiImage`, …) is listed in the report for a human, not rewritten.
7. **Ask before deleting** anything you can't account for: a rule whose selector matches nothing in the new markup *and* nothing in the old markup may be for the author's own raw-HTML content.

---

## Inputs

Collect all of these before changing anything:

- Every site stylesheet: `style.css`, `style-ursa.css`, `_style.css` in the docroot and every subfolder. Note each one's folder — a deeper file is loaded after (and applies only below) a shallower one, and that doesn't change.
- Every site script: `script.js` (same inheritance). Scripts that query or toggle Ursa's classes/IDs break too.
- Custom templates in the site's meta directory, if any (`index.html` files with `${body}` etc.).
- Raw HTML in documents that references Ursa classes: grep the docroot for the old names in [the leftover check](#leftover-check).
- A build of the site on the **old** Ursa version, for reference screenshots.

---

## Procedure

### 1. Baseline

Build the site with the old Ursa. Screenshot a representative set of pages — the home page, a deep page, a long page scrolled (sticky headings), a page with images, a page with a named menu, a folder index — at 1440×900 and 390×800, in light and dark scheme if the site supports both. Keep them for step 6.

### 2. Inventory

For each stylesheet, list every rule and classify it:

| Class | How to recognise it | What happens to it |
|---|---|---|
| **T — token** | Sets colour/background/border-colour/font-family/width of the document/topbar height on Ursa's structure, or redefines an old custom property (`--bg-color`, `--article-width`, …) | Becomes a token on `.ursa` (step 3) |
| **C — content** | Targets document elements, author classes, or old content wrappers (`#main-content h2`, `.sectionOuter p`, `article table`) | Rewritten inside `@scope (.ursa-doc)` (step 4) |
| **U — Ursa chrome** | Targets old chrome (`nav#nav-main …`, `.widget-dropdown`, `.breadcrumbs`, `.search-results`, `#site-footer`) | Rewritten against the new component classes, or replaced by a component token (step 5) |
| **S — scheme** | `@media (prefers-color-scheme: …)` blocks | Folded into `light-dark()` tokens (step 3) |
| **X — escalation** | Exists only to beat Ursa: repeated selectors, `!important`, `html body …`, ID chains duplicating an earlier rule | Deleted; the rule it was protecting is handled under its own class |
| **D — dead** | Matches nothing in either the old or new markup | Reported, kept or deleted per the author (rule 7) |

### 3. Tokens (T, S)

Map old custom properties with [SPEC.md §7 Custom properties](SPEC.md#custom-properties). Map literal values by what they colour:

| Old rule sets… | Token |
|---|---|
| page / article background | `--ursa-bg` |
| body / article text colour | `--ursa-fg` |
| top bar, menu, widget, dropdown, stuck-heading background | `--ursa-surface` (or `--ursa-topbar-bg`, `--ursa-panel-bg`, `--ursa-sticky-bg` if they differ) |
| "current"/"active"/highlight colour (often `aqua`) | `--ursa-accent` |
| link colour in articles | `--ursa-link` (+ `--ursa-link-visited`) |
| body font / heading font / nav font | `--ursa-font-body` / `--ursa-font-heading` / `--ursa-font-chrome` |
| article width | `--ursa-doc-width` |
| top bar height | `--ursa-topbar-height` |
| border / divider greys, hover greys | usually nothing: Ursa's tints follow `color`. Set `--ursa-border` etc. only if the site's border is *not* a tint of its text colour |

Scheme blocks: pair the light and dark values into one declaration.

```css
/* before */
:root { --bg-color: #f4ecd8; --text-color: #2b2118; }
@media (prefers-color-scheme: dark) {
  :root { --bg-color: #1b1712; --text-color: #e8dcc2; }
}

/* after */
.ursa {
  --ursa-bg: light-dark(#f4ecd8, #1b1712);
  --ursa-fg: light-dark(#2b2118, #e8dcc2);
}
```

A site that only ever had one scheme (it set dark colours unconditionally) gets `color-scheme: dark` on `.ursa` and plain values. A site that set only the light half should keep Ursa's dark defaults by writing only the light half inside `light-dark()`: `--ursa-bg: light-dark(#f4ecd8, #121212)`. See [examples/site-color-scheme.css](examples/site-color-scheme.css).

### 4. Content (C)

```css
/* before */
#main-content h1 { font-family: Goudy; color: darkred; }
article#main-content .sectionOuter > p:first-of-type::first-letter { font-size: 3em; }
#main-content table td { padding: 4px 12px !important; }
.wikiImage_caption { font-style: italic; }

/* after */
.ursa {
  --ursa-font-heading: "Site Goudy", serif;
}
@scope (.ursa-doc) to (.ursa-unstyled) {
  h1 { color: darkred; }
  .ursa-section[data-level="1"] > p:first-of-type::first-letter { font-size: 3em; }
  td { padding: 4px 12px; }
  figcaption { font-style: italic; }
}
```

- Drop every content-wrapper prefix (`#main-content`, `article`, `.sectionOuter`, `.section1`); the scope is the prefix.
- `.sectionOuter` → `.ursa-section[data-level="1"]`; wikitext `.sectionOuter2` → `.ursa-section[data-level="2"]`; `.section1`/`.section2` (the inner body div) no longer exists — a rule on it moves to the section, or to `.ursa-section > :not(h1, h2)` if it must skip the heading.
- `h1.stuck` → `h1[data-ursa-stuck]`. Sticky-heading geometry is tokens (`--ursa-sticky-h1`, …); turning stickiness off is `h1, h2, h3 { position: static; }` in the scope.
- Wikitext legacy classes: see SPEC §7 Document. `.right.sidebarSection` → `.ursa-sidebar`; image `.wikiImage` → `figure`.
- `a.inactive` → `a[data-ursa-broken]`.
- Rules for the author's own classes (from raw HTML in documents) move into the scope unchanged.

### 5. Chrome (U)

Translate with SPEC §7, then shorten:

```css
/* before */
nav#nav-main .menu-column-item.current-page > .menu-column-item-row { background: rgba(255,0,0,.2) !important; }
nav#nav-main .menu-column-item.selected > .menu-column-item-row .menu-column-label { font-weight: bold; }
.widget-dropdown[data-active-widget="toc"] { background: rgba(20,24,28,.78); }
#widget-dropdown .widget-header-title { font-variant: small-caps; }
nav#nav-global { background: #2b2118; }
nav#nav-global .widget-button { color: #f4ecd8; }
footer#site-footer .footer-meta { display: none; }

/* after */
.ursa {
  --ursa-accent: red;            /* if red was the site's highlight everywhere */
  --ursa-topbar-bg: #2b2118;
  --ursa-topbar-fg: #f4ecd8;
}
.ursa-sitenav [data-trail] > .ursa-nav-link { font-weight: bold; }
.ursa-panel[data-widget="toc"] { background: rgb(20 24 28 / .78); }
.ursa-panel-title { font-variant: small-caps; }
.ursa-sitefooter-meta { display: none; }
```

- `.widget-dropdown` (both panels) → `.ursa-panel`; `#widget-dropdown` (right) → `.ursa-panel[data-side="end"]`; `#widget-dropdown-left` → `.ursa-panel[data-side="start"]`.
- Old desktop-menu and mobile-menu rules for the same thing collapse into one `.ursa-sitenav` rule, or split by `[data-layout="columns"]` / `[data-layout="tree"]` if they really differed.
- `.top-menu-*` and `.ursa-menu-*` (named menus) → `.ursa-topnav` / `.ursa-menu` with the shared `.ursa-nav-*` parts.
- `.hidden` / `.active` state selectors → `[hidden]`, `[aria-expanded="true"]`, `[aria-current]`, `[aria-selected="true"]` per SPEC §1 State.

### 6. Scripts

In each site `script.js`, update every selector string and class toggle using SPEC §7, and:
- `el.classList.add('hidden')` → `el.hidden = true`.
- Reading `.active`/`.selected` → read the ARIA attribute.
- Anything that waited for `sectionify.js` (e.g. `DOMContentLoaded` + `setTimeout`) can read sections immediately: they are in the HTML.
- Anything that re-read `heading.textContent` of a stuck h1 no longer sees the trail appended.
- Listen for `ursa:content-changed` rather than polling if the script tracks article content.

### 7. Assemble

Rewrite each stylesheet in this order, with a one-line comment per section: `@font-face` → tokens on `.ursa` → component tokens → `@scope (.ursa-doc) to (.ursa-unstyled)` block → chrome rules. Put tokens that only apply to one folder in that folder's `style.css`, not behind a path selector in the root one. Rename site-defined font families to site-specific names (`"Grimoire Goudy"`, not `"Goudy"`), since `@font-face` is global and the CSS may be reused in an embed.

### 8. Verify

1. **Build** with the new Ursa. No build warnings about stylesheets (Ursa warns about each site `style.css`/`script.js` that still uses removed names, about tokens declared on `:root`, and — in one summary line — about documents whose raw HTML uses old class names).
2. **Leftover check** — every one of these must return nothing across the site's CSS and JS:
   ```sh
   grep -rnE '#(main-content|nav-global|nav-main|nav-main-top|site-footer|global-search|widget-dropdown|widget-content|search-results|toc|menu-config|global-nav|ursa-update-indicator)\b' --include=*.css --include=*.js <docroot>
   grep -rnE '\.(sectionOuter|section[12]|sidebarSection|tableContainer|wikiImage|wiki-image|wikiLink|indent[12]|frontmatter-table|auto-index|image-link|inactive|stuck|breadcrumbs?|breadcrumb-(link|sep|current)|menu-(column|button|scroll|item|label|level|loading|icon|more)|mobile-menu|top-menu|dropdown-(item|label)|flyout-indicator|widget-|search-(wrapper|result|section|show-more|clear)|recent-activity|suggested-|footer-(content|meta|copyright)|nav-(left|right)-controls|nav-center|has-(children|dropdown|flyout)|current-page|is-index|ursa-menu-|ursa-image-(controls|btn)|ursa-lightbox-(btn|backdrop|close|download))\b' --include=*.css --include=*.js <docroot>
   grep -rnE -- '--(bg-color|text-color|nav-top-bg|widget-bg|widget-border|link-color|article-width|global-nav-height)\b' --include=*.css --include=*.js <docroot>
   grep -rnE '!important|@layer|^\s*(:root|html|body)\b' --include=*.css <docroot>
   ```
   (The first two patterns are also run over documents for the raw-HTML report; hits there are not errors.)
3. **Screenshots** of the same pages, viewports and schemes as step 1. Compare side by side. Expected differences are listed in [SPEC.md § Visual changes](SPEC.md#visual-changes); anything else is a migration bug.
4. **Interaction pass** on one page: open and close the side menu (desktop and mobile), each toolbar panel, search with results and keyboard selection, a named menu's dropdown, the lightbox; scroll a long page to see sticky headings and the h1 trail.
5. **Scope check:** temporarily add `a { outline: 2px solid red }` *inside* the content scope and confirm no navigation link is outlined; remove it.

### 9. Report

End with a short report for the site author:

```
Migrated: style.css (412 → 138 lines), classes/style.css (60 → 18), script.js (3 selectors)
Tokens set: --ursa-bg, --ursa-fg, --ursa-surface, --ursa-accent, --ursa-font-*, --ursa-doc-width, --ursa-topbar-bg/-fg
Deleted as escalation: 37 rules (!important ×21, ID chains ×16)
Deleted as dead (confirm): .spoiler-old, #sidebar-ad
Visual differences beyond SPEC's list: none | <list with screenshots>
Needs a human: 4 documents contain raw HTML using .sectionOuter (list)
```

---

## Pitfalls

- **Tokens on `:root` don't work.** Ursa declares its tokens on `.ursa` (the `<body>`), and a declaration on an element beats one inherited from its parent, so `:root { --ursa-accent: red }` is shadowed by Ursa's own default. Always `.ursa { … }`.
- **A site rule wrapped in `@layer` loses** to Ursa, whose layers are declared first. Leave site CSS unlayered.
- **Broad selectors now reach the chrome.** Old chrome selectors were specific enough to shrug off `a { color: … }` or `button { … }` in a site stylesheet; the new ones aren't, by design. Every element-type rule belongs in the content scope, or must be one you want on the chrome too.
- **Derived tints follow `color`.** If a migrated rule sets `color` on a chrome component, its borders and hover tints change with it. That is usually right; if not, set `--ursa-border`/`--ursa-hover` on the same element.
- **Plain colour values opt out of scheme switching.** `--ursa-bg: #fff` is white in dark mode too. Use `light-dark()` unless the site is single-scheme.
- **`@scope` proximity.** Inside `@scope (.ursa-doc)`, a site rule beats an unscoped site rule of equal specificity elsewhere in the site's CSS. Keep content rules in one scope block rather than mixing scoped and unscoped versions of the same selector.
- **Sections nest now.** `.ursa-section p` matches paragraphs in h2 sections too; use `> p` where the old rule relied on the flat `sectionOuter` structure.
- **Media queries can't read tokens.** If the site changes `--ursa-doc-width` a lot, its own breakpoints (and Ursa's 800px/1280px) won't move with it; mention it in the report rather than working around it.
