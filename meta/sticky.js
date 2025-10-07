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
        });
    }

    updateStuckState();
    window.addEventListener('scroll', updateStuckState, { passive: true });
    window.addEventListener('resize', updateStuckState);
});