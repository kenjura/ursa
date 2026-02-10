/**
 * Widget system for the top nav right-side panel.
 * 
 * Widgets appear as icon buttons in the nav bar. Clicking a button toggles a
 * dropdown panel anchored to the right side below the nav. Only one widget can
 * be open at a time.
 * 
 * Built-in widgets: TOC, Search, Profile
 */
class WidgetManager {
  constructor() {
    this.dropdown = document.getElementById('widget-dropdown');
    this.buttons = document.querySelectorAll('.widget-button[data-widget]');
    this.activeWidget = null;
    
    if (!this.dropdown || this.buttons.length === 0) return;
    
    this.init();
  }
  
  init() {
    // Bind button clicks
    this.buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const widgetName = btn.dataset.widget;
        this.toggle(widgetName);
      });
    });
    
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (this.activeWidget && 
          !this.dropdown.contains(e.target) &&
          !e.target.closest('.widget-button')) {
        this.close();
      }
    });
    
    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeWidget) {
        this.close();
      }
    });

    // Initialize search widget content
    this.initSearchWidget();
  }
  
  /**
   * Toggle a widget open/closed. If a different widget is open, switch to the new one.
   */
  toggle(widgetName) {
    if (this.activeWidget === widgetName) {
      this.close();
      return;
    }
    
    this.open(widgetName);
  }
  
  /**
   * Open a specific widget panel.
   */
  open(widgetName) {
    // Close any open widget first
    if (this.activeWidget) {
      this.deactivateContent(this.activeWidget);
    }
    
    this.activeWidget = widgetName;
    
    // Show dropdown
    this.dropdown.classList.remove('hidden');
    this.dropdown.dataset.activeWidget = widgetName;
    
    // Show the correct content panel
    this.activateContent(widgetName);
    
    // Update button states
    this.buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.widget === widgetName);
    });

    // Fire event for other scripts to listen to
    document.dispatchEvent(new CustomEvent('widget-opened', { detail: { widget: widgetName } }));
  }
  
  /**
   * Close the currently open widget.
   */
  close() {
    if (!this.activeWidget) return;
    
    const closing = this.activeWidget;
    this.deactivateContent(closing);
    
    this.activeWidget = null;
    this.dropdown.classList.add('hidden');
    delete this.dropdown.dataset.activeWidget;
    
    // Update button states
    this.buttons.forEach(btn => btn.classList.remove('active'));
    
    // Fire event
    document.dispatchEvent(new CustomEvent('widget-closed', { detail: { widget: closing } }));
  }
  
  /**
   * Show a widget's content panel.
   */
  activateContent(widgetName) {
    const content = this.dropdown.querySelector(`.widget-content[data-widget="${widgetName}"]`);
    if (content) {
      content.classList.add('active');
    }
    
    // Widget-specific activation
    if (widgetName === 'search') {
      this.activateSearch();
    }
  }
  
  /**
   * Hide a widget's content panel.
   */
  deactivateContent(widgetName) {
    const content = this.dropdown.querySelector(`.widget-content[data-widget="${widgetName}"]`);
    if (content) {
      content.classList.remove('active');
    }
    
    // Widget-specific deactivation
    if (widgetName === 'search') {
      this.deactivateSearch();
    }
  }
  
  /**
   * Initialize search widget — move the search input and results into the widget panel.
   */
  initSearchWidget() {
    const searchContent = document.getElementById('widget-content-search');
    if (!searchContent) return;
    
    // The search input and wrapper are created by search.js (GlobalSearch).
    // We need to wait for it to be ready, then move elements into the widget.
    // Use a short delay to let GlobalSearch initialize first.
    const moveSearch = () => {
      const searchWrapper = document.querySelector('.search-wrapper-inline');
      const searchResults = document.getElementById('search-results');
      
      if (searchWrapper) {
        // Clone the search input into the widget (the inline one stays for non-top-menu/mobile)
        // Actually, we'll relocate the existing elements when the widget is activated.
        // For now, create a dedicated search input for the widget.
        const widgetInput = document.createElement('input');
        widgetInput.id = 'widget-search-input';
        widgetInput.type = 'text';
        widgetInput.placeholder = 'Search...';
        widgetInput.className = 'widget-search-input';
        
        const widgetWrapper = document.createElement('div');
        widgetWrapper.className = 'widget-search-wrapper';
        widgetWrapper.appendChild(widgetInput);
        
        // Create dedicated results container for widget
        const widgetResults = document.createElement('div');
        widgetResults.id = 'widget-search-results';
        widgetResults.className = 'widget-search-results';
        
        searchContent.appendChild(widgetWrapper);
        searchContent.appendChild(widgetResults);
        
        // Bind the widget search input to the GlobalSearch instance
        this.bindWidgetSearch(widgetInput, widgetResults);
      }
    };
    
    // Wait for search.js to initialize
    setTimeout(moveSearch, 50);
  }
  
  /**
   * Bind the widget search input to use GlobalSearch's search functionality.
   */
  bindWidgetSearch(input, resultsContainer) {
    this._widgetSearchInput = input;
    this._widgetSearchResults = resultsContainer;
    
    let currentSelection = -1;
    
    input.addEventListener('input', () => {
      const query = input.value.trim();
      this.performWidgetSearch(query);
    });
    
    input.addEventListener('keydown', (e) => {
      const items = resultsContainer.querySelectorAll('.search-result-item');
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (items.length > 0) {
            currentSelection = Math.min(currentSelection + 1, items.length - 1);
            this.updateWidgetSearchSelection(items, currentSelection);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (items.length > 0) {
            currentSelection = Math.max(currentSelection - 1, 0);
            this.updateWidgetSearchSelection(items, currentSelection);
          }
          break;
        case 'Enter':
          e.preventDefault();
          if (currentSelection >= 0 && items[currentSelection]) {
            items[currentSelection].click();
          }
          break;
        case 'Escape':
          this.close();
          break;
      }
    });

    // Reset selection on new search
    input.addEventListener('input', () => { currentSelection = -1; });
  }
  
  /**
   * Perform search using GlobalSearch's search logic, rendering into widget results.
   */
  performWidgetSearch(query) {
    const gs = window.globalSearch;
    const container = this._widgetSearchResults;
    if (!gs || !container) return;
    
    container.innerHTML = '';
    
    if (!query || query.length < gs.MIN_QUERY_LENGTH) {
      if (query && query.length > 0) {
        container.innerHTML = `<div class="search-result-message">Type at least ${gs.MIN_QUERY_LENGTH} characters to search</div>`;
      }
      return;
    }
    
    if (!gs.indexLoaded) {
      container.innerHTML = '<div class="search-result-message">Loading search index...</div>';
      return;
    }
    
    const pathResults = gs.searchPaths(query);
    const fullTextResults = gs.searchFullText(query);
    
    // Deduplicate
    const pathPaths = new Set(pathResults.map(r => r.path));
    const uniqueFullTextResults = fullTextResults.filter(r => !pathPaths.has(r.path));
    
    if (pathResults.length === 0 && uniqueFullTextResults.length === 0) {
      container.innerHTML = `<div class="search-result-message">No results for "${query}"</div>`;
      return;
    }
    
    // Path results section
    if (pathResults.length > 0) {
      const section = document.createElement('div');
      section.className = 'search-section';
      const header = document.createElement('div');
      header.className = 'search-section-header';
      header.textContent = `Title/Path Matches (${pathResults.length})`;
      section.appendChild(header);
      
      const limit = Math.min(pathResults.length, 10);
      for (let i = 0; i < limit; i++) {
        section.appendChild(this.createWidgetResultItem(pathResults[i]));
      }
      if (pathResults.length > 10) {
        const more = document.createElement('div');
        more.className = 'search-result-message';
        more.textContent = `... and ${pathResults.length - 10} more`;
        section.appendChild(more);
      }
      container.appendChild(section);
    }
    
    // Full-text results section
    if (uniqueFullTextResults.length > 0) {
      const section = document.createElement('div');
      section.className = 'search-section';
      const header = document.createElement('div');
      header.className = 'search-section-header';
      header.textContent = `Content Matches (${uniqueFullTextResults.length})`;
      section.appendChild(header);
      
      const limit = Math.min(uniqueFullTextResults.length, 10);
      for (let i = 0; i < limit; i++) {
        section.appendChild(this.createWidgetResultItem(uniqueFullTextResults[i]));
      }
      if (uniqueFullTextResults.length > 10) {
        const more = document.createElement('div');
        more.className = 'search-result-message';
        more.textContent = `... and ${uniqueFullTextResults.length - 10} more`;
        section.appendChild(more);
      }
      container.appendChild(section);
    }
  }
  
  /**
   * Create a search result item for the widget.
   */
  createWidgetResultItem(result) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    
    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.textContent = result.title || 'Untitled';
    
    const path = document.createElement('div');
    path.className = 'search-result-path';
    path.textContent = result.path || result.url || '';
    
    item.appendChild(title);
    item.appendChild(path);
    
    item.addEventListener('click', () => {
      window.location.href = result.url || result.path;
    });
    
    item.addEventListener('mouseenter', () => {
      // Clear other selections
      item.closest('.widget-search-results')?.querySelectorAll('.search-result-item').forEach(el => {
        el.classList.remove('selected');
      });
      item.classList.add('selected');
    });
    
    return item;
  }
  
  updateWidgetSearchSelection(items, index) {
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === index);
    });
    if (index >= 0 && items[index]) {
      items[index].scrollIntoView({ block: 'nearest' });
    }
  }
  
  /**
   * Called when the search widget is activated.
   */
  activateSearch() {
    const input = this._widgetSearchInput;
    if (input) {
      // Focus with small delay to allow panel animation
      setTimeout(() => input.focus(), 50);
    }
  }
  
  /**
   * Called when the search widget is deactivated.
   */
  deactivateSearch() {
    // Keep the search query so user can re-open and see results
  }
}

// Initialize widgets when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.widgetManager = new WidgetManager();
});
