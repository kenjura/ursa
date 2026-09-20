document.addEventListener('DOMContentLoaded', () => {
    const article = document.querySelector('article#main-content');
    if (!article) return;

    const children = Array.from(article.children);
    let sections = [];
    let currentSection = document.createElement('section');
    currentSection.classList.add('sectionOuter');

    // The page header stays outside any section: the breadcrumbs, and any
    // named menu (`{menu:…}`) anchored above the first heading. A menu placed
    // further down is part of its section like any other content.
    const preamble = [];
    let inPreamble = true;

    for (let i = 0; i < children.length; i++) {
        const el = children[i];
        if (el.classList && el.classList.contains('breadcrumbs')) {
            preamble.push(el);
            continue;
        }
        if (inPreamble && el.classList && el.classList.contains('ursa-menu')) {
            preamble.push(el);
            continue;
        }
        inPreamble = false;
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

    // Re-insert the header at the top, outside any section
    preamble.forEach(el => article.appendChild(el));

    // Append new sections
    sections.forEach(section => article.appendChild(section));
    

    // Optional: Add section numbers or other decorations
    Array.from(article.querySelectorAll('section.sectionOuter')).forEach((section, index) => {
        section.style.setProperty('--section-index', index + 1);
    });
});