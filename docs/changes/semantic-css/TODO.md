# TODO: semantic markup and CSS v2

Implementation plan for [SPEC.md](SPEC.md). One release (0.100.0), no compatibility layer; phases are ordered so each one can be reviewed on its own branch commit, but the old CSS stops matching as soon as phase 2 lands, so they ship together.

## 0. Decisions to confirm before starting

- [ ] **D1 — all Ursa CSS layered** (site CSS wins everywhere; broad site element rules must move into `@scope (.ursa-doc)`). This reverses the 0.8x "chrome unlayered" choice. See README.
- [ ] **D7 — browser floor** Chrome 123 / Safari 17.5 / Firefox 128 (for `light-dark()`).
- [ ] **Versioning** — 0.100.0; add "styling contract frozen" to `docs/1.0/1.0.md`.
- [ ] **JSON `bodyHtml`** carries sections but not breadcrumbs/injected menus (they are page chrome). Today breadcrumbs are prepended into the body — check what consumers of `--json-only` expect.
- [ ] **Lightbox as `<dialog>`** — confirm `showModal()` behaviour (focus return, Escape) matches the current hand-rolled one closely enough.

## 1. Server-side markup

Renderers emit the new document markup (SPEC §3). Tests updated alongside each.

- [ ] **Sections at render time.** Markdown path (`markdownHelper.cjs` / `fileRenderer.js`): wrap each h1 run, and each h2 run inside it, in `section.ursa-section[data-level]`; preamble (content before the first h1) unwrapped. MDX path (`mdxRenderer.js`): same, as a rehype step, so server HTML and hydrated DOM match.
- [ ] **Wikitext sections** (`wikitextHelper.js` ~L130–170): replace the `sectionOuter`/`section1`/`sectionOuter2`/`section2` templates and `<a name>` anchors; keep author classes/style args on the section; `|right` → `aside.ursa-sidebar`.
- [ ] **Heading IDs**: one slug function shared by Markdown, wikitext and MDX (wikitext currently uses `_`, the TOC generator `heading-N-text`); de-duplicate with `-2`, `-3`. Remove ID generation from `toc-generator.js`.
- [ ] **Wikitext constructs**: `indent1/2` → `.ursa-indent[data-level]`; embiggen inline styles → `.ursa-big[data-level]`; `tableContainer` → `.ursa-table-scroll`; `wikiLink` → `.ursa-wikilink`.
- [ ] **Markdown tables** also wrapped in `.ursa-table-scroll`.
- [ ] **`WikiImage.js`**: emit `figure[data-align] > img + figcaption`; drop the dead `template`/`ng-click` code and `onClick="evt => imageZoom(evt)"` (a no-op string).
- [ ] **`::: aside`** (`markdownHelper.cjs`): `aside.ursa-aside`.
- [ ] **`imageProcessor.js`**: `a.image-link` → `a.ursa-image-link`.
- [ ] **`linkValidator.js`**: `class="inactive"` → `data-ursa-broken` (keep author classes intact; today it concatenates into `class`).
- [ ] **`frontmatterTable.js`**: `table.frontmatter-table` → `dl.ursa-frontmatter` with `div` groups.
- [ ] **`build/autoIndex.js`**: `nav.ursa-autoindex > ul` nested; drop `depth-N`.
- [ ] **`breadcrumbs.js`**: `nav.ursa-breadcrumbs > ol > li`; last item is `a[aria-current="page"]`; no separator spans.
- [ ] **`inlineMenu.js`**: `nav.ursa-nav.ursa-menu[data-layout][data-menu-id]`, `.ursa-nav-list/-item/-link/-text`, `data-branch`, `data-trail`, `aria-current` on the link. `appearance: horizontal|vertical` maps to `bar|tree`. Update the regex at ~L327 that finds rendered menus.
- [ ] **Page header/footer in the document**: breadcrumbs and top-position menus into `header.ursa-doc-header`, bottom-position menus into `footer.ursa-doc-footer`; omit when empty.
- [ ] **`automenu.js` / `customMenu.js`**: root-level menu HTML in the `.ursa-nav-list` vocabulary; `script#menu-config` → `script#ursa-menu-data`; remove the never-shown `.menu-breadcrumb` block; `.menu-icon` spans → `.ursa-icon` SVG. `customMenu.js`'s top-menu HTML (~L724–770) likewise.
- [ ] **`build/footer.js`** and the footer line in `build/site.js` (~L1410): `ursa-sitefooter-*` classes, `<small>`, `<time datetime>`.
- [ ] **Body attributes** (`build/site.js` ~L401, `dev.js` ~L555): `data-menu-position`/`data-custom-menu`/`data-build` → `data-ursa-*`; `class="ursa"` must be on `<body>` in every template.
- [ ] **`serve.js`** live-reload indicator (~L98–147): `output.ursa-status[data-state]`, `hidden` instead of inline display.
- [ ] Update tests: `breadcrumbs.test.js`, `inlineMenu.test.js`, `frontmatterTable.test.js`, `mdxRenderer.test.js`, `build/__test__/autoIndex.test.js`, `build/__test__/pass.test.js`. Add renderer tests for section nesting and slug de-duplication (Markdown, wikitext, MDX).

## 2. Default template

- [ ] Rewrite `meta/templates/default-template/index.html` to SPEC §2 (see `examples/page.html`): `html[lang]`, `meta[name=color-scheme]`, skip link, `header.ursa-topbar`, `search`, one `aside.ursa-panel` per widget, `main.ursa-main > article.ursa-doc[data-ursa-path]`, `footer.ursa-sitefooter`. Remove `#global-nav`.
- [ ] Replace `default.css` + `lightbox.css` with `ursa-base.css`, `ursa-content.css`, `ursa-chrome.css` (from `docs/changes/semantic-css/css/`), linked in that order so the template bundle concatenates them in order.
- [ ] Emit `/public/ursa-content.css` (base + content) as a separate meta output for embedders, including in `--json-only` builds. Wire it into the build graph like the template bundle.
- [ ] Add `data-ursa-path` to the template variables.
- [ ] `lang` from site config (`config.json` `lang`, default `en`).

## 3. Template scripts

- [ ] **Delete `sectionify.js`.** Remove it from the template and from any hydration workaround that ordered around it (`docs/changes/island-hydration.md`).
- [ ] **`menu.js`**: render `.ursa-nav` markup for all three layouts; state via `data-trail`, `aria-current`, `data-branch`, `data-index`, `data-home`; toggle writes `data-ursa-sitenav` on the root and `aria-expanded` on the toggle; `.ursa-nav-scroll[data-direction]`, `.ursa-nav-jump[hidden]`; flyout positioning for `.ursa-topnav` only. The mobile menu becomes a nested tree instead of a flat list with depth classes.
- [ ] **`widgets.js`**: one panel per widget; open/close by `hidden` + the button's `aria-expanded`; storage keys unchanged (`ursa-widget-*`); render recent activity/suggested as `ul.ursa-linklist` with `<time datetime>`; loading/empty as `p.ursa-panel-message`.
- [ ] **`search.js` + widget search**: one renderer for both placements; combobox/listbox ARIA (`aria-expanded`, `aria-activedescendant`, `aria-selected`); `hidden` instead of `.hidden`.
- [ ] **`toc-generator.js` + `toc.js`**: merge; `nav.ursa-toc > ol > li[data-level]`; active entry via `aria-current="true"`; replace `.toc-sentinel` elements with an `IntersectionObserver` on the headings; hide the toolbar button with `hidden` instead of `style.display`.
- [ ] **`sticky.js`**: `data-ursa-stuck`; write `data-ursa-trail` on the stuck h1 instead of rewriting its `textContent`; drop `data-original-text`. Re-check the stuck/unstuck maths now that h2s stick within their own section.
- [ ] **`lightbox.js`**: `dialog.ursa-lightbox` + `showModal()`/`close()`; remove the backdrop element and `body.ursa-lightbox-open`; state attributes (`data-pannable`, `data-panning`, `data-placeholder`); `.ursa-image-actions`/`.ursa-image-action[data-action]`; selectors `article#main-content` → `.ursa-doc`.
- [ ] **`content-hooks.js`**: default root `.ursa-doc`.
- [ ] Grep the template directory for every old class/ID in SPEC §7 — none may remain.

## 4. Other templates

- [ ] `character-sheet-template/index.html`: `body.ursa`, `.ursa-doc` on its article, `.ursa-nav` for its menu; audit `character-sheet.css` and the bundled `cssui.bundle.min.css` for collisions with `ursa-` names (none expected) and for reliance on `#nav-main`/`#main-content`.
- [ ] `template2/index.html` is `foo bar` — delete it or make it a minimal valid template.

## 5. Guard rails

- [ ] **Legacy-selector warning.** When bundling a site `style.css`/`script.js`, scan for the old names (the patterns in MIGRATION.md § Leftover check) and print one warning per file: "`classes/style.css` uses selectors removed in 0.100.0 (`#main-content`, `.sectionOuter`, …) — see docs/changes/semantic-css/MIGRATION.md". Warning only, no rewriting. Remove in a later release.
- [ ] Same scan over document raw HTML, as a single summary line.
- [ ] Optional: warn on site CSS that declares `--ursa-*` on `:root`/`html` (the one pitfall that fails silently).

## 6. Verification

- [ ] Visual regression: a small fixture docroot (Markdown, wikitext and MDX pages; named menus; images; long page) built before and after, screenshotted with Playwright at 1440×900 and 390×800 in light and dark. Differences reviewed against SPEC § Visual changes.
- [ ] Accessibility pass: landmarks (one `banner`, `main`, `contentinfo`; navs labelled), keyboard through topbar → menu → panels → search results → lightbox, axe-core run on the fixture pages.
- [ ] Embed check: render a fixture document's `bodyHtml` in `examples/embed.html`-style host with only `ursa-content.css`; confirm nothing outside `.ursa` changes.
- [ ] Migrate one real site with MIGRATION.md (by an agent following it verbatim), and fold anything it got wrong back into the guide.

## 7. Docs and release

- [ ] README "Styling a Site": replace the layered/unlayered explanation and the `.widget-dropdown[data-active-widget]` section with: tokens, the content scope, component classes, `ursa-unstyled`, color schemes, embedding. Link SPEC.md and MIGRATION.md.
- [ ] Move `docs/changes/semantic-css/css/*` into the template (phase 2) and leave the spec pointing at the template files.
- [ ] `docs/1.0/1.0.md`: add "styling contract (tokens + SPEC §1–4) frozen" to the 1.0 prerequisites.
- [ ] CHANGELOG 0.100.0, opening with **Breaking:** and a link to MIGRATION.md; list the browser floor.
- [ ] Release per `docs/RELEASE_PROTOCOL.md`.
