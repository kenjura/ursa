document.addEventListener('DOMContentLoaded', () => {
    const navMain = document.querySelector('nav#nav-main');
    if (!navMain) return;

    // Load menu data from embedded JSON
    const menuDataScript = document.getElementById('menu-data');
    if (!menuDataScript) return;
    
    let menuData;
    try {
        menuData = JSON.parse(menuDataScript.textContent);
    } catch (e) {
        console.error('Failed to parse menu data:', e);
        return;
    }

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

    // State
    let currentPath = []; // Array of path segments representing current directory
    let expandedLevel1 = new Set(); // Track which level-1 items are expanded
    let collapsedLevel1 = new Set(); // Track which level-1 items are explicitly collapsed (overrides auto-expand for current page)

    // DOM elements
    const breadcrumb = navMain.querySelector('.menu-breadcrumb');
    const backButton = navMain.querySelector('.menu-back');
    const homeButton = navMain.querySelector('.menu-home');
    const currentPathSpan = navMain.querySelector('.menu-current-path');
    const menuContainer = navMain.querySelector('.menu-level');

    // Helper to check if we're on mobile
    const isMobile = () => window.matchMedia('(max-width: 800px)').matches;

    // Get items at a specific path
    function getItemsAtPath(path) {
        let items = menuData;
        for (const segment of path) {
            const folder = items.find(item => item.path === (path.slice(0, path.indexOf(segment) + 1).join('/') || segment));
            if (folder && folder.children) {
                items = folder.children;
            } else {
                return [];
            }
        }
        return items;
    }

    // Find item by path
    function findItemByPath(pathString) {
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

    // Check if current page is within an item's tree
    function isCurrentPageInTree(item) {
        if (isCurrentPage(item)) return true;
        if (item.children) {
            for (const child of item.children) {
                if (isCurrentPageInTree(child)) return true;
            }
        }
        return false;
    }

    // Find the current page item within an item's children (level 2)
    function findCurrentPageChild(item) {
        if (!item.children) return null;
        for (const child of item.children) {
            if (isCurrentPage(child)) return child;
            // Also check grandchildren in case current page is deeper
            if (isCurrentPageInTree(child)) return child;
        }
        return null;
    }

    // Track which level-1 item contains the current page (for special collapse behavior)
    let currentPageParentPath = null;

    // Render menu at current path
    function renderMenu() {
        // Get items for current level (level 1)
        let level1Items;
        if (currentPath.length === 0) {
            level1Items = menuData;
        } else {
            const currentPathString = currentPath.join('/');
            const currentFolder = findItemByPath(currentPathString);
            level1Items = currentFolder?.children || [];
        }

        // Find which level-1 item contains the current page
        currentPageParentPath = null;
        for (const item of level1Items) {
            if (item.hasChildren && isCurrentPageInTree(item)) {
                currentPageParentPath = item.path;
                break;
            }
        }

        // Build HTML for level 1 and level 2
        let html = '';
        for (const item of level1Items) {
            const isActive = isCurrentPage(item);
            const activeClass = isActive ? ' current-menu-item' : '';
            const hasChildrenClass = item.hasChildren ? ' has-children' : '';
            
            // Level-1 items with children get a caret, not triple-dot
            // Expanded if: manually expanded, or (current page is in this tree AND not explicitly collapsed)
            const isExpanded = expandedLevel1.has(item.path) || (isCurrentPageInTree(item) && !collapsedLevel1.has(item.path));
            const expandedClass = isExpanded ? ' expanded' : '';
            const caretIndicator = item.hasChildren 
                ? `<span class="menu-caret">${isExpanded ? '▼' : '▶'}</span>` 
                : '';
            
            const labelHtml = item.href
                ? `<a href="${item.href}" class="menu-label">${item.label}</a>`
                : `<span class="menu-label">${item.label}</span>`;

            html += `
<li class="menu-item level-1${hasChildrenClass}${activeClass}${expandedClass}" data-path="${item.path}">
  <div class="menu-item-row">
    ${item.icon}
    ${labelHtml}
    ${caretIndicator}
  </div>`;

            // Determine which children to render
            let childrenToRender = [];
            if (item.children && item.children.length > 0) {
                if (isExpanded) {
                    // Fully expanded - show all children
                    childrenToRender = item.children;
                } else if (item.path === currentPageParentPath) {
                    // Collapsed but contains current page - show only current page
                    const currentChild = findCurrentPageChild(item);
                    if (currentChild) {
                        childrenToRender = [currentChild];
                    }
                }
            }

            if (childrenToRender.length > 0) {
                html += '<ul class="menu-sublevel">';
                for (const child of childrenToRender) {
                    const childActive = isCurrentPage(child);
                    const childActiveClass = childActive ? ' current-menu-item' : '';
                    const childHasChildren = child.hasChildren ? ' has-children' : '';
                    // Level-2 items with children get triple-dot
                    const childMoreIndicator = child.hasChildren ? '<span class="menu-more" title="Has sub-items">⋮</span>' : '';
                    
                    const childLabelHtml = child.href
                        ? `<a href="${child.href}" class="menu-label">${child.label}</a>`
                        : `<span class="menu-label">${child.label}</span>`;

                    html += `
  <li class="menu-item level-2${childHasChildren}${childActiveClass}" data-path="${child.path}">
    <div class="menu-item-row">
      ${child.icon}
      ${childLabelHtml}
      ${childMoreIndicator}
    </div>
  </li>`;
                }
                html += '</ul>';
            }

            html += '</li>';
        }

        menuContainer.innerHTML = html;

        // Update breadcrumb
        if (currentPath.length > 0) {
            breadcrumb.style.display = 'flex';
            currentPathSpan.textContent = currentPath[currentPath.length - 1];
        } else {
            breadcrumb.style.display = 'none';
        }

        // Attach click handlers
        attachClickHandlers();
    }

    // Check if an item matches the current page
    function isCurrentPage(item) {
        if (!item.href) return false;
        const currentHref = window.location.pathname;
        // Normalize paths for comparison - decode URI components to handle spaces and special chars
        const normalizedItemHref = decodeURIComponent(item.href).replace(/\/index\.html$/, '').replace(/\.html$/, '');
        const normalizedCurrentHref = decodeURIComponent(currentHref).replace(/\/index\.html$/, '').replace(/\.html$/, '');
        return normalizedItemHref === normalizedCurrentHref;
    }

    // Navigate to a folder
    function navigateToFolder(pathString) {
        currentPath = pathString.split('/').filter(Boolean);
        renderMenu();
    }

    // Go back one level
    function goBack() {
        if (currentPath.length > 0) {
            currentPath.pop();
            renderMenu();
        }
    }

    // Go to root
    function goToRoot() {
        currentPath = [];
        renderMenu();
    }

    // Attach click handlers to menu items
    function attachClickHandlers() {
        const menuItems = menuContainer.querySelectorAll('.menu-item');
        menuItems.forEach(li => {
            const row = li.querySelector('.menu-item-row');
            const caret = li.querySelector('.menu-caret');
            const moreBtn = li.querySelector('.menu-more');
            const link = li.querySelector('a.menu-label');
            const isLevel1 = li.classList.contains('level-1');
            const isLevel2 = li.classList.contains('level-2');
            
            if (li.classList.contains('has-children')) {
                if (isLevel1) {
                    // Level-1: clicking caret or row (not link) toggles expand/collapse
                    const toggleExpand = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const path = li.dataset.path;
                        const hasLink = !!link;
                        const containsCurrentPage = li.dataset.path === currentPageParentPath;
                        
                        // Check current expanded state (same logic as renderMenu)
                        const isCurrentlyExpanded = expandedLevel1.has(path) || (containsCurrentPage && !collapsedLevel1.has(path));
                        
                        if (isCurrentlyExpanded) {
                            // Collapsing this item
                            expandedLevel1.delete(path);
                            // If it contains current page, mark as explicitly collapsed
                            if (containsCurrentPage) {
                                collapsedLevel1.add(path);
                            }
                        } else {
                            // Expanding this item
                            // If this item has no link (non-navigable folder), collapse others
                            if (!hasLink) {
                                expandedLevel1.clear();
                            }
                            expandedLevel1.add(path);
                            // Remove from explicit collapsed set
                            collapsedLevel1.delete(path);
                        }
                        renderMenu();
                    };
                    
                    if (caret) {
                        caret.addEventListener('click', toggleExpand);
                    }
                    
                    // If the link points to the current page, clicking it should toggle instead of navigate
                    if (link) {
                        link.addEventListener('click', (e) => {
                            const linkHref = link.getAttribute('href');
                            const currentHref = window.location.pathname;
                            const normalizedLinkHref = linkHref.replace(/\/index\.html$/, '').replace(/\.html$/, '');
                            const normalizedCurrentHref = currentHref.replace(/\/index\.html$/, '').replace(/\.html$/, '');
                            
                            if (normalizedLinkHref === normalizedCurrentHref) {
                                // Already on this page - toggle instead of navigate
                                toggleExpand(e);
                            }
                            // Otherwise, let the default navigation happen
                        });
                    }
                    
                    row.addEventListener('click', (e) => {
                        if (!e.target.closest('a')) {
                            toggleExpand(e);
                        }
                    });
                } else if (isLevel2) {
                    // Level-2 with children: clicking ⋮ or row navigates into folder
                    if (moreBtn) {
                        moreBtn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            navigateToFolder(li.dataset.path);
                        });
                    }
                    
                    row.addEventListener('click', (e) => {
                        if (!e.target.closest('a')) {
                            e.preventDefault();
                            navigateToFolder(li.dataset.path);
                        }
                    });
                }
            }
        });
    }

    // Breadcrumb navigation
    if (backButton) {
        backButton.addEventListener('click', goBack);
    }
    if (homeButton) {
        homeButton.addEventListener('click', goToRoot);
    }

    // Hamburger menu button toggle
    const menuButton = document.querySelector('button.menu-button');
    if (menuButton) {
        const updateButtonIcon = (isOpen) => {
            menuButton.textContent = isOpen ? '✕' : '☰';
            menuButton.setAttribute('aria-expanded', isOpen);
            menuButton.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
        };

        menuButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (isMobile()) {
                navMain.classList.toggle('active');
                const isExpanded = navMain.classList.contains('active');
                updateButtonIcon(isExpanded);
            } else {
                navMain.classList.toggle('collapsed');
                const isExpanded = !navMain.classList.contains('collapsed');
                menuButton.setAttribute('aria-expanded', isExpanded);
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

    // Initialize: find current page and set appropriate path
    function initializeFromCurrentPage() {
        const currentHref = window.location.pathname;
        const pathParts = currentHref.split('/').filter(Boolean);
        
        // Check if we're on the home/root page
        const isHomePage = currentHref === '/' || 
                          currentHref === '/index' || 
                          currentHref === '/index.html' ||
                          pathParts.length === 0 ||
                          (pathParts.length === 1 && pathParts[0].match(/^index(\.html)?$/));
        
        // If on home page and we have openMenuItems config, expand those items
        if (isHomePage && menuConfig.openMenuItems && menuConfig.openMenuItems.length > 0) {
            for (const itemPath of menuConfig.openMenuItems) {
                // Add to expanded set - itemPath should be the folder name like "character"
                expandedLevel1.add(itemPath);
            }
        }
        
        // Try to find the deepest matching folder
        if (pathParts.length > 1) {
            // Navigate to parent folder of current page
            const parentPath = pathParts.slice(0, -1);
            
            // Check if this path exists in menu data
            let testPath = [];
            for (const part of parentPath) {
                testPath.push(part);
                const item = findItemByPath(testPath.join('/'));
                if (!item || !item.hasChildren) {
                    // Path doesn't exist or isn't a folder, stop here
                    testPath.pop();
                    break;
                }
            }
            
            // If we found a valid folder path that's more than 1 level deep, navigate there
            if (testPath.length > 1) {
                currentPath = testPath.slice(0, -1); // Go to grandparent so current folder is visible
            }
        }
        
        renderMenu();
    }

    initializeFromCurrentPage();
});