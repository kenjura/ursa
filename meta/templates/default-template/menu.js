/**
 * Site navigation: one .ursa-nav component, three layouts.
 *
 *   <nav class="ursa-nav …" data-layout="columns | tree | bar">
 *     <ul class="ursa-nav-list">
 *       <li class="ursa-nav-item" [data-branch] [data-trail] [data-index] [data-home]>
 *         <a class="ursa-nav-link" href="…" [aria-current="page"]>Label</a>
 *           (or <span class="ursa-nav-link"> for an entry with no page)
 *         <ul class="ursa-nav-list">…</ul>          (tree, bar)
 *
 * - Side menu (.ursa-sitenav, data-layout="columns"): Finder-style columns,
 *   2 visible at a time, scrolled sideways to reach deeper levels. Each column
 *   is one level of the folder hierarchy.
 * - Top menu (.ursa-topnav, data-layout="bar"): a strip with dropdowns and
 *   flyouts. Top menu is the default; side menu is used only when explicitly
 *   set. On mobile the top menu's data is shown in .ursa-sitenav as a tree.
 *
 * The toggle (.ursa-sitenav-toggle) opens/closes the side menu by writing
 * data-ursa-sitenav="open|closed" on the root (body.ursa); absent means the
 * viewport default (open on desktop, closed on mobile).
 */

const NARROW_QUERY = '(max-width: 800px)';
const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;

/** Is the side menu open? An explicit data-ursa-sitenav wins over the viewport default. */
function isSitenavOpen() {
    const state = document.body.dataset.ursaSitenav;
    return state ? state === 'open' : !isNarrow();
}

/**
 * Open or close the side menu. When the wanted state is what the viewport
 * would show anyway the attribute is removed, so desktop and mobile keep
 * their own defaults (closing the mobile menu doesn't also close the desktop
 * one, and vice versa).
 */
function setSitenavOpen(open) {
    if (open === !isNarrow()) {
        delete document.body.dataset.ursaSitenav;
    } else {
        document.body.dataset.ursaSitenav = open ? 'open' : 'closed';
    }
}

/**
 * Check if an href matches the current page
 */
function isCurrentHref(href) {
    if (!href || href === '#') return false;
    const current = decodeURIComponent(window.location.pathname)
        .replace(/\/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');
    const target = decodeURIComponent(href)
        .replace(/\/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');
    return current === target;
}

/**
 * Create an .ursa-nav-item with its .ursa-nav-link (a link if the item has a
 * page, a span otherwise). State is attributes: data-branch for an item with
 * children, aria-current on the current page's link.
 */
function createNavItem(item, { branch = false } = {}) {
    const li = document.createElement('li');
    li.className = 'ursa-nav-item';
    if (branch) li.dataset.branch = '';

    const link = item.href
        ? document.createElement('a')
        : document.createElement('span');
    link.className = 'ursa-nav-link';
    link.textContent = item.label;
    if (item.href) {
        link.href = item.href;
        if (isCurrentHref(item.href)) link.setAttribute('aria-current', 'page');
        if (item.inactive) link.dataset.ursaBroken = '';
    }
    li.appendChild(link);
    return li;
}

/**
 * Empty a nav, keeping the embedded menu data script if it has one.
 */
function clearNav(nav) {
    const dataScript = nav.querySelector('#ursa-menu-data');
    nav.innerHTML = '';
    if (dataScript) nav.appendChild(dataScript);
}

/**
 * Keep the toggle's icon, label and aria-expanded in step with the side menu.
 * In top position the desktop toggle is a home button, not a disclosure.
 */
function updateToggle(toggle, { homeOnDesktop = false } = {}) {
    if (!toggle) return;
    if (homeOnDesktop && !isNarrow()) {
        toggle.dataset.icon = 'home';
        toggle.setAttribute('aria-label', 'Home');
        toggle.removeAttribute('aria-expanded');
        return;
    }
    const open = isSitenavOpen();
    toggle.dataset.icon = isNarrow() && open ? 'close' : 'menu';
    toggle.setAttribute('aria-label', isNarrow() && open ? 'Close menu' : 'Menu');
    toggle.setAttribute('aria-expanded', String(open));
}

/**
 * Wire the toggle: click toggles the side menu (or, in top position on
 * desktop, goes home); on mobile an outside click or Escape closes it.
 */
function setupSitenavToggle(toggle, sitenav, { homeOnDesktop = false } = {}) {
    if (!toggle) return;

    updateToggle(toggle, { homeOnDesktop });
    window.addEventListener('resize', () => updateToggle(toggle, { homeOnDesktop }));

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();

        if (homeOnDesktop && !isNarrow()) {
            // Desktop, top position: navigate to home
            window.location.href = '/';
            return;
        }
        if (!sitenav) return;
        setSitenavOpen(!isSitenavOpen());
        updateToggle(toggle, { homeOnDesktop });
    });

    // Close mobile menu on outside click
    document.addEventListener('click', (e) => {
        if (isNarrow() && sitenav && isSitenavOpen() &&
            !sitenav.contains(e.target) && !toggle.contains(e.target)) {
            setSitenavOpen(false);
            updateToggle(toggle, { homeOnDesktop });
        }
    });

    // Close mobile menu on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isNarrow() && sitenav && isSitenavOpen()) {
            setSitenavOpen(false);
            updateToggle(toggle, { homeOnDesktop });
            toggle.focus();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const sitenav = document.querySelector('.ursa-sitenav');
    const toggle = document.querySelector('.ursa-sitenav-toggle');
    const menuPosition = document.body.dataset.ursaMenuPosition || 'top';

    // If menu position is top (default), handle differently
    if (menuPosition === 'top') {
        initTopMenu();
        return;
    }

    if (!sitenav) return;
    sitenav.dataset.layout = 'columns';

    // Check for custom menu
    const customMenuPath = document.body.dataset.ursaCustomMenu;

    // State - menu data will be loaded asynchronously
    let menuData = null;
    let menuDataLoaded = false;
    let menuDataLoading = false;

    // Load menu config from embedded JSON (contains openMenuItems)
    const menuDataScript = document.getElementById('ursa-menu-data');
    let menuConfig = { openMenuItems: [] };
    if (menuDataScript) {
        try {
            menuConfig = JSON.parse(menuDataScript.textContent);
        } catch (e) {
            console.error('Failed to parse menu config:', e);
        }
    }

    // Column navigation state
    let allColumns = [];           // Array of column data: [{items: [], parentPath: '', selectedPath: ''}]
    let scrollPosition = 0;        // Which column index is the leftmost visible
    let currentDocPath = [];       // Path segments to current document
    let currentDocColumnIndex = 0; // Which column contains the current document

    // DOM element references (set during createMenuStructure)
    let elements = null;

    // Constants
    const VISIBLE_COLUMNS = 2;
    const COLUMN_WIDTH = 130;      // Fallback column width in pixels (--ursa-sitenav-column-width)

    /**
     * Load menu data from external JSON file
     */
    async function loadMenuData() {
        if (menuDataLoaded || menuDataLoading) return;
        menuDataLoading = true;

        try {
            const menuUrl = customMenuPath || '/public/menu-data.json';
            const response = await fetch(menuUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            menuData = await response.json();
            menuDataLoaded = true;

            initializeFromCurrentPage();
        } catch (error) {
            console.error('Failed to load menu data:', error);
            menuDataLoaded = true;
        } finally {
            menuDataLoading = false;
        }
    }

    // Start loading menu data immediately
    loadMenuData();

    // `ursa serve` says the menu data changed (a document was added or
    // renamed somewhere): refetch and re-render in place rather than reload.
    document.addEventListener('ursa:data-updated', (e) => {
        if (!(e.detail?.what || []).includes('menu')) return;
        menuDataLoaded = false;
        menuDataLoading = false;
        loadMenuData();
    });

    /**
     * Find item by path string
     */
    function findItemByPath(pathString) {
        if (!menuData) return null;
        if (!pathString) return null;

        const segments = pathString.split('/').filter(Boolean);
        let items = menuData;
        let item = null;

        for (let i = 0; i < segments.length; i++) {
            const targetPath = segments.slice(0, i + 1).join('/');
            item = items.find(it => it.path === targetPath);
            if (!item) return null;
            if (item.children && i < segments.length - 1) {
                items = item.children;
            }
        }
        return item;
    }

    /**
     * Build the column structure based on current document path
     */
    function buildColumns() {
        allColumns = [];

        // Always start with root column
        allColumns.push({
            items: menuData || [],
            parentPath: '',
            selectedPath: currentDocPath.length > 0 ? currentDocPath[0] : null
        });

        // Build columns for each level of the current document path
        let currentPathString = '';
        for (let i = 0; i < currentDocPath.length; i++) {
            currentPathString = currentDocPath.slice(0, i + 1).join('/');
            const item = findItemByPath(currentPathString);

            if (item && item.children && item.children.length > 0) {
                const nextSelectedPath = i + 1 < currentDocPath.length
                    ? currentDocPath.slice(0, i + 2).join('/')
                    : null;

                allColumns.push({
                    items: item.children,
                    parentPath: currentPathString,
                    selectedPath: nextSelectedPath
                });
            }
        }

        // Set current doc column index (rightmost column that contains actual content)
        currentDocColumnIndex = allColumns.length - 1;

        // Default scroll position: show current doc column as rightmost visible
        scrollPosition = Math.max(0, currentDocColumnIndex - VISIBLE_COLUMNS + 1);
    }

    /**
     * Create the menu DOM structure:
     * .ursa-nav-viewport > .ursa-nav-track > ul.ursa-nav-list[data-column] (one per level),
     * plus the scroll buttons and the jump-to-current button.
     */
    function createMenuStructure() {
        // Clear existing content but preserve the menu data script
        clearNav(sitenav);

        // Create viewport (clips the track)
        const viewport = document.createElement('div');
        viewport.className = 'ursa-nav-viewport';

        // Create track (holds the columns; this is what scrolls)
        const track = document.createElement('div');
        track.className = 'ursa-nav-track';
        viewport.appendChild(track);

        sitenav.appendChild(viewport);

        // Create scroll buttons
        const scrollBack = document.createElement('button');
        scrollBack.type = 'button';
        scrollBack.className = 'ursa-nav-scroll';
        scrollBack.dataset.direction = 'back';
        scrollBack.textContent = '‹';
        scrollBack.title = 'Scroll left (shallower)';
        scrollBack.setAttribute('aria-label', 'Show shallower levels');
        sitenav.appendChild(scrollBack);

        const scrollForward = document.createElement('button');
        scrollForward.type = 'button';
        scrollForward.className = 'ursa-nav-scroll';
        scrollForward.dataset.direction = 'forward';
        scrollForward.textContent = '›';
        scrollForward.title = 'Scroll right (deeper)';
        scrollForward.setAttribute('aria-label', 'Show deeper levels');
        sitenav.appendChild(scrollForward);

        // Create jump button (shows when current doc is off-screen)
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'ursa-nav-jump';
        jump.title = 'Go to current page';
        jump.textContent = 'Current →';
        jump.hidden = true;
        sitenav.appendChild(jump);

        return { viewport, track, jump, scrollBack, scrollForward };
    }

    /**
     * Width of one column: measured, so --ursa-sitenav-column-width is honoured
     */
    function columnWidth() {
        const first = elements?.track.querySelector('.ursa-nav-list');
        return first?.offsetWidth || COLUMN_WIDTH;
    }

    /**
     * Render all columns
     */
    function renderColumns() {
        if (!elements) return;

        const { track } = elements;
        track.innerHTML = '';

        for (let i = 0; i < allColumns.length; i++) {
            const col = allColumns[i];
            const ul = document.createElement('ul');
            ul.className = 'ursa-nav-list';
            ul.dataset.column = i;

            for (const item of col.items) {
                // data-branch: has children (the arrow is CSS, [data-branch]::after)
                const li = createNavItem(item, { branch: !!item.hasChildren });
                li.dataset.path = item.path;

                // On the path to the current doc
                if (item.path === col.selectedPath) {
                    li.dataset.trail = '';
                }

                // An index file
                if (item.isIndex) {
                    li.dataset.index = '';
                }
                
                // The root Home entry
                if (item.isHome) {
                    li.dataset.home = '';
                }

                ul.appendChild(li);
            }

            track.appendChild(ul);
        }

        // Set track width
        track.style.width = `${allColumns.length * columnWidth()}px`;
    }

    /**
     * Update scroll position (with snap)
     */
    function updateScrollPosition() {
        if (!elements) return;

        const { track, jump, scrollBack, scrollForward } = elements;

        // Clamp scroll position
        const maxScroll = Math.max(0, allColumns.length - VISIBLE_COLUMNS);
        scrollPosition = Math.max(0, Math.min(scrollPosition, maxScroll));

        // Apply transform
        const translateX = -scrollPosition * columnWidth();
        track.style.transform = `translateX(${translateX}px)`;

        // Update scroll buttons
        scrollBack.disabled = scrollPosition <= 0;
        scrollForward.disabled = scrollPosition >= maxScroll;

        // Show the jump button if current doc is not visible
        const currentDocVisible = scrollPosition <= currentDocColumnIndex &&
                                  currentDocColumnIndex < scrollPosition + VISIBLE_COLUMNS;
        jump.hidden = currentDocVisible;

        // Update jump direction
        if (!currentDocVisible) {
            jump.textContent = currentDocColumnIndex < scrollPosition ? '← Current' : 'Current →';
        }
    }

    /**
     * Navigate into a folder (expand it as a new column)
     */
    function navigateIntoFolder(item) {
        if (!item.hasChildren) return;

        const pathSegments = item.path.split('/').filter(Boolean);
        currentDocPath = pathSegments;

        // Rebuild columns with this item expanded
        buildColumns();
        renderColumns();

        // Scroll to show the new column
        scrollPosition = Math.max(0, allColumns.length - VISIBLE_COLUMNS);
        updateScrollPosition();

        attachItemHandlers();
    }

    /**
     * Attach click handlers to menu items
     */
    function attachItemHandlers() {
        if (!elements) return;

        const items = elements.track.querySelectorAll('.ursa-nav-item');

        items.forEach(li => {
            const path = li.dataset.path;
            const item = findItemByPath(path);
            if (!item) return;

            const link = li.querySelector('a.ursa-nav-link');

            // For folders: clicking anywhere on the row (the item) expands
            if (item.hasChildren) {
                li.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigateIntoFolder(item);
                });

                // But if there's also a link, ctrl/cmd+click should still work
                if (link) {
                    link.addEventListener('click', (e) => {
                        if (e.ctrlKey || e.metaKey) {
                            // Allow normal link behavior for ctrl/cmd+click
                            e.stopPropagation();
                            return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        navigateIntoFolder(item);
                    });
                }
            }
            // For files: link navigates normally (no special handling needed)
        });
    }

    /**
     * Set up scroll event handlers
     */
    function setupScrollHandlers() {
        if (!elements) return;

        const { viewport, jump, scrollBack, scrollForward } = elements;

        // Scroll button handlers
        scrollBack.addEventListener('click', () => {
            scrollPosition = Math.max(0, scrollPosition - 1);
            updateScrollPosition();
        });

        scrollForward.addEventListener('click', () => {
            scrollPosition = Math.min(allColumns.length - VISIBLE_COLUMNS, scrollPosition + 1);
            updateScrollPosition();
        });

        // Jump to current
        jump.addEventListener('click', () => {
            scrollPosition = Math.max(0, currentDocColumnIndex - VISIBLE_COLUMNS + 1);
            updateScrollPosition();
        });

        // Trackpad/wheel horizontal scrolling with snap
        let accumulatedDelta = 0;
        let scrollTimeout = null;

        viewport.addEventListener('wheel', (e) => {
            // Only handle horizontal scroll - let vertical scroll work normally for column scrolling
            const isHorizontalScroll = Math.abs(e.deltaX) > Math.abs(e.deltaY);

            if (!isHorizontalScroll) {
                // Allow vertical scrolling within columns
                return;
            }

            const delta = e.deltaX;

            if (Math.abs(delta) > 0) {
                e.preventDefault();

                accumulatedDelta += delta;

                // Clear previous timeout
                if (scrollTimeout) clearTimeout(scrollTimeout);

                // Snap after scrolling stops
                scrollTimeout = setTimeout(() => {
                    if (accumulatedDelta > 50) {
                        scrollPosition = Math.min(allColumns.length - VISIBLE_COLUMNS, scrollPosition + 1);
                    } else if (accumulatedDelta < -50) {
                        scrollPosition = Math.max(0, scrollPosition - 1);
                    }
                    accumulatedDelta = 0;
                    updateScrollPosition();
                }, 100);
            }
        }, { passive: false });
    }

    /**
     * Main render function
     */
    function renderMenu() {
        if (!menuData) {
            clearNav(sitenav);
            const message = document.createElement('p');
            message.className = 'ursa-nav-message';
            message.textContent = 'Loading menu...';
            sitenav.appendChild(message);
            return;
        }

        buildColumns();
        elements = createMenuStructure();
        renderColumns();
        updateScrollPosition();
        attachItemHandlers();
        setupScrollHandlers();
    }

    /**
     * Initialize from current page URL
     */
    function initializeFromCurrentPage() {
        const currentHref = window.location.pathname;
        let pathParts = currentHref.split('/').filter(Boolean);

        // Remove .html extension from the last part
        if (pathParts.length > 0) {
            pathParts[pathParts.length - 1] = pathParts[pathParts.length - 1].replace(/\.html$/, '');
        }

        // If the last part is "index", treat it as if we're viewing the parent folder
        if (pathParts.length > 0 && pathParts[pathParts.length - 1] === 'index') {
            pathParts = pathParts.slice(0, -1);
        }

        // Validate path against menu data and build currentDocPath
        currentDocPath = [];
        let testPath = [];
        for (const part of pathParts) {
            testPath.push(part);
            const item = findItemByPath(testPath.join('/'));
            if (item) {
                currentDocPath.push(part);
            } else {
                break;
            }
        }

        renderMenu();
    }

    // Menu toggle: collapses the side menu on desktop, opens it on mobile
    setupSitenavToggle(toggle, sitenav);

    // Initial render (shows loading, then loadMenuData will call initializeFromCurrentPage)
    renderMenu();
});

/**
 * Initialize top menu (horizontal navigation with dropdowns)
 * Also handles: home button on desktop, hamburger → mobile side menu
 */
function initTopMenu() {
    const topnav = document.querySelector('.ursa-topnav');
    const sitenav = document.querySelector('.ursa-sitenav');
    const toggle = document.querySelector('.ursa-sitenav-toggle');
    const customMenuPath = document.body.dataset.ursaCustomMenu;

    if (!topnav) return;

    // Determine which URL to load — custom menu or default auto-menu
    const menuUrl = customMenuPath || '/public/menu-data.json';

    // Load menu data and render both top menu and mobile menu
    const loadTopMenu = () => fetch(menuUrl)
        .then(response => response.json())
        .then(data => {
            const menuData = data.menuData || data;
            renderTopMenu(topnav, menuData);
            buildMobileMenu(menuData, sitenav);
        })
        .catch(error => {
            console.error('Failed to load top menu data:', error);
        });
    loadTopMenu();

    // `ursa serve` says the menu data changed: refetch and re-render in place
    document.addEventListener('ursa:data-updated', (e) => {
        if ((e.detail?.what || []).includes('menu')) loadTopMenu();
    });

    // Set up home button (desktop) / hamburger (mobile).
    // All three icons are in the button already (index.html); data-icon is how
    // one of them is chosen, so nothing here has to know what any of them look like.
    setupSitenavToggle(toggle, sitenav, { homeOnDesktop: true });
}

/**
 * Build the mobile side menu from the same data as the top menu.
 * Repurposes .ursa-sitenav as a tree (nested lists) with a "Home" link at top.
 */
function buildMobileMenu(menuData, sitenav) {
    if (!sitenav) return;

    // Clear existing content
    clearNav(sitenav);
    sitenav.dataset.layout = 'tree';

    const ul = document.createElement('ul');
    ul.className = 'ursa-nav-list';

    // Add "Home" item at the top
    const homeLi = createNavItem({ label: '🏠 Home', href: '/' });
    homeLi.dataset.home = '';
    ul.appendChild(homeLi);

    // Build menu items recursively
    appendNavTree(menuData, ul);

    sitenav.appendChild(ul);
}

/**
 * Recursively append items to a list, children as nested .ursa-nav-lists.
 * Items above the current page get data-trail.
 * @returns {boolean} whether the current page is among these items
 */
function appendNavTree(items, parentUl) {
    let containsCurrent = false;
    for (const item of items) {
        const hasChildren = !!(item.children && item.children.length > 0);
        const li = createNavItem(item, { branch: hasChildren || !!item.hasChildren });
        if (li.querySelector(':scope > [aria-current="page"]')) containsCurrent = true;

        // Recurse into children
        if (hasChildren) {
            const childUl = document.createElement('ul');
            childUl.className = 'ursa-nav-list';
            if (appendNavTree(item.children, childUl)) {
                li.dataset.trail = '';
                containsCurrent = true;
            }
            li.appendChild(childUl);
        }

        parentUl.appendChild(li);
    }
    return containsCurrent;
}

/**
 * Render the top navigation menu: the whole tree as nested lists. The bar
 * layout shows the first level as a strip, the second as dropdowns and the
 * rest as flyouts (positioned by initFlyoutPositioning).
 */
function renderTopMenu(container, menuData) {
    // Re-rendered in place when the menu data changes under `ursa serve`
    clearNav(container);
    container.dataset.layout = 'bar';
    const ul = document.createElement('ul');
    ul.className = 'ursa-nav-list';
    appendNavTree(menuData, ul);
    container.appendChild(ul);
}

// (Search functionality is now handled by widgets.js)

/**
 * Initialize flyout positioning for top menu
 * Flyouts use position:fixed to avoid being clipped by the scrolling dropdown
 */
function initFlyoutPositioning() {
  const nav = document.querySelector('.ursa-topnav');
  if (!nav) return;

  // Use event delegation for all flyout triggers: a branch inside a dropdown
  const onEnter = (e) => {
    const trigger = e.target.closest?.('.ursa-nav-item .ursa-nav-item[data-branch]');
    if (!trigger || !nav.contains(trigger)) return;

    const flyout = trigger.querySelector(':scope > .ursa-nav-list');
    if (!flyout) return;

    positionFlyout(trigger, flyout);
  };
  nav.addEventListener('mouseenter', onEnter, true);
  // Keyboard: :focus-within opens the flyout, so place it on focus too
  nav.addEventListener('focusin', onEnter);
}

/**
 * Position a flyout menu relative to its trigger element
 */
function positionFlyout(trigger, flyout) {
  const triggerRect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  // Tokens are declared on the .ursa root, not :root
  const navHeight = parseInt(getComputedStyle(document.body).getPropertyValue('--ursa-topbar-height')) || 48;

  // Default: position to the right of the trigger
  let left = triggerRect.right;
  let top = triggerRect.top;

  // Temporarily show to measure
  flyout.style.visibility = 'hidden';
  flyout.style.display = 'block';
  const flyoutRect = flyout.getBoundingClientRect();
  flyout.style.display = '';
  flyout.style.visibility = '';

  // If flyout would overflow right edge, flip to left side
  if (left + flyoutRect.width > viewportWidth - 10) {
    left = triggerRect.left - flyoutRect.width;
  }

  // Keep flyout within vertical bounds
  // Clamp to bottom of nav bar (no gap for top items)
  if (top < navHeight) {
    top = navHeight;
  }
  // Prevent overflow at bottom of viewport
  if (top + flyoutRect.height > viewportHeight - 10) {
    top = viewportHeight - flyoutRect.height - 10;
  }

  flyout.style.left = `${left}px`;
  flyout.style.top = `${top}px`;
}

// Initialize flyout positioning when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFlyoutPositioning);
} else {
  initFlyoutPositioning();
}
