// Table of Contents Generator
document.addEventListener('DOMContentLoaded', () => {
    // Generate TOC into widget panel if available, otherwise fallback to nav-toc
    const tocTarget = document.getElementById('widget-content-toc') || document.getElementById('nav-toc');
    const article = document.querySelector('article#main-content');
    
    if (!tocTarget || !article) return;
    
    // The headings the TOC currently reflects. Rebuilt on ursa:content-changed,
    // since an island may add headings after load (see content-hooks.js).
    let headings = [];
    const tocButton = document.querySelector('.widget-button[data-widget="toc"]');

    // Add an id=toc wrapper for the toc.js sentinel-based highlighter
    const tocList = document.createElement('ul');
    tocList.id = 'toc';
    tocTarget.appendChild(tocList);

    function headingId(heading, index) {
        const text = heading.textContent.trim()
            .toLowerCase()
            .replace(/[^\w\s-]/g, '') // Remove special characters
            .replace(/\s+/g, '-'); // Replace spaces with hyphens
        let id = `heading-${index}-${text}`;
        // A heading added later can land on an index an earlier one already used
        let n = 2;
        while (document.getElementById(id)) id = `heading-${index}-${text}-${n++}`;
        return id;
    }

    // (Re)build the list from the article's current headings. Headings keep the
    // ids they already have, so existing anchors and links stay valid.
    function buildToc() {
        headings = article.querySelectorAll('h1, h2, h3');

        if (headings.length === 0) {
            // Hide the TOC widget button if no headings
            if (tocButton) tocButton.style.display = 'none';
            tocTarget.style.display = 'none';
            return;
        }
        if (tocButton) tocButton.style.display = '';
        tocTarget.style.display = '';

        tocList.replaceChildren();
        headings.forEach((heading, index) => {
            // Create unique ID for the heading if it doesn't have one
            if (!heading.id) heading.id = headingId(heading, index);

            // Create TOC item
            const listItem = document.createElement('li');
            listItem.className = `toc-${heading.tagName.toLowerCase()}`;

            const link = document.createElement('a');
            link.href = `#${heading.id}`;
            link.textContent = heading.textContent;
            link.addEventListener('click', handleTocClick);

            listItem.appendChild(link);
            tocList.appendChild(listItem);
        });
    }

    buildToc();
    document.addEventListener('ursa:content-changed', () => {
        buildToc();
        updateActiveTocItem();
    });

    // Handle TOC link clicks for smooth scrolling
    function handleTocClick(e) {
        e.preventDefault();
        const targetId = e.target.getAttribute('href').substring(1);
        const targetElement = document.getElementById(targetId);
        
        if (targetElement) {
            // Calculate offset to account for sticky header
            const globalNavHeight = getComputedStyle(document.documentElement)
                .getPropertyValue('--global-nav-height') || '48px';
            const offset = parseInt(globalNavHeight) + 40; // Adjusted offset (was +20, now -29 for 49px less)
            
            const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - offset;
            
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    }
    
    // Update active TOC item based on scroll position
    function updateActiveTocItem() {
        const scrollPosition = window.pageYOffset;
        const globalNavHeight = getComputedStyle(document.documentElement)
            .getPropertyValue('--global-nav-height') || '48px';
        const offset = parseInt(globalNavHeight) + 100;
        
        let activeHeading = null;
        
        // Find the current heading based on scroll position
        headings.forEach(heading => {
            const headingTop = heading.getBoundingClientRect().top + window.pageYOffset;
            if (headingTop <= scrollPosition + offset) {
                activeHeading = heading;
            }
        });
        
        updateTocActiveState(activeHeading);
    }
    
    // Update TOC active state
    function updateTocActiveState(activeHeading) {
        const tocLinks = tocTarget.querySelectorAll('a');
        tocLinks.forEach(link => {
            link.classList.remove('active');
        });
        
        if (activeHeading) {
            const activeLink = tocTarget.querySelector(`a[href="#${activeHeading.id}"]`);
            if (activeLink) {
                activeLink.classList.add('active');
            }
        }
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
     * parent here is the widget dropdown, not the scrolling element, and a
     * theme is free to move one without the other.
     */
    function centreActiveEntry(behavior) {
        const active = tocTarget.querySelector('a.active');
        if (!active) return;
        
        const container = tocTarget.getBoundingClientRect();
        const entry = active.getBoundingClientRect();
        if (!container.width) return; // panel is closed; nothing is laid out
        
        const delta = (entry.left + entry.width / 2) - (container.left + container.width / 2);
        tocTarget.scrollTo({ left: tocTarget.scrollLeft + delta, behavior: behavior || 'smooth' });
    }
    
    // Both highlighters — the scroll handler below and the sentinel observer in
    // toc.js — say which entry is current by putting .active on its link, and
    // neither knows the strip exists. Watching for the class is what lets the
    // two stay that way. Coalesced to a frame because marking the new entry
    // means unmarking every other one, which is a mutation apiece.
    let centreQueued = false;
    function queueCentreActiveEntry() {
        if (centreQueued) return;
        centreQueued = true;
        requestAnimationFrame(() => {
            centreQueued = false;
            centreActiveEntry();
        });
    }
    
    new MutationObserver(queueCentreActiveEntry)
        .observe(tocList, { subtree: true, attributeFilter: ['class'] });
    
    // Nothing has a width until the widget is open, so the first placement has
    // to wait for it — and it is a first appearance, not a move, so it does not
    // animate. Same for a resize, which can change what fits either way.
    document.addEventListener('widget-opened', (event) => {
        if (event.detail.widget === 'toc') centreActiveEntry('auto');
    });
    window.addEventListener('resize', () => centreActiveEntry('auto'), { passive: true });
    
    // Listen for heading stuck state changes from sticky.js
    document.addEventListener('headingStuckStateChanged', (event) => {
        if (event.detail.currentStuckHeading) {
            updateTocActiveState(event.detail.currentStuckHeading);
        } else {
            // If no heading is stuck, fall back to scroll-based detection
            updateActiveTocItem();
        }
    });
    
    // Listen for scroll events
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                updateActiveTocItem();
                ticking = false;
            });
            ticking = true;
        }
    });
    
    // Initial update
    updateActiveTocItem();
});