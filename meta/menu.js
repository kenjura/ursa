document.addEventListener('DOMContentLoaded', () => {
    const navMain = document.querySelector('nav#nav-main');
    if (!navMain) return;

    const liWithUl = navMain.querySelectorAll('li:has(ul)');
    liWithUl.forEach(li => {
        li.classList.add('has-children');

        const firstA = li.querySelector('a');
        const twisty = document.createElement('span');
        twisty.textContent = '▶';
        twisty.className = 'menu-twisty';

        if (firstA) {
            li.insertBefore(twisty, firstA);
        }

        twisty.addEventListener('click', (e) => {
            li.classList.toggle('expanded');
        });
    });

    const liWithoutUl = navMain.querySelectorAll('li:not(:has(ul))');
    liWithoutUl.forEach(li => {
        const dash = document.createElement('span');
        dash.textContent = '-';
        dash.className = 'menu-no-twisty';
        li.insertBefore(dash, li.firstChild);
    });

    const pathParts = window.location.pathname.split('/').filter(Boolean).map(p => p.toLowerCase());
    if (pathParts.length >= 1) {
        // Start with the top level
        let currentLevel = navMain.querySelectorAll(':scope > ul > li');
        let currentLi = null;
        
        // Walk through each path part
        for (let i = 0; i < pathParts.length; i++) {
            const targetLabel = pathParts[i];
            
            // Find matching li at current level
            currentLi = Array.from(currentLevel).find(li => {
                const a = li.querySelector('a');
                return a && a.textContent.trim().toLowerCase() === targetLabel;
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
                        currentLevel = nextUl.querySelectorAll('li');
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