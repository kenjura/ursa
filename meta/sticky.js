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
            if (el.tagName === 'H1') {
                // Find the last stuck h2 and h3 (i.e., the "current" ones)
                const stuckH2s = Array.from(headings).filter(h => h.tagName === 'H2' && h.classList.contains('stuck'));
                const stuckH3s = Array.from(headings).filter(h => h.tagName === 'H3' && h.classList.contains('stuck'));
                const stuckH2 = stuckH2s.length ? stuckH2s[stuckH2s.length - 1] : null;
                const stuckH3 = stuckH3s.length ? stuckH3s[stuckH3s.length - 1] : null;

                let newText = el.dataset.originalText || el.textContent;

                if (!el.dataset.originalText) {
                    el.dataset.originalText = el.textContent;
                }

                if (stuckH3 && stuckH2) {
                    newText += ' > ' + stuckH2.textContent + ' > ' + stuckH3.textContent;
                } else if (stuckH2) {
                    newText += ' > ' + stuckH2.textContent;
                }

                el.textContent = newText;
            } else if (el.tagName === 'H1' && !el.classList.contains('stuck') && el.dataset.originalText) {
                el.textContent = el.dataset.originalText;
            }
        });
    }

    updateStuckState();
    window.addEventListener('scroll', updateStuckState, { passive: true });
    window.addEventListener('resize', updateStuckState);
});