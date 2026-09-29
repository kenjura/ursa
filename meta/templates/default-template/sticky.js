// Sticky headings
//
// ursa-chrome.css makes h1–h3 in the page's document sticky, each within its
// own section (sections are rendered by the server, one per h1 and one per h2
// nested inside it). This marks the ones currently stuck with
// data-ursa-stuck, and writes the stuck h2/h3 text into the stuck h1's
// data-ursa-trail ("Hit Points › Level 1"), which the stylesheet shows after
// the h1's own text. The headings' own DOM is never touched.
document.addEventListener('DOMContentLoaded', () => {
    const doc = document.querySelector('.ursa-main .ursa-doc');
    if (!doc) return;

    const TRAIL_SEPARATOR = ' › '; // the one before the trail is the stylesheet's

    // The headings the stylesheet makes sticky: not those in an author's
    // unstyled block or in a named menu, where its sticky scope stops.
    // Re-collected on ursa:content-changed, since an island may add headings
    // after load (see content-hooks.js).
    const collect = () => Array.from(doc.querySelectorAll('h1, h2, h3'))
        .filter(h => !h.closest('.ursa-unstyled, .ursa-nav, .ursa-breadcrumbs'));
    let headings = collect();

    // Stuck: at (or sliding out from under) the line it sticks at. A heading
    // whose section is ending stays stuck until it has slid all the way past
    // that line, then lets go; the next section's heading arrives at the line
    // in the same moment, so the handover is seamless.
    function isStuck(el) {
        const style = getComputedStyle(el);
        if (style.position !== 'sticky' || style.top === 'auto') return false;
        const top = parseFloat(style.top) || 0;
        const rect = el.getBoundingClientRect();
        return rect.top <= top + 0.5 && rect.bottom > top;
    }

    function setFlag(el, name, on) {
        if (on) { if (!el.hasAttribute(name)) el.setAttribute(name, ''); }
        else el.removeAttribute(name);
    }

    function updateStuckState() {
        // In document order: each h1 collects the stuck h2/h3 after it. An h2
        // clears the h3 before it — an h3 that sits in the h1's own section,
        // ahead of the first h2, stays stuck for the whole h1 section, but it
        // no longer describes where the reader is once an h2 has stuck.
        let current = null;
        const trails = [];

        headings.forEach(el => {
            const stuck = isStuck(el);
            setFlag(el, 'data-ursa-stuck', stuck);

            if (el.tagName === 'H1') {
                current = { h1: el, h2: null, h3: null };
                trails.push(current);
            } else if (current && stuck) {
                if (el.tagName === 'H2') { current.h2 = el; current.h3 = null; }
                else current.h3 = el;
            }
        });

        trails.forEach(({ h1, h2, h3 }) => {
            const parts = h1.hasAttribute('data-ursa-stuck')
                ? [h2, h3].filter(Boolean).map(h => h.textContent.trim())
                : [];
            const trail = parts.join(TRAIL_SEPARATOR);
            if (trail) {
                if (h1.getAttribute('data-ursa-trail') !== trail) h1.setAttribute('data-ursa-trail', trail);
            } else {
                h1.removeAttribute('data-ursa-trail');
            }
        });
    }

    let queued = false;
    function queueUpdate() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            updateStuckState();
        });
    }

    updateStuckState();
    window.addEventListener('scroll', queueUpdate, { passive: true });
    window.addEventListener('resize', queueUpdate);
    document.addEventListener('ursa:content-changed', () => {
        headings = collect();
        updateStuckState();
    });
});
