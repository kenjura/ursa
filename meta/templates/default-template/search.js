// Global search functionality with typeahead
// Supports lazy-loading of search index for large datasets
//
// One search component in two placements (SPEC §4, Search): the topbar box is
// server markup, and the search panel's box is rendered by widgets.js. Both are
// `search.ursa-search` with the same parts, and each is driven by a SearchBox.
// GlobalSearch owns the indices and the ranking, which every box shares.
//
// A box is an ARIA combobox: the input says whether its listbox is showing
// (aria-expanded) and which option is keyboard-selected (aria-activedescendant);
// each option carries aria-selected. Anything not shown is `hidden`.

class GlobalSearch {
  constructor() {
    this.boxes = [];
    this.searchIndex = null; // Will be loaded asynchronously
    this.fullTextIndex = null; // Word-to-document mapping
    this.indexLoading = false;
    this.indexLoaded = false;
    this.fullTextLoading = false;
    this.fullTextLoaded = false;
    this._indicesRequested = false;
    this.MIN_QUERY_LENGTH = 3;
    this.INITIAL_PATH_RESULTS = 5;
    this.INITIAL_FULLTEXT_RESULTS = 5;

    this.init();
  }

  init() {
    // Every box already in the page. The panel's box may be rendered before or
    // after this runs; widgets.js calls attach() for it either way, and attach()
    // ignores a box it already drives.
    document.querySelectorAll('.ursa-search').forEach(root => this.attach(root));

    // `ursa serve` says the indices changed: refetch them in place
    document.addEventListener('ursa:data-updated', (e) => {
      if (!(e.detail?.what || []).includes('search')) return;
      if (!this._indicesRequested) return;
      window.SEARCH_INDEX = null;
      window.FULLTEXT_INDEX = null;
      this.indexLoaded = false;
      this.fullTextLoaded = false;
      this.loadSearchIndex();
      this.loadFullTextIndex();
    });

    // Global hotkey: Cmd/Ctrl+P to focus search
    document.addEventListener('keydown', (e) => {
      // Check for Cmd+P (Mac) or Ctrl+P (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        if (this.boxes.length === 0) return;
        e.preventDefault();
        // If widget system is available, open the search widget
        if (window.widgetManager && window.widgetManager.open('search')) return;
        const box = this.boxes.find(b => b.placement === 'topbar') || this.boxes[0];
        box.input.focus();
        box.input.select();
      }
    });
  }

  /**
   * Start driving a `.ursa-search` element. Returns its SearchBox.
   */
  attach(root) {
    const existing = this.boxes.find(box => box.root === root);
    if (existing) return existing;
    if (!root.querySelector('.ursa-search-input')) return null;

    const box = new SearchBox(this, root);
    this.boxes.push(box);

    // Start loading the indices as soon as there is a box to use them (but
    // don't block)
    if (!this._indicesRequested) {
      this._indicesRequested = true;
      this.loadSearchIndex();
      this.loadFullTextIndex();
    }
    return box;
  }

  /**
   * An index arrived: any box still showing "Loading…" for a real query was
   * waiting for it, so run that query now.
   */
  indexArrived() {
    for (const box of this.boxes) {
      if (!box.results.hidden && box.input.value.trim().length >= this.MIN_QUERY_LENGTH) {
        box.handleSearch(box.input.value);
      }
    }
  }

  /**
   * Load search index from external JSON file
   * This is done asynchronously to avoid blocking page render
   */
  async loadSearchIndex() {
    // Check if index was already embedded in page (legacy support)
    if (window.SEARCH_INDEX && Array.isArray(window.SEARCH_INDEX) && window.SEARCH_INDEX.length > 0) {
      this.searchIndex = window.SEARCH_INDEX;
      this.indexLoaded = true;
      return;
    }

    this.indexLoading = true;

    try {
      const response = await fetch('/public/search-index.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      this.searchIndex = data;
      this.indexLoaded = true;
      window.SEARCH_INDEX = data; // Cache globally for potential reuse
    } catch (error) {
      console.error('Failed to load search index:', error);
      this.searchIndex = [];
      this.indexLoaded = true; // Mark as loaded (with empty) to stop loading indicator
    } finally {
      this.indexLoading = false;
    }

    // If user was waiting, trigger search now
    this.indexArrived();
  }

  /**
   * Load full-text index from external JSON file
   * This maps words to document paths for content-based search
   */
  async loadFullTextIndex() {
    this.fullTextLoading = true;

    try {
      const response = await fetch('/public/fulltext-index.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      this.fullTextIndex = data;
      this.fullTextLoaded = true;
      window.FULLTEXT_INDEX = data;

      // If user was waiting, trigger search now
      this.indexArrived();
    } catch (error) {
      console.error('Failed to load full-text index:', error);
      this.fullTextIndex = {};
      this.fullTextLoaded = true;
    } finally {
      this.fullTextLoading = false;
    }
  }

  /**
   * Search paths/titles (original search method)
   */
  searchPaths(query) {
    if (!this.searchIndex || !Array.isArray(this.searchIndex)) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    const queryWords = normalizedQuery.split(/\s+/);
    const results = [];

    // Search through the index
    this.searchIndex.forEach(item => {
      const titleLower = (item.title || '').toLowerCase();
      const pathLower = (item.path || '').toLowerCase();

      // Check if all query words match in title or path
      const allWordsMatch = queryWords.every(word =>
        titleLower.includes(word) ||
        pathLower.includes(word)
      );

      if (!allWordsMatch) return;

      let score = 0;

      // Boost exact title matches
      if (titleLower === normalizedQuery) score += 100;
      else if (titleLower.startsWith(normalizedQuery)) score += 50;
      else if (titleLower.includes(normalizedQuery)) score += 25;

      // Boost path matches
      if (pathLower.includes(normalizedQuery)) score += 10;

      // Bonus for each word match in title
      queryWords.forEach(word => {
        if (titleLower.includes(word)) score += 3;
      });

      results.push({ ...item, score, matchType: 'path' });
    });

    // Sort by score, then by title
    return results
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.title || '').localeCompare(b.title || '');
      });
  }

  /**
   * Search full-text index for content matches
   */
  searchFullText(query) {
    if (!this.fullTextIndex || !this.fullTextLoaded) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length >= 2);

    if (queryWords.length === 0) return [];

    // Collect document scores from full-text index
    const docScores = {};
    const docWordMatches = {};

    for (const word of queryWords) {
      // Find matching words in the index (prefix match)
      const matchingWords = Object.keys(this.fullTextIndex).filter(indexWord =>
        indexWord.startsWith(word) || indexWord === word
      );

      for (const matchingWord of matchingWords) {
        const entries = this.fullTextIndex[matchingWord];
        if (!entries) continue;

        for (const entry of entries) {
          const path = entry.p;
          const score = entry.s;

          // Boost exact word match over prefix match
          const scoreMultiplier = matchingWord === word ? 1.0 : 0.5;

          docScores[path] = (docScores[path] || 0) + (score * scoreMultiplier);

          // Track which words matched for this document
          if (!docWordMatches[path]) {
            docWordMatches[path] = new Set();
          }
          docWordMatches[path].add(word);
        }
      }
    }

    // Only include documents that match ALL query words
    const results = [];
    for (const [path, score] of Object.entries(docScores)) {
      // Check if all query words matched
      if (!docWordMatches[path] || docWordMatches[path].size < queryWords.length) {
        continue;
      }

      // Find the document info from search index
      const docInfo = this.searchIndex?.find(item => item.path === path);

      results.push({
        path: path,
        url: docInfo?.url || path,
        title: docInfo?.title || path.split('/').pop().replace('.html', ''),
        score: score,
        matchType: 'fulltext'
      });
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Go to a result picked in any box.
   */
  navigateToResult(result, box) {
    // Collapse the box immediately and empty it, so it is neither stuck open
    // nor pre-filled if the navigation does not trigger a fresh page load
    // (e.g. same-page anchor links, or restoration from the browser's
    // back/forward cache).
    box?.reset();
    // Also close the search panel (if it is open) so the search UI fully
    // collapses, mirroring the effect of clicking the search icon again.
    if (window.widgetManager && typeof window.widgetManager.closeWidget === 'function') {
      try {
        window.widgetManager.closeWidget('search');
      } catch {
        // ignore — best effort
      }
    }
    if (result.url) {
      window.location.href = result.url;
    } else if (result.path) {
      window.location.href = result.path;
    }
  }
}

/**
 * One `search.ursa-search` element: an input, a clear button and a listbox of
 * results. The same markup and behaviour in both placements; `data-placement`
 * only decides whether the results are a dropdown that gets out of the way
 * (topbar) or part of the panel that stays put (panel).
 */
class SearchBox {
  constructor(engine, root) {
    this.engine = engine;
    this.root = root;
    this.placement = root.dataset.placement || 'topbar';
    this.input = root.querySelector('.ursa-search-input');
    this.currentSelection = -1;
    this._lastResults = null;
    this._lastFullTextResults = null;
    this._lastQuery = '';
    this._visibleResults = [];
    this._showingMorePaths = false;
    this._showingMoreFullText = false;

    this.ensureParts();
    this.bindEvents();
  }

  /**
   * The template ships the clear button and the listbox; make them if a
   * template left them out, so a bare input still works.
   */
  ensureParts() {
    this.clearButton = this.root.querySelector('.ursa-search-clear');
    if (!this.clearButton) {
      this.clearButton = document.createElement('button');
      this.clearButton.className = 'ursa-button ursa-search-clear';
      this.clearButton.type = 'button';
      this.clearButton.setAttribute('aria-label', 'Clear search');
      this.clearButton.textContent = '×';
      this.clearButton.hidden = true;
      this.input.after(this.clearButton);
    }

    this.results = this.root.querySelector('.ursa-search-results');
    if (!this.results) {
      this.results = document.createElement('div');
      this.results.className = 'ursa-search-results';
      this.results.setAttribute('role', 'listbox');
      this.results.setAttribute('aria-label', 'Search results');
      this.results.hidden = true;
      this.root.appendChild(this.results);
    }
    if (!this.results.id) {
      this.results.id = `${this.input.id || `ursa-search-${this.placement}`}-results`;
    }

    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-controls', this.results.id);
    this.input.setAttribute('aria-expanded', String(!this.results.hidden));
  }

  bindEvents() {
    // Input events
    this.input.addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
      this.updateClearButtonVisibility();
    });

    // Clear button click
    this.clearButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.clearSearch();
    });

    // Keyboard navigation
    this.input.addEventListener('keydown', (e) => {
      this.handleKeydown(e);
    });

    // Focus events
    this.input.addEventListener('focus', () => {
      if (this.input.value.trim()) {
        this.handleSearch(this.input.value);
      }
    });

    // Pressing on the listbox (a result, "show more") would otherwise take
    // focus from the input, and in the topbar a blur closes the dropdown
    // before the click lands. Focus stays in the combobox, as it should.
    this.results.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    // The panel's results are part of the panel: they stay until the panel
    // closes. The topbar's are a dropdown over the page and get out of the way.
    if (this.placement !== 'topbar') return;

    this.input.addEventListener('blur', () => {
      // Delay hiding to allow click on results
      setTimeout(() => {
        this.hideResults();
      }, 150);
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!this.root.contains(e.target)) {
        this.hideResults();
      }
    });
  }

  handleSearch(query) {
    const trimmedQuery = (query || '').trim();
    const engine = this.engine;

    // Reset "show more" state on new search
    this._showingMorePaths = false;
    this._showingMoreFullText = false;

    // Clear results for empty query
    if (!trimmedQuery) {
      this.hideResults();
      this.results.replaceChildren();
      return;
    }

    // Show minimum character message
    if (trimmedQuery.length < engine.MIN_QUERY_LENGTH) {
      this.showMessage(`Type at least ${engine.MIN_QUERY_LENGTH} characters to search`);
      return;
    }

    // Show loading indicator if index isn't ready
    if (engine.indexLoading || !engine.indexLoaded) {
      this.showMessage('Loading search index...');
      return;
    }

    this._lastResults = engine.searchPaths(trimmedQuery);
    this._lastFullTextResults = engine.searchFullText(trimmedQuery);
    this._lastQuery = trimmedQuery;

    this.displayCombinedResults();
  }

  /**
   * Show a message in the results listbox (for loading, errors, etc.)
   */
  showMessage(message) {
    this._visibleResults = [];

    const p = document.createElement('p');
    p.className = 'ursa-panel-message';
    p.textContent = message;
    this.results.replaceChildren(p);

    this.showResults();
  }

  /**
   * Display combined path and full-text results from the last search
   */
  displayCombinedResults() {
    const pathResults = this._lastResults || [];
    const fullTextResults = this._lastFullTextResults || [];
    const query = this._lastQuery;

    // Deduplicate: remove full-text results that are already in path results
    const pathPaths = new Set(pathResults.map(r => r.path));
    const uniqueFullTextResults = fullTextResults.filter(r => !pathPaths.has(r.path));

    if (pathResults.length === 0 && uniqueFullTextResults.length === 0) {
      this.showMessage(`No results for "${query}"`);
      return;
    }

    this.results.replaceChildren();
    this._visibleResults = [];

    // Path/Title matches group
    if (pathResults.length > 0) {
      this.results.appendChild(this.createGroup({
        key: 'paths',
        label: `Title/Path Matches (${pathResults.length})`,
        results: pathResults,
        initial: this.engine.INITIAL_PATH_RESULTS,
        showingMore: this._showingMorePaths,
        showMore: () => { this._showingMorePaths = true; },
      }));
    }

    // Full-text matches group
    if (uniqueFullTextResults.length > 0) {
      this.results.appendChild(this.createGroup({
        key: 'content',
        label: `Content Matches (${uniqueFullTextResults.length})`,
        results: uniqueFullTextResults,
        initial: this.engine.INITIAL_FULLTEXT_RESULTS,
        showingMore: this._showingMoreFullText,
        showMore: () => { this._showingMoreFullText = true; },
      }));
    }

    // Re-rendering drops any selection
    this.currentSelection = -1;
    this.updateSelection();
    this.showResults();
  }

  /**
   * One labelled group of options, with its "show more" button when some of
   * its results are held back. The button sits inside the group so it stays
   * with the results it would reveal.
   */
  createGroup({ key, label, results, initial, showingMore, showMore }) {
    const group = document.createElement('div');
    group.className = 'ursa-search-group';
    group.setAttribute('role', 'group');

    const title = document.createElement('h3');
    title.className = 'ursa-search-group-title';
    title.id = `${this.results.id}-group-${key}`;
    title.textContent = label;
    group.setAttribute('aria-labelledby', title.id);
    group.appendChild(title);

    const visible = showingMore ? results : results.slice(0, initial);
    visible.forEach((result) => {
      group.appendChild(this.createResultItem(result, this._visibleResults.length));
      this._visibleResults.push(result);
    });

    // Add "show more" button if there are more results
    if (results.length > initial && !showingMore) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'ursa-search-more';
      moreBtn.type = 'button';
      moreBtn.textContent = `Show ${results.length - initial} more`;
      moreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        // The button is gone by the time the click reaches the document, so
        // an outside-click handler there would think the click was outside.
        e.stopPropagation();
        showMore();
        this.displayCombinedResults();
      });
      group.appendChild(moreBtn);
    }

    return group;
  }

  /**
   * Create a single result option
   */
  createResultItem(result, index) {
    const item = document.createElement('div');
    item.className = 'ursa-search-result';
    item.id = `${this.results.id}-option-${index}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');

    const title = document.createElement('span');
    title.className = 'ursa-search-result-title';
    title.textContent = result.title || 'Untitled';

    const path = document.createElement('span');
    path.className = 'ursa-search-result-path';
    path.textContent = result.path || result.url || '';

    item.appendChild(title);
    item.appendChild(path);

    // Click handler
    item.addEventListener('click', () => {
      this.engine.navigateToResult(result, this);
    });

    // Mouse hover selection
    item.addEventListener('mouseenter', () => {
      this.currentSelection = index;
      this.updateSelection();
    });

    return item;
  }

  showResults() {
    this.results.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
  }

  hideResults() {
    this.results.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.currentSelection = -1;
    this.updateSelection();
  }

  clearSearch() {
    this.input.value = '';
    this.hideResults();
    this.results.replaceChildren();
    this.updateClearButtonVisibility();
    this.input.focus();
  }

  /**
   * Back to an empty, collapsed box without taking focus.
   */
  reset() {
    this.input.value = '';
    this.hideResults();
    this.results.replaceChildren();
    this._visibleResults = [];
    this.updateClearButtonVisibility();
  }

  updateClearButtonVisibility() {
    this.clearButton.hidden = !this.input.value.trim();
  }

  handleKeydown(e) {
    const count = this._visibleResults.length;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (count > 0) {
          this.currentSelection = Math.min(this.currentSelection + 1, count - 1);
          this.updateSelection();
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (count > 0) {
          this.currentSelection = Math.max(this.currentSelection - 1, 0);
          this.updateSelection();
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (this.currentSelection >= 0) {
          const result = this._visibleResults[this.currentSelection];
          if (result) {
            this.engine.navigateToResult(result, this);
          }
        }
        break;

      case 'Escape':
        // In the panel, Escape belongs to the panel: widgets.js closes it.
        if (this.placement === 'topbar') {
          this.hideResults();
          this.input.blur();
        }
        break;
    }
  }

  updateSelection() {
    const items = this.results.querySelectorAll('.ursa-search-result');
    items.forEach((item, index) => {
      item.setAttribute('aria-selected', String(index === this.currentSelection));
    });

    const selected = this.currentSelection >= 0 ? items[this.currentSelection] : null;
    if (selected) {
      this.input.setAttribute('aria-activedescendant', selected.id);
      // Scroll selected item into view
      selected.scrollIntoView({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.globalSearch = new GlobalSearch();
});

// Also collapse and empty every search box if the page is restored from the
// browser's back/forward cache (bfcache). Without this, the results can
// appear "stuck" open, and the field pre-populated with the previous query.
window.addEventListener('pageshow', () => {
  window.globalSearch?.boxes.forEach(box => box.reset());
});
