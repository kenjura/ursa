/**
 * Column-based menu navigation (Finder-style)
 * 
 * Displays 2 columns at a time, with horizontal scrolling to navigate deeper levels.
 * Each column represents one level of the folder hierarchy.
 */
document.addEventListener('DOMContentLoaded', () => {
    const navMain = document.querySelector('nav#nav-main');
    if (!navMain) return;

    // Check for custom menu
    const customMenuPath = document.body.dataset.customMenu;
    const isCustomMenu = !!customMenuPath;

    // State - menu data will be loaded asynchronously
    let menuData = null;
    let menuDataLoaded = false;
    let menuDataLoading = false;
    
    // Load menu config from embedded JSON (contains openMenuItems)
    const menuConfigScript = document.getElementById('menu-config');
    let menuConfig = { openMenuItems: [] };
    if (menuConfigScript) {
        try {
            menuConfig = JSON.parse(menuConfigScript.textContent);
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
    const COLUMN_WIDTH = 130;      // Width of each column in pixels

    // Helper to check if we're on mobile
    const isMobile = () => window.matchMedia('(max-width: 800px)').matches;
    
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
     * Check if an item matches the current page
     */
    function isCurrentPage(item) {
        if (!item.href) return false;
        const currentHref = window.location.pathname;
        const normalizedItemHref = decodeURIComponent(item.href).replace(/\/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');
        const normalizedCurrentHref = decodeURIComponent(currentHref).replace(/\/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');
        return normalizedItemHref === normalizedCurrentHref;
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
     * Create the menu DOM structure
     */
    function createMenuStructure() {
        // Clear existing content but preserve any breadcrumb/config scripts
        const configScript = navMain.querySelector('#menu-config');
        navMain.innerHTML = '';
        if (configScript) {
            navMain.appendChild(configScript);
        }
        
        // Create main container
        const container = document.createElement('div');
        container.className = 'menu-columns-container';
        
        // Create columns wrapper (this scrolls)
        const columnsWrapper = document.createElement('div');
        columnsWrapper.className = 'menu-columns-wrapper';
        container.appendChild(columnsWrapper);
        
        navMain.appendChild(container);
        
        // Create scroll indicator (shows when current doc is off-screen)
        const scrollIndicator = document.createElement('div');
        scrollIndicator.className = 'menu-scroll-indicator';
        scrollIndicator.innerHTML = '<button class="scroll-to-current" title="Go to current page">Current →</button>';
        scrollIndicator.style.display = 'none';
        navMain.appendChild(scrollIndicator);
        
        // Create scroll buttons
        const scrollLeft = document.createElement('button');
        scrollLeft.className = 'menu-scroll-btn scroll-left';
        scrollLeft.innerHTML = '‹';
        scrollLeft.title = 'Scroll left (shallower)';
        navMain.appendChild(scrollLeft);
        
        const scrollRight = document.createElement('button');
        scrollRight.className = 'menu-scroll-btn scroll-right';
        scrollRight.innerHTML = '›';
        scrollRight.title = 'Scroll right (deeper)';
        navMain.appendChild(scrollRight);
        
        return { container, columnsWrapper, scrollIndicator, scrollLeft, scrollRight };
    }

    /**
     * Render all columns
     */
    function renderColumns() {
        if (!elements) return;
        
        const { columnsWrapper } = elements;
        columnsWrapper.innerHTML = '';
        
        for (let i = 0; i < allColumns.length; i++) {
            const col = allColumns[i];
            const columnEl = document.createElement('div');
            columnEl.className = 'menu-column';
            columnEl.dataset.columnIndex = i;
            
            const ul = document.createElement('ul');
            ul.className = 'menu-column-list';
            
            for (const item of col.items) {
                const li = document.createElement('li');
                li.className = 'menu-column-item';
                li.dataset.path = item.path;
                
                // Check if this item is selected (on path to current doc)
                if (item.path === col.selectedPath) {
                    li.classList.add('selected');
                }
                
                // Check if this is the current page
                if (isCurrentPage(item)) {
                    li.classList.add('current-page');
                }
                
                // Check if has children
                if (item.hasChildren) {
                    li.classList.add('has-children');
                }
                
                // Check if this is an index file
                if (item.isIndex) {
                    li.classList.add('is-index');
                }
                
                // Create the item content
                const row = document.createElement('div');
                row.className = 'menu-column-item-row';
                
                // Label (link if has href)
                if (item.href) {
                    const link = document.createElement('a');
                    link.href = item.href;
                    link.className = 'menu-column-label';
                    link.textContent = item.label;
                    row.appendChild(link);
                } else {
                    const span = document.createElement('span');
                    span.className = 'menu-column-label';
                    span.textContent = item.label;
                    row.appendChild(span);
                }
                
                // Arrow indicator for folders
                if (item.hasChildren) {
                    const arrow = document.createElement('span');
                    arrow.className = 'menu-column-arrow';
                    arrow.textContent = '›';
                    row.appendChild(arrow);
                }
                
                li.appendChild(row);
                ul.appendChild(li);
            }
            
            columnEl.appendChild(ul);
            columnsWrapper.appendChild(columnEl);
        }
        
        // Set wrapper width
        columnsWrapper.style.width = `${allColumns.length * COLUMN_WIDTH}px`;
    }

    /**
     * Update scroll position (with snap)
     */
    function updateScrollPosition() {
        if (!elements) return;
        
        const { columnsWrapper, scrollIndicator, scrollLeft, scrollRight } = elements;
        
        // Clamp scroll position
        const maxScroll = Math.max(0, allColumns.length - VISIBLE_COLUMNS);
        scrollPosition = Math.max(0, Math.min(scrollPosition, maxScroll));
        
        // Apply transform
        const translateX = -scrollPosition * COLUMN_WIDTH;
        columnsWrapper.style.transform = `translateX(${translateX}px)`;
        
        // Update scroll button visibility
        scrollLeft.style.opacity = scrollPosition > 0 ? '1' : '0.3';
        scrollLeft.disabled = scrollPosition <= 0;
        
        const canScrollRight = scrollPosition < maxScroll;
        scrollRight.style.opacity = canScrollRight ? '1' : '0.3';
        scrollRight.disabled = !canScrollRight;
        
        // Show indicator if current doc is not visible
        const currentDocVisible = scrollPosition <= currentDocColumnIndex && 
                                  currentDocColumnIndex < scrollPosition + VISIBLE_COLUMNS;
        scrollIndicator.style.display = currentDocVisible ? 'none' : 'flex';
        
        // Update indicator direction
        if (!currentDocVisible) {
            const indicatorBtn = scrollIndicator.querySelector('.scroll-to-current');
            if (currentDocColumnIndex < scrollPosition) {
                indicatorBtn.innerHTML = '← Current';
            } else {
                indicatorBtn.innerHTML = 'Current →';
            }
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
        
        const items = elements.columnsWrapper.querySelectorAll('.menu-column-item');
        
        items.forEach(li => {
            const path = li.dataset.path;
            const item = findItemByPath(path);
            if (!item) return;
            
            const row = li.querySelector('.menu-column-item-row');
            const link = li.querySelector('a.menu-column-label');
            
            // For folders: clicking anywhere on the row expands
            if (item.hasChildren) {
                row.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigateIntoFolder(item);
                });
                
                // But if there's also a link, ctrl/cmd+click should still work
                if (link) {
                    link.addEventListener('click', (e) => {
                        if (e.ctrlKey || e.metaKey) {
                            // Allow normal link behavior for ctrl/cmd+click
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
        
        const { container, scrollIndicator, scrollLeft, scrollRight } = elements;
        
        // Scroll button handlers
        scrollLeft.addEventListener('click', () => {
            scrollPosition = Math.max(0, scrollPosition - 1);
            updateScrollPosition();
        });
        
        scrollRight.addEventListener('click', () => {
            scrollPosition = Math.min(allColumns.length - VISIBLE_COLUMNS, scrollPosition + 1);
            updateScrollPosition();
        });
        
        // Scroll to current button
        scrollIndicator.querySelector('.scroll-to-current').addEventListener('click', () => {
            scrollPosition = Math.max(0, currentDocColumnIndex - VISIBLE_COLUMNS + 1);
            updateScrollPosition();
        });
        
        // Trackpad/wheel horizontal scrolling with snap
        let accumulatedDelta = 0;
        let scrollTimeout = null;
        
        container.addEventListener('wheel', (e) => {
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
            navMain.innerHTML = '<div class="menu-loading">Loading menu...</div>';
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

    // Mobile menu toggle
    const globalNav = document.querySelector('nav#nav-global');
    const menuButton = globalNav?.querySelector('.menu-button');
    
    if (menuButton) {
        function updateButtonIcon(isOpen) {
            menuButton.textContent = isOpen ? '✕' : '☰';
        }

        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (isMobile()) {
                const isNowActive = navMain.classList.toggle('active');
                updateButtonIcon(isNowActive);
            } else {
                navMain.classList.toggle('collapsed');
            }
        });

        document.addEventListener('click', (e) => {
            if (isMobile() && 
                navMain.classList.contains('active') && 
                !navMain.contains(e.target) && 
                !menuButton.contains(e.target)) {
                navMain.classList.remove('active');
                updateButtonIcon(false);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (isMobile() && navMain.classList.contains('active')) {
                    navMain.classList.remove('active');
                    updateButtonIcon(false);
                    menuButton.focus();
                }
            }
        });
    }

    // Initial render (shows loading, then loadMenuData will call initializeFromCurrentPage)
    renderMenu();
});
