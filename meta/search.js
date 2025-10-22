// Global search functionality with typeahead
class GlobalSearch {
  constructor() {
    this.searchInput = document.getElementById('global-search');
    this.searchResults = null;
    this.searchIndex = window.SEARCH_INDEX || [];
    this.currentSelection = -1;
    
    if (!this.searchInput) return;
    
    this.init();
  }
  
  init() {
    this.createResultsContainer();
    this.bindEvents();
  }
  
  createResultsContainer() {
    this.searchResults = document.createElement('div');
    this.searchResults.id = 'search-results';
    this.searchResults.className = 'search-results hidden';
    this.searchInput.parentNode.appendChild(this.searchResults);
  }
  
  bindEvents() {
    // Input events
    this.searchInput.addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
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
    if (!query || query.length < 2) {
      this.hideResults();
      return;
    }
    
    const results = this.search(query);
    this.displayResults(results);
  }
  
  search(query) {
    const normalizedQuery = query.toLowerCase().trim();
    const results = [];
    
    // Search through the index
    this.searchIndex.forEach(item => {
      const titleMatch = item.title.toLowerCase().includes(normalizedQuery);
      const pathMatch = item.path.toLowerCase().includes(normalizedQuery);
      const contentMatch = item.content && item.content.toLowerCase().includes(normalizedQuery);
      
      if (titleMatch || pathMatch || contentMatch) {
        let score = 0;
        
        // Boost exact title matches
        if (item.title.toLowerCase() === normalizedQuery) score += 100;
        else if (item.title.toLowerCase().startsWith(normalizedQuery)) score += 50;
        else if (titleMatch) score += 25;
        
        // Boost path matches
        if (pathMatch) score += 10;
        
        // Content matches get lower score
        if (contentMatch) score += 5;
        
        results.push({ ...item, score });
      }
    });
    
    // Sort by score, then by title
    return results
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.title.localeCompare(b.title);
      })
      .slice(0, 10); // Limit to 10 results
  }
  
  displayResults(results) {
    if (results.length === 0) {
      this.hideResults();
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
      title.textContent = result.title;
      
      const path = document.createElement('div');
      path.className = 'search-result-path';
      path.textContent = result.path;
      
      item.appendChild(title);
      item.appendChild(path);
      
      // Click handler
      item.addEventListener('click', () => {
        this.navigateToResult(result);
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
  
  handleKeydown(e) {
    const items = this.searchResults.querySelectorAll('.search-result-item');
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.currentSelection = Math.min(this.currentSelection + 1, items.length - 1);
        this.updateSelection();
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        this.currentSelection = Math.max(this.currentSelection - 1, -1);
        this.updateSelection();
        break;
        
      case 'Enter':
        e.preventDefault();
        if (this.currentSelection >= 0 && items[this.currentSelection]) {
          const index = items[this.currentSelection].dataset.index;
          const results = this.getLastSearchResults();
          if (results && results[index]) {
            this.navigateToResult(results[index]);
          }
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
  }
  
  getLastSearchResults() {
    // Store last search results for keyboard navigation
    if (!this._lastResults) {
      this._lastResults = this.search(this.searchInput.value);
    }
    return this._lastResults;
  }
  
  navigateToResult(result) {
    window.location.href = result.url;
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new GlobalSearch();
});