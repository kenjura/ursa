/**
 * Widget system for the top nav panel.
 * 
 * Widgets appear as icon buttons in the nav bar. Clicking a button toggles a
 * dropdown panel below the nav. Left-side and right-side widgets have separate
 * dropdown panels. One widget can be open per side at a time.
 * 
 * Widget state (open/closed) is persisted in localStorage so it survives page reloads.
 * 
 * Built-in widgets:
 *   Left: Recent Activity (open by default)
 *   Right: TOC, Search, Profile
 */
class WidgetManager {
  constructor() {
    this.dropdownRight = document.getElementById('widget-dropdown');
    this.dropdownLeft = document.getElementById('widget-dropdown-left');
    this.buttons = document.querySelectorAll('.widget-button[data-widget]');
    this.activeRight = null;
    this.activeLeft = null;

    // Widgets that default to open on first visit
    this.defaultOpen = new Set(['recent-activity']);
    
    if (this.buttons.length === 0) return;
    
    this.init();
  }
  
  /**
   * Get the side (left/right) for a widget based on its button's data-widget-side attribute
   */
  getSide(widgetName) {
    const btn = document.querySelector(`.widget-button[data-widget="${widgetName}"]`);
    return btn?.dataset.widgetSide === 'left' ? 'left' : 'right';
  }
  
  /**
   * Get the dropdown element for a given side
   */
  getDropdown(side) {
    return side === 'left' ? this.dropdownLeft : this.dropdownRight;
  }
  
  /**
   * Get the active widget name for a given side
   */
  getActive(side) {
    return side === 'left' ? this.activeLeft : this.activeRight;
  }
  
  /**
   * Set the active widget name for a given side
   */
  setActive(side, widgetName) {
    if (side === 'left') {
      this.activeLeft = widgetName;
    } else {
      this.activeRight = widgetName;
    }
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
    
    // Bind close buttons inside widget headers
    document.querySelectorAll('.widget-close-btn').forEach(closeBtn => {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const widgetContent = closeBtn.closest('.widget-content');
        if (widgetContent) {
          const widgetName = widgetContent.dataset.widget;
          this.close(this.getSide(widgetName));
        }
      });
    });
    
    // Close on outside click
    document.addEventListener('click', (e) => {
      // Close right-side widget if click is outside
      if (this.activeRight && this.dropdownRight &&
          !this.dropdownRight.contains(e.target) &&
          !e.target.closest('.widget-button')) {
        this.close('right');
      }
      // Close left-side widget if click is outside
      if (this.activeLeft && this.dropdownLeft &&
          !this.dropdownLeft.contains(e.target) &&
          !e.target.closest('.widget-button')) {
        this.close('left');
      }
    });
    
    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.activeRight) this.close('right');
        if (this.activeLeft) this.close('left');
      }
    });

    // Initialize search widget content
    this.initSearchWidget();
    
    // Initialize recent activity widget
    this.initRecentActivityWidget();
    
    // Track current page view and initialize suggested content widget
    this.trackPageView();
    this.initSuggestedWidget();

    // Restore saved widget states from localStorage
    this.restoreState();
  }
  
  /**
   * Save widget open/closed state to localStorage
   */
  saveState(widgetName, isOpen) {
    try {
      const key = `ursa-widget-${widgetName}`;
      localStorage.setItem(key, isOpen ? 'open' : 'closed');
    } catch (e) { /* localStorage not available */ }
  }
  
  /**
   * Restore widget states from localStorage. 
   * For widgets with no saved state, use their default (defaultOpen set).
   */
  restoreState() {
    // Gather all widget names
    const widgetNames = new Set();
    this.buttons.forEach(btn => widgetNames.add(btn.dataset.widget));
    
    for (const widgetName of widgetNames) {
      const key = `ursa-widget-${widgetName}`;
      let saved;
      try {
        saved = localStorage.getItem(key);
      } catch (e) { /* localStorage not available */ }
      
      const shouldOpen = saved === 'open' || (saved === null && this.defaultOpen.has(widgetName));
      if (shouldOpen) {
        this.open(widgetName);
      }
    }
  }
  
  /**
   * Toggle a widget open/closed.
   */
  toggle(widgetName) {
    const side = this.getSide(widgetName);
    if (this.getActive(side) === widgetName) {
      this.close(side);
      return;
    }
    
    this.open(widgetName);
  }
  
  /**
   * Open a specific widget panel.
   */
  open(widgetName) {
    const side = this.getSide(widgetName);
    const dropdown = this.getDropdown(side);
    if (!dropdown) return;
    
    // Close any open widget on the same side first
    const currentActive = this.getActive(side);
    if (currentActive) {
      this.deactivateContent(currentActive);
      // Save the closed widget's state
      this.saveState(currentActive, false);
    }
    
    this.setActive(side, widgetName);
    
    // Show dropdown
    dropdown.classList.remove('hidden');
    dropdown.dataset.activeWidget = widgetName;
    
    // Show the correct content panel
    this.activateContent(widgetName);
    
    // Update button states (only for this side's buttons)
    this.buttons.forEach(btn => {
      if (this.getSide(btn.dataset.widget) === side) {
        btn.classList.toggle('active', btn.dataset.widget === widgetName);
      }
    });

    // Save state
    this.saveState(widgetName, true);

    // Fire event for other scripts to listen to
    document.dispatchEvent(new CustomEvent('widget-opened', { detail: { widget: widgetName, side } }));
  }
  
  /**
   * Close the currently open widget on a given side.
   */
  close(side) {
    const active = this.getActive(side);
    if (!active) return;
    
    const dropdown = this.getDropdown(side);
    this.deactivateContent(active);
    
    // Save state
    this.saveState(active, false);
    
    this.setActive(side, null);
    if (dropdown) {
      dropdown.classList.add('hidden');
      delete dropdown.dataset.activeWidget;
    }
    
    // Update button states for this side
    this.buttons.forEach(btn => {
      if (this.getSide(btn.dataset.widget) === side) {
        btn.classList.remove('active');
      }
    });
    
    // Fire event
    document.dispatchEvent(new CustomEvent('widget-closed', { detail: { widget: active, side } }));
  }
  
  /**
   * Show a widget's content panel.
   */
  activateContent(widgetName) {
    const side = this.getSide(widgetName);
    const dropdown = this.getDropdown(side);
    if (!dropdown) return;

    const content = dropdown.querySelector(`.widget-content[data-widget="${widgetName}"]`);
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
    const side = this.getSide(widgetName);
    const dropdown = this.getDropdown(side);
    if (!dropdown) return;

    const content = dropdown.querySelector(`.widget-content[data-widget="${widgetName}"]`);
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

  /**
   * Initialize the Recent Activity widget — fetch data and render the list.
   */
  initRecentActivityWidget() {
    const container = document.querySelector('.recent-activity-list');
    if (!container) return;

    container.innerHTML = '<div class="recent-activity-loading">Loading...</div>';

    fetch('/public/recent-activity.json')
      .then(res => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(items => {
        container.innerHTML = '';
        if (!items || items.length === 0) {
          container.innerHTML = '<div class="recent-activity-empty">No recent activity</div>';
          return;
        }
        const ul = document.createElement('ul');
        ul.className = 'recent-activity-items';
        for (const item of items) {
          const li = document.createElement('li');
          li.className = 'recent-activity-item';
          const a = document.createElement('a');
          a.href = item.url;
          a.textContent = item.title || 'Untitled';
          a.className = 'recent-activity-link';
          const time = document.createElement('span');
          time.className = 'recent-activity-time';
          time.textContent = this.formatRelativeTime(item.mtime);
          time.title = new Date(item.mtime).toLocaleString();
          li.appendChild(a);
          li.appendChild(time);
          ul.appendChild(li);
        }
        container.appendChild(ul);
      })
      .catch(() => {
        container.innerHTML = '<div class="recent-activity-empty">Recent activity unavailable</div>';
      });
  }

  /**
   * Format a timestamp into a human-readable relative time string.
   */
  formatRelativeTime(mtimeMs) {
    const now = Date.now();
    const diff = now - mtimeMs;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (weeks < 5) return `${weeks}w ago`;
    if (months < 12) return `${months}mo ago`;
    return `${years}y ago`;
  }

  /**
   * Track current page view in localStorage.
   * Stores a map of URL → { count, lastVisit, title }
   */
  trackPageView() {
    const url = window.location.pathname;
    // Skip tracking for index/home pages to keep suggestions more focused
    if (url === '/' || url === '/index.html') return;
    
    const STORAGE_KEY = 'ursa-page-views';
    const MAX_TRACKED_PAGES = 100; // Limit storage size
    
    try {
      let pageViews = {};
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        pageViews = JSON.parse(stored);
      }
      
      // Get page title from the document
      const title = document.title || url;
      
      // Update or create entry for this page
      if (pageViews[url]) {
        pageViews[url].count += 1;
        pageViews[url].lastVisit = Date.now();
        pageViews[url].title = title;
      } else {
        pageViews[url] = {
          count: 1,
          lastVisit: Date.now(),
          title: title
        };
      }
      
      // Prune oldest entries if we exceed the limit
      const entries = Object.entries(pageViews);
      if (entries.length > MAX_TRACKED_PAGES) {
        // Sort by lastVisit and keep only the most recent
        entries.sort((a, b) => b[1].lastVisit - a[1].lastVisit);
        pageViews = Object.fromEntries(entries.slice(0, MAX_TRACKED_PAGES));
      }
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pageViews));
    } catch (e) {
      // localStorage not available or quota exceeded
    }
  }

  /**
   * Initialize the Suggested Content widget.
   * Shows frequently viewed pages based on localStorage tracking.
   */
  initSuggestedWidget() {
    const container = document.querySelector('.suggested-content-list');
    if (!container) return;

    const STORAGE_KEY = 'ursa-page-views';
    const MAX_SUGGESTIONS = 10;
    const currentUrl = window.location.pathname;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        container.innerHTML = '<div class="suggested-empty">Visit more pages to see suggestions</div>';
        return;
      }

      const pageViews = JSON.parse(stored);
      const entries = Object.entries(pageViews);
      
      if (entries.length === 0) {
        container.innerHTML = '<div class="suggested-empty">Visit more pages to see suggestions</div>';
        return;
      }

      // Filter out current page and sort by view count (descending)
      const sorted = entries
        .filter(([url]) => url !== currentUrl)
        .sort((a, b) => {
          // Primary sort: view count (descending)
          const countDiff = b[1].count - a[1].count;
          if (countDiff !== 0) return countDiff;
          // Secondary sort: last visit (descending)
          return b[1].lastVisit - a[1].lastVisit;
        })
        .slice(0, MAX_SUGGESTIONS);

      if (sorted.length === 0) {
        container.innerHTML = '<div class="suggested-empty">Visit more pages to see suggestions</div>';
        return;
      }

      container.innerHTML = '';
      const ul = document.createElement('ul');
      ul.className = 'suggested-items';

      for (const [url, data] of sorted) {
        const li = document.createElement('li');
        li.className = 'suggested-item';
        
        const a = document.createElement('a');
        a.href = url;
        a.className = 'suggested-link';
        a.textContent = data.title || url;
        
        const meta = document.createElement('span');
        meta.className = 'suggested-meta';
        meta.textContent = `${data.count} view${data.count !== 1 ? 's' : ''}`;
        meta.title = `Last visited: ${new Date(data.lastVisit).toLocaleString()}`;
        
        li.appendChild(a);
        li.appendChild(meta);
        ul.appendChild(li);
      }

      container.appendChild(ul);
    } catch (e) {
      container.innerHTML = '<div class="suggested-empty">Unable to load suggestions</div>';
    }
  }
}

// Initialize widgets when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.widgetManager = new WidgetManager();
});
