document.addEventListener('DOMContentLoaded', () => {
    const navMain = document.querySelector('nav#nav-main');
    if (!navMain) return;

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