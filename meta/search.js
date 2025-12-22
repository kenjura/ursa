// Global search functionality with typeahead
// Supports lazy-loading of search index for large datasets

class GlobalSearch {
  constructor() {
    this.searchInput = document.getElementById('global-search');
    this.searchResults = null;
    this.searchIndex = null; // Will be loaded asynchronously
    this.indexLoading = false;
    this.indexLoaded = false;
    this.currentSelection = -1;
    this._lastResults = null;
    this.MIN_QUERY_LENGTH = 3;
    
    if (!this.searchInput) return;
    
    this.init();
  }
  
  init() {
    this.wrapSearchInput();
    this.createResultsContainer();
    this.createClearButton();
    this.bindEvents();
    // Start loading the index immediately (but don't block)
    this.loadSearchIndex();
  }
  
  wrapSearchInput() {
    // Wrap the search input in a container for positioning the clear button
    this.searchWrapper = document.createElement('div');
    this.searchWrapper.className = 'search-wrapper';
    this.searchInput.parentNode.insertBefore(this.searchWrapper, this.searchInput);
    this.searchWrapper.appendChild(this.searchInput);
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
      setTimeout(() => {
        this.hideResults();
      }, 150);
    });
    
    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!this.searchInput.contains(e.target) && !this.searchResults.contains(e.target)) {
        this.hideResults();
      }
    });
  }
  
  handleSearch(query) {
    const trimmedQuery = (query || '').trim();
    
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
    
    const results = this.search(trimmedQuery);
    this._lastResults = results;
    this.displayResults(results, trimmedQuery);
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
  
  search(query) {
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
      const contentLower = (item.content || '').toLowerCase();
      
      // Check if all query words match somewhere
      const allWordsMatch = queryWords.every(word => 
        titleLower.includes(word) || 
        pathLower.includes(word) || 
        contentLower.includes(word)
      );
      
      if (!allWordsMatch) return;
      
      let score = 0;
      
      // Boost exact title matches
      if (titleLower === normalizedQuery) score += 100;
      else if (titleLower.startsWith(normalizedQuery)) score += 50;
      else if (titleLower.includes(normalizedQuery)) score += 25;
      
      // Boost path matches
      if (pathLower.includes(normalizedQuery)) score += 10;
      
      // Content matches get lower score
      if (contentLower.includes(normalizedQuery)) score += 5;
      
      // Bonus for each word match in title
      queryWords.forEach(word => {
        if (titleLower.includes(word)) score += 3;
      });
      
      results.push({ ...item, score });
    });
    
    // Sort by score, then by title
    return results
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.title || '').localeCompare(b.title || '');
      })
      .slice(0, 10); // Limit to 10 results
  }
  
  displayResults(results, query) {
    if (results.length === 0) {
      this.showMessage(`No results for "${query}"`);
      return;
    }
    
    this.searchResults.innerHTML = '';
    this.currentSelection = -1;
    
    results.forEach((result, index) => {
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
      
      this.searchResults.appendChild(item);
    });
    
    this.showResults();
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
        if (this.currentSelection >= 0 && this._lastResults && this._lastResults[this.currentSelection]) {
          this.navigateToResult(this._lastResults[this.currentSelection]);
        }
        break;
        
      case 'Escape':
        this.hideResults();
        this.searchInput.blur();
        break;
    }
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