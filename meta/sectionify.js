document.addEventListener('DOMContentLoaded', () => {
    const article = document.querySelector('article#main-content');
    if (!article) return;

    const children = Array.from(article.children);
    let sections = [];
    let currentSection = document.createElement('section');
    currentSection.classList.add('sectionOuter');

    for (let i = 0; i < children.length; i++) {
        const el = children[i];
        if (el.tagName === 'H1' && currentSection.childNodes.length > 0) {
            sections.push(currentSection);
            currentSection = document.createElement('section');
            currentSection.classList.add('sectionOuter');
        }
        currentSection.appendChild(el);
    }
    if (currentSection.childNodes.length > 0) {
        sections.push(currentSection);
    }

    // Remove all existing children
    while (article.firstChild) {
        article.removeChild(article.firstChild);
    }

    // Append new sections
    sections.forEach(section => article.appendChild(section));
    

    // Optional: Add section numbers or other decorations
    Array.from(article.querySelectorAll('section.sectionOuter')).forEach((section, index) => {
        section.style.setProperty('--section-index', index + 1);
    });
});