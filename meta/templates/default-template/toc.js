// Table of contents
//
// Builds `nav.ursa-toc > ol > li[data-level] > a` into the TOC panel from the
// document's h1–h3, and marks the entry for the section being read with
// aria-current="true". Heading ids are rendered by the server; a heading
// without one (e.g. rendered late by an island) cannot be linked to and is
// left out. Opening and closing the panel is widgets.js's job, not this one's.
document.addEventListener('DOMContentLoaded', () => {
    const panel = document.querySelector('.ursa-panel[data-widget="toc"]');
    const doc = document.querySelector('.ursa-main .ursa-doc');
    if (!panel || !doc) return;

    const button = document.querySelector('.ursa-button[data-widget="toc"]');
    const title = panel.querySelector('.ursa-panel-title');

    const nav = document.createElement('nav');
    nav.className = 'ursa-toc';
    if (title && title.id) nav.setAttribute('aria-labelledby', title.id);
    const list = document.createElement('ol');
    nav.appendChild(list);
    panel.appendChild(nav);

    // The headings the TOC currently reflects, and each one's link. Rebuilt on
    // ursa:content-changed, since an island may add headings after load (see
    // content-hooks.js).
    let headings = [];
    let linkFor = new Map();
    let activeLink = null;

    // Headings Ursa's sticky/content styles do not reach are not part of the
    // document's outline either: an author's unstyled block, a named menu.
    const EXCLUDED = '.ursa-unstyled, .ursa-nav, .ursa-breadcrumbs';

    function collectHeadings() {
        return Array.from(doc.querySelectorAll('h1, h2, h3'))
            .filter(h => h.id && !h.closest(EXCLUDED));
    }

    // === sticky lines =====================================================
    //
    // Each heading counts as reached once its top has come up to the line it
    // sticks at: under the topbar for an h1, under the stuck h1 for an h2, and
    // so on (ursa-chrome.css). Read from the heading's own computed `top`
    // rather than from tokens, so a site that restyles the sticky stack is
    // followed. A heading that does not stick uses the topbar's bottom edge.

    function topbarBottom() {
        const bar = document.querySelector('.ursa-topbar');
        const b = bar && bar.getBoundingClientRect();
        return b ? Math.max(0, Math.round(b.bottom)) : 48;
    }

    let lineOf = new Map();
    function readLines() {
        const fallback = topbarBottom();
        lineOf = new Map(headings.map(h => {
            const style = getComputedStyle(h);
            const top = style.position === 'sticky' ? parseFloat(style.top) : NaN;
            return [h, Number.isFinite(top) ? Math.round(top) : fallback];
        }));
        // keep anchor jumps (a #hash in the URL, a link from elsewhere in the
        // document) landing where the heading sticks, not under the bar
        headings.forEach(h => { h.style.scrollMarginTop = lineOf.get(h) + 'px'; });
    }

    // === (re)build ========================================================

    function buildToc() {
        headings = collectHeadings();
        activeLink = null;

        if (headings.length === 0) {
            // Nothing to list: hide the toolbar button (widgets.js reads this
            // to decide whether to restore the panel) and the empty list.
            if (button) button.hidden = true;
            nav.hidden = true;
            list.replaceChildren();
            linkFor = new Map();
            return;
        }
        if (button) button.hidden = false;
        nav.hidden = false;

        linkFor = new Map();
        list.replaceChildren(...headings.map(heading => {
            const item = document.createElement('li');
            item.dataset.level = heading.tagName.slice(1);

            const link = document.createElement('a');
            link.href = `#${heading.id}`;
            link.textContent = heading.textContent.trim();
            link.addEventListener('click', handleTocClick);

            linkFor.set(heading, link);
            item.appendChild(link);
            return item;
        }));
    }

    // Smooth-scroll a heading to the line it sticks at, so it arrives stuck and
    // is at once the active entry.
    function handleTocClick(e) {
        const target = headings.find(h => linkFor.get(h) === e.currentTarget);
        if (!target) return;
        e.preventDefault();
        const line = lineOf.get(target) ?? topbarBottom();
        window.scrollTo({
            top: target.getBoundingClientRect().top + window.scrollY - line,
            behavior: 'smooth'
        });
    }

    // === active entry =====================================================
    //
    // The last heading (in document order) whose top has reached its sticky
    // line; before the first one, the first. A stuck heading stays at its line
    // until its section ends, so "reached" holds for it throughout.

    function updateActive() {
        let active = headings[0] || null;
        for (const h of headings) {
            if (h.getBoundingClientRect().top <= lineOf.get(h) + 1) active = h;
            else break;
        }
        const link = active ? linkFor.get(active) : null;
        if (link === activeLink) return;
        if (activeLink) activeLink.removeAttribute('aria-current');
        if (link) link.setAttribute('aria-current', 'true');
        activeLink = link;
        queueCentreActiveEntry();
    }

    // The answer above only changes when a heading's top crosses its own line,
    // so watch exactly that: one observer per distinct line, its root reaching
    // from far above the viewport down to that line. A heading intersects it
    // exactly while it has reached its line, so any change of "reached" — even
    // a jump that carries a heading past the line in one frame — is an event,
    // and the active entry is re-derived from positions.
    const ABOVE = 1e5;
    let observers = [];
    function observe() {
        observers.forEach(o => o.disconnect());
        observers = [];
        const byLine = new Map();
        headings.forEach(h => {
            const line = lineOf.get(h);
            if (!byLine.has(line)) byLine.set(line, []);
            byLine.get(line).push(h);
        });
        byLine.forEach((group, line) => {
            const below = Math.max(0, window.innerHeight - line - 1);
            const o = new IntersectionObserver(updateActive, {
                rootMargin: `${ABOVE}px 0px -${below}px 0px`,
                threshold: 0
            });
            group.forEach(h => o.observe(h));
            observers.push(o);
        });
    }

    function refresh() {
        readLines();
        observe();
        updateActive();
    }

    /* --- Keeping the current entry in view -------------------------------
     *
     * Below the panel breakpoint the stylesheet lays this same list on its
     * side: one line tall, along the bottom of the viewport. A line that long
     * cannot show every heading at once, so the entry the reader is currently
     * under has to be brought to them rather than looked for.
     *
     * It goes to the middle where there is room to put it there. Where there is
     * not — a document with too few headings to fill the line, or a reader
     * still near the top of a long one — asking for the middle would mean
     * scrolling past the start of the list and showing blank strip before the
     * first entry. Nothing below special-cases either of those: scrollLeft is
     * clamped to the content by the browser, so both come to rest in their
     * natural position on their own. In the vertical panel there is no
     * horizontal overflow to begin with and the same call does nothing at all.
     *
     * Measured from bounding rects rather than offsetLeft because the offset
     * parent is the panel, not the scrolling element (the nav), and a theme is
     * free to move one without the other.
     */
    function centreActiveEntry(behavior) {
        if (!activeLink) return;

        const container = nav.getBoundingClientRect();
        const entry = activeLink.getBoundingClientRect();
        if (!container.width) return; // panel is closed; nothing is laid out

        const delta = (entry.left + entry.width / 2) - (container.left + container.width / 2);
        nav.scrollTo({ left: nav.scrollLeft + delta, behavior: behavior || 'smooth' });
    }

    // Coalesced to a frame: a fast scroll can move the active entry several
    // times between paints.
    let centreQueued = false;
    function queueCentreActiveEntry() {
        if (centreQueued) return;
        centreQueued = true;
        requestAnimationFrame(() => {
            centreQueued = false;
            centreActiveEntry();
        });
    }

    // Nothing has a width until the panel is open, so the first placement has
    // to wait for it — and it is a first appearance, not a move, so it does not
    // animate. Same for a resize, which can change what fits either way.
    document.addEventListener('widget-opened', (event) => {
        if (event.detail.widget === 'toc') centreActiveEntry('auto');
    });

    // A resize can move every line (topbar height, sticky heights in rem) and
    // always moves the bottom margin of each observer's band.
    let resizeQueued = false;
    window.addEventListener('resize', () => {
        if (resizeQueued) return;
        resizeQueued = true;
        requestAnimationFrame(() => {
            resizeQueued = false;
            refresh();
            centreActiveEntry('auto');
        });
    }, { passive: true });

    document.addEventListener('ursa:content-changed', () => {
        buildToc();
        refresh();
    });

    buildToc();
    refresh();
});
