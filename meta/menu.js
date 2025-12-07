document.addEventListener('DOMContentLoaded', () => {
    const navMain = document.querySelector('nav#nav-main');
    if (!navMain) return;

    // Helper to check if we're on mobile
    const isMobile = () => window.matchMedia('(max-width: 800px)').matches;

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
                // Mobile: toggle active class (shows/hides overlay)
                navMain.classList.toggle('active');
                const isExpanded = navMain.classList.contains('active');
                updateButtonIcon(isExpanded);
            } else {
                // Desktop: toggle collapsed class (slides in/out)
                navMain.classList.toggle('collapsed');
                const isExpanded = !navMain.classList.contains('collapsed');
                menuButton.setAttribute('aria-expanded', isExpanded);
            }
        });

        // Close menu when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (isMobile() && 
                navMain.classList.contains('active') && 
                !navMain.contains(e.target) && 
                !menuButton.contains(e.target)) {
                navMain.classList.remove('active');
                updateButtonIcon(false);
            }
        });

        // Close menu when pressing Escape
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

    // Set up expand/collapse for items with children
    const expandArrows = navMain.querySelectorAll('.expand-arrow');
    expandArrows.forEach(arrow => {
        arrow.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const li = arrow.closest('li');
            if (li) {
                li.classList.toggle('expanded');
            }
        });
    });

    // Also allow clicking the menu-item-row to expand (but not the link itself)
    const menuItemRows = navMain.querySelectorAll('.menu-item-row');
    menuItemRows.forEach(row => {
        row.addEventListener('click', (e) => {
            // Only toggle if clicking the row itself, icon, or expand arrow area (not the link)
            const clickedLink = e.target.closest('a');
            if (!clickedLink) {
                const li = row.closest('li');
                if (li && li.classList.contains('has-children')) {
                    li.classList.toggle('expanded');
                }
            }
        });
    });

    // Auto-expand and highlight based on current URL path
    const pathParts = window.location.pathname.split('/').filter(Boolean).map(p => decodeURIComponent(p).toLowerCase());
    if (pathParts.length >= 1) {
        // Start with the top level
        let currentLevel = navMain.querySelectorAll(':scope > ul > li');
        let currentLi = null;
        
        // Walk through each path part
        for (let i = 0; i < pathParts.length; i++) {
            const targetLabel = pathParts[i];
            
            // Find matching li at current level
            currentLi = Array.from(currentLevel).find(li => {
                const a = li.querySelector('.menu-item-row a');
                if (!a) return false;
                const linkText = a.textContent.trim().toLowerCase();
                return linkText === targetLabel;
            });
            
            if (currentLi) {
                // If this is the last path part, highlight it
                if (i === pathParts.length - 1) {
                    currentLi.classList.add('current-menu-item');
                } else {
                    // If not the last part, expand it and move to next level
                    currentLi.classList.add('expanded');
                    const nextUl = currentLi.querySelector('ul');
                    if (nextUl) {
                        currentLevel = nextUl.querySelectorAll(':scope > li');
                    } else {
                        break; // No deeper level available
                    }
                }
            } else {
                break; // Path part not found
            }
        }
    }
});