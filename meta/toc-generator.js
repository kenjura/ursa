// Table of Contents Generator
document.addEventListener('DOMContentLoaded', () => {
    const tocNav = document.getElementById('nav-toc');
    const article = document.querySelector('article#main-content');
    
    if (!tocNav || !article) return;
    
    // Find all headings in the article
    const headings = article.querySelectorAll('h1, h2, h3');
    
    if (headings.length === 0) {
        tocNav.style.display = 'none';
        return;
    }
    
    // Generate TOC HTML
    const tocList = document.createElement('ul');
    
    headings.forEach((heading, index) => {
        // Create unique ID for the heading if it doesn't have one
        if (!heading.id) {
            const text = heading.textContent.trim()
                .toLowerCase()
                .replace(/[^\w\s-]/g, '') // Remove special characters
                .replace(/\s+/g, '-'); // Replace spaces with hyphens
            heading.id = `heading-${index}-${text}`;
        }
        
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
    
    tocNav.appendChild(tocList);
    
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
        const tocLinks = tocNav.querySelectorAll('a');
        tocLinks.forEach(link => {
            link.classList.remove('active');
        });
        
        if (activeHeading) {
            const activeLink = tocNav.querySelector(`a[href="#${activeHeading.id}"]`);
            if (activeLink) {
                activeLink.classList.add('active');
            }
        }
    }
    
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