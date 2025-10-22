document.addEventListener('DOMContentLoaded', () => {
    const article = document.querySelector('article#main-content');
    if (!article) return;

    const headings = article.querySelectorAll('h1, h2, h3');

    function updateStuckState() {
        headings.forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.position === 'sticky' && style.top !== 'auto') {
                const rect = el.getBoundingClientRect();
                const top = parseInt(style.top, 10) || 0;
                if (rect.top <= top && rect.bottom > top) {
                    el.classList.add('stuck');
                } else {
                    el.classList.remove('stuck');
                }
            } else {
                el.classList.remove('stuck');
            }
            
            // Handle text updates for H1 elements
            if (el.tagName === 'H1') {
                // Store original text if not already stored
                if (!el.dataset.originalText) {
                    el.dataset.originalText = el.textContent;
                }
                
                // Only update text if this H1 is stuck
                if (el.classList.contains('stuck')) {
                    // Find the last stuck h2 and h3 (i.e., the "current" ones)
                    const stuckH2s = Array.from(headings).filter(h => h.tagName === 'H2' && h.classList.contains('stuck'));
                    const stuckH3s = Array.from(headings).filter(h => h.tagName === 'H3' && h.classList.contains('stuck'));
                    const stuckH2 = stuckH2s.length ? stuckH2s[stuckH2s.length - 1] : null;
                    const stuckH3 = stuckH3s.length ? stuckH3s[stuckH3s.length - 1] : null;

                    let newText = el.dataset.originalText;

                    if (stuckH3 && stuckH2) {
                        newText += ' > ' + (stuckH2.dataset.originalText || stuckH2.textContent) + ' > ' + (stuckH3.dataset.originalText || stuckH3.textContent);
                    } else if (stuckH2) {
                        newText += ' > ' + (stuckH2.dataset.originalText || stuckH2.textContent);
                    }

                    el.textContent = newText;
                } else {
                    // Restore original text if not stuck
                    el.textContent = el.dataset.originalText;
                }
            }
        });
    }

    updateStuckState();
    window.addEventListener('scroll', updateStuckState, { passive: true });
    window.addEventListener('resize', updateStuckState);
});