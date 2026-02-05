// Global search functionality with typeahead
// Supports lazy-loading of search index for large datasets

class GlobalSearch {
  constructor() {
    this.searchInput = document.getElementById('global-search');
    this.searchResults = null;
    this.searchIndex = null; // Will be loaded asynchronously
    this.fullTextIndex = null; // Word-to-document mapping
    this.indexLoading = false;
    this.indexLoaded = false;
    this.fullTextLoading = false;
    this.fullTextLoaded = false;
    this.currentSelection = -1;
    this._lastResults = null;
    this._lastFullTextResults = null;
    this._showingMorePaths = false;
    this._showingMoreFullText = false;
    this.MIN_QUERY_LENGTH = 3;
    this.INITIAL_PATH_RESULTS = 5;
    this.INITIAL_FULLTEXT_RESULTS = 5;
    
    if (!this.searchInput) return;
    
    this.init();
  }
  
  init() {
    this.wrapSearchInput();
    this.createResultsContainer();
    this.createClearButton();
    this.bindEvents();
    // Start loading the indices immediately (but don't block)
    this.loadSearchIndex();
    this.loadFullTextIndex();
  }
  
  wrapSearchInput() {
    // Use existing search-wrapper if present, otherwise create one
    this.searchWrapper = this.searchInput.closest('.search-wrapper');
    if (!this.searchWrapper) {
      // Fallback: wrap the search input in a container for positioning the clear button
      this.searchWrapper = document.createElement('div');
      this.searchWrapper.className = 'search-wrapper';
      this.searchInput.parentNode.insertBefore(this.searchWrapper, this.searchInput);
      this.searchWrapper.appendChild(this.searchInput);
    }
  }
  
  createClearButton() {
    this.clearButton = document.createElement('button');
    this.clearButton.className = 'search-clear-button hidden';
    this.clearButton.type = 'button';
    this.clearButton.setAttribute('aria-label', 'Clear search');
    this.clearButton.innerHTML = '×';
    this.searchWrapper.appendChild(this.clearButton);
  }
  
  createResultsContainer() {
    this.searchResults = document.createElement('div');
    this.searchResults.id = 'search-results';
    this.searchResults.className = 'search-results hidden';
    this.searchInput.parentNode.appendChild(this.searchResults);
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
      
      // If user was waiting, trigger search now
      if (this.searchInput.value.length >= this.MIN_QUERY_LENGTH) {
        this.handleSearch(this.searchInput.value);
      }
    } catch (error) {
      console.error('Failed to load search index:', error);
      this.searchIndex = [];
      this.indexLoaded = true; // Mark as loaded (with empty) to stop loading indicator
    } finally {
      this.indexLoading = false;
    }
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
      if (this.searchInput.value.length >= this.MIN_QUERY_LENGTH) {
        this.handleSearch(this.searchInput.value);
      }
    } catch (error) {
      console.error('Failed to load full-text index:', error);
      this.fullTextIndex = {};
      this.fullTextLoaded = true;
    } finally {
      this.fullTextLoading = false;
    }
  }
  
  bindEvents() {
    // Input events
    this.searchInput.addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
      this.updateClearButtonVisibility();
    });
    
    // Clear button click
    this.clearButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.clearSearch();
    });
    
    // Keyboard navigation
    this.searchInput.addEventListener('keydown', (e) => {
      this.handleKeydown(e);
    });
    
    // Focus events
    this.searchInput.addEventListener('focus', () => {
      if (this.searchInput.value.trim()) {
        this.handleSearch(this.searchInput.value);
      }
    });
    
    this.searchInput.addEventListener('blur', (e) => {
      // Delay hiding to allow click on results
      // Check if we're inside the floating search container (top menu mode)
      const floatingSearch = this.searchInput.closest('.search-floating');
      if (floatingSearch && floatingSearch.classList.contains('active')) {
        // In floating mode, don't auto-hide on blur - let the backdrop click handle it
        return;
      }
      setTimeout(() => {
        this.hideResults();
      }, 150);
    });
    
    // Click outside to close
    document.addEventListener('click', (e) => {
      // If inside floating search container, don't close on internal clicks
      const floatingSearch = this.searchInput.closest('.search-floating');
      if (floatingSearch && floatingSearch.contains(e.target)) {
        return;
      }
      if (!this.searchInput.contains(e.target) && !this.searchResults.contains(e.target)) {
        this.hideResults();
      }
    });
    
    // Global hotkey: Cmd/Ctrl+P to focus search
    document.addEventListener('keydown', (e) => {
      // Check for Cmd+P (Mac) or Ctrl+P (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
      }
    });
  }
  
  handleSearch(query) {
    const trimmedQuery = (query || '').trim();
    
    // Reset "show more" state on new search
    this._showingMorePaths = false;
    this._showingMoreFullText = false;
    
    // Clear results for empty query
    if (!trimmedQuery) {
      this.hideResults();
      return;
    }
    
    // Show minimum character message
    if (trimmedQuery.length < this.MIN_QUERY_LENGTH) {
      this.showMessage(`Type at least ${this.MIN_QUERY_LENGTH} characters to search`);
      return;
    }
    
    // Show loading indicator if index isn't ready
    if (this.indexLoading || !this.indexLoaded) {
      this.showMessage('Loading search index...');
      return;
    }
    
    const pathResults = this.searchPaths(trimmedQuery);
    const fullTextResults = this.searchFullText(trimmedQuery);
    
    this._lastResults = pathResults;
    this._lastFullTextResults = fullTextResults;
    this._lastQuery = trimmedQuery;
    
    this.displayCombinedResults(pathResults, fullTextResults, trimmedQuery);
  }
  
  /**
   * Show a message in the results dropdown (for loading, errors, etc.)
   */
  showMessage(message) {
    this.searchResults.innerHTML = '';
    this.currentSelection = -1;
    
    const item = document.createElement('div');
    item.className = 'search-result-message';
    item.textContent = message;
    this.searchResults.appendChild(item);
    
    this.showResults();
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
   * Display combined path and full-text results
   */
  displayCombinedResults(pathResults, fullTextResults, query) {
    // Deduplicate: remove full-text results that are already in path results
    const pathPaths = new Set(pathResults.map(r => r.path));
    const uniqueFullTextResults = fullTextResults.filter(r => !pathPaths.has(r.path));
    
    if (pathResults.length === 0 && uniqueFullTextResults.length === 0) {
      this.showMessage(`No results for "${query}"`);
      return;
    }
    
    this.searchResults.innerHTML = '';
    this.currentSelection = -1;
    
    // Determine how many results to show
    const pathLimit = this._showingMorePaths ? pathResults.length : this.INITIAL_PATH_RESULTS;
    const fullTextLimit = this._showingMoreFullText ? uniqueFullTextResults.length : this.INITIAL_FULLTEXT_RESULTS;
    
    const visiblePathResults = pathResults.slice(0, pathLimit);
    const visibleFullTextResults = uniqueFullTextResults.slice(0, fullTextLimit);
    
    let currentIndex = 0;
    
    // Path/Title matches section
    if (pathResults.length > 0) {
      const section = document.createElement('div');
      section.className = 'search-section';
      
      const header = document.createElement('div');
      header.className = 'search-section-header';
      header.textContent = `Title/Path Matches (${pathResults.length})`;
      section.appendChild(header);
      
      visiblePathResults.forEach((result) => {
        const item = this.createResultItem(result, currentIndex);
        section.appendChild(item);
        currentIndex++;
      });
      
      // Add "show more" button if there are more results
      if (pathResults.length > this.INITIAL_PATH_RESULTS && !this._showingMorePaths) {
        const moreBtn = document.createElement('button');
        moreBtn.className = 'search-show-more';
        moreBtn.textContent = `Show ${pathResults.length - this.INITIAL_PATH_RESULTS} more`;
        moreBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._showingMorePaths = true;
          this.displayCombinedResults(this._lastResults, this._lastFullTextResults, this._lastQuery);
        });
        section.appendChild(moreBtn);
      }
      
      this.searchResults.appendChild(section);
    }
    
    // Full-text matches section
    if (uniqueFullTextResults.length > 0) {
      const section = document.createElement('div');
      section.className = 'search-section';
      
      const header = document.createElement('div');
      header.className = 'search-section-header';
      header.textContent = `Content Matches (${uniqueFullTextResults.length})`;
      section.appendChild(header);
      
      visibleFullTextResults.forEach((result) => {
        const item = this.createResultItem(result, currentIndex);
        section.appendChild(item);
        currentIndex++;
      });
      
      // Add "show more" button if there are more results
      if (uniqueFullTextResults.length > this.INITIAL_FULLTEXT_RESULTS && !this._showingMoreFullText) {
        const moreBtn = document.createElement('button');
        moreBtn.className = 'search-show-more';
        moreBtn.textContent = `Show ${uniqueFullTextResults.length - this.INITIAL_FULLTEXT_RESULTS} more`;
        moreBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._showingMoreFullText = true;
          this.displayCombinedResults(this._lastResults, this._lastFullTextResults, this._lastQuery);
        });
        section.appendChild(moreBtn);
      }
      
      this.searchResults.appendChild(section);
    }
    
    this.showResults();
  }
  
  /**
   * Create a single result item element
   */
  createResultItem(result, index) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.dataset.index = index;
    
    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.textContent = result.title || 'Untitled';
    
    const path = document.createElement('div');
    path.className = 'search-result-path';
    path.textContent = result.path || result.url || '';
    
    item.appendChild(title);
    item.appendChild(path);
    
    // Click handler
    item.addEventListener('click', () => {
      this.navigateToResult(result);
    });
    
    // Mouse hover selection
    item.addEventListener('mouseenter', () => {
      this.currentSelection = index;
      this.updateSelection();
    });
    
    return item;
  }
  
  displayResults(results, query) {
    // Legacy method - redirect to combined display
    this.displayCombinedResults(results, [], query);
  }
  
  showResults() {
    this.searchResults.classList.remove('hidden');
  }
  
  hideResults() {
    this.searchResults.classList.add('hidden');
    this.currentSelection = -1;
  }
  
  clearSearch() {
    this.searchInput.value = '';
    this.hideResults();
    this.updateClearButtonVisibility();
    this.searchInput.focus();
  }
  
  updateClearButtonVisibility() {
    if (this.searchInput.value.trim()) {
      this.clearButton.classList.remove('hidden');
    } else {
      this.clearButton.classList.add('hidden');
    }
  }
  
  handleKeydown(e) {
    const items = this.searchResults.querySelectorAll('.search-result-item');
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (items.length > 0) {
          this.currentSelection = Math.min(this.currentSelection + 1, items.length - 1);
          this.updateSelection();
        }
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        if (items.length > 0) {
          this.currentSelection = Math.max(this.currentSelection - 1, 0);
          this.updateSelection();
        }
        break;
        
      case 'Enter':
        e.preventDefault();
        if (this.currentSelection >= 0) {
          const result = this.getResultByIndex(this.currentSelection);
          if (result) {
            this.navigateToResult(result);
          }
        }
        break;
        
      case 'Escape':
        this.hideResults();
        this.searchInput.blur();
        break;
    }
  }
  
  /**
   * Get the result object for a given display index
   * Handles both path results and full-text results
   */
  getResultByIndex(index) {
    if (!this._lastResults && !this._lastFullTextResults) return null;
    
    // Calculate which results are visible
    const pathLimit = this._showingMorePaths ? this._lastResults?.length || 0 : this.INITIAL_PATH_RESULTS;
    const visiblePathResults = (this._lastResults || []).slice(0, pathLimit);
    
    // Deduplicate full-text results
    const pathPaths = new Set(visiblePathResults.map(r => r.path));
    const uniqueFullTextResults = (this._lastFullTextResults || []).filter(r => !pathPaths.has(r.path));
    const fullTextLimit = this._showingMoreFullText ? uniqueFullTextResults.length : this.INITIAL_FULLTEXT_RESULTS;
    const visibleFullTextResults = uniqueFullTextResults.slice(0, fullTextLimit);
    
    if (index < visiblePathResults.length) {
      return visiblePathResults[index];
    }
    
    const fullTextIndex = index - visiblePathResults.length;
    if (fullTextIndex < visibleFullTextResults.length) {
      return visibleFullTextResults[fullTextIndex];
    }
    
    return null;
  }
  
  updateSelection() {
    const items = this.searchResults.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
      item.classList.toggle('selected', index === this.currentSelection);
    });
    
    // Scroll selected item into view
    if (this.currentSelection >= 0 && items[this.currentSelection]) {
      items[this.currentSelection].scrollIntoView({ block: 'nearest' });
    }
  }
  
  navigateToResult(result) {
    if (result.url) {
      window.location.href = result.url;
    } else if (result.path) {
      window.location.href = result.path;
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.globalSearch = new GlobalSearch();
});