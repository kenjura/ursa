/**
 * Widget system for the topbar toolbars.
 *
 * Widgets appear as icon buttons in the topbar. Each button controls one panel,
 * an `aside.ursa-panel` named by the same `data-widget` and pointed at by the
 * button's `aria-controls`. Panels hang from one edge of the page, given by
 * their `data-side` (start or end), and one widget can be open per side at a
 * time.
 *
 * Open and closed are said with `hidden` on the panel and `aria-expanded` on its
 * button — nothing else. Every panel is its own element, so CSS (Ursa's and a
 * site's) tells one widget's panel from another's by `.ursa-panel[data-widget]`.
 *
 * Widget state (open/closed) is persisted in localStorage so it survives page reloads.
 *
 * Built-in widgets:
 *   Start: Recent Activity (open by default), Suggested
 *   End: TOC (open by default, persistent), Search, Profile
 */
class WidgetManager {
  constructor() {
    this.buttons = document.querySelectorAll('.ursa-button[data-widget]');
    this.panels = new Map(); // widget name → aside.ursa-panel, filled by init()
    this.openBySide = { start: null, end: null };

    // Widgets that default to open on first visit. The TOC is here because it
    // is reference furniture rather than a tool you go and fetch: it belongs
    // beside the article the way page numbers belong on a page. It costs
    // nothing to leave up — the stylesheet gives it the right margin, and
    // takes it away again on a viewport with no margin to spare.
    this.defaultOpen = new Set(['recent-activity', 'toc']);

    // Widgets that are furniture rather than a drawer. Two things follow.
    //
    // A click elsewhere on the page does not dismiss them. Light dismissal is
    // right for something you pull open, glance at and are done with, but the
    // first half of following a link is a click on the page — so for a widget
    // meant to stay up it fired constantly, and, because dismissal is recorded,
    // it wrote down "the reader closed this" every time. One click on an
    // article and the TOC was off for good, on that page and every page after.
    // Escape is out for the same reason: it would be remembered.
    //
    // And they own their side of the page. Another widget opening there is
    // borrowing it, not replacing them — the loan is not recorded as a closure,
    // and they come back when it is handed back.
    //
    // Which leaves the toolbar button and the panel's own close button as the
    // only two things that decide whether a persistent widget is showing.
    // Those are unambiguous, and those are remembered.
    this.persistent = new Set(['toc']);

    if (this.buttons.length === 0) return;

    this.init();
  }

  /**
   * Get the side (start/end) for a widget from its panel's data-side attribute
   */
  getSide(widgetName) {
    return this.panels.get(widgetName)?.dataset.side === 'start' ? 'start' : 'end';
  }

  /**
   * Get the active widget name for a given side
   */
  getActive(side) {
    return this.openBySide[side] || null;
  }

  /**
   * Set the active widget name for a given side
   */
  setActive(side, widgetName) {
    this.openBySide[side] = widgetName;
  }

  /**
   * Point a widget's toolbar button(s) at the panel's state.
   */
  setExpanded(widgetName, isOpen) {
    this.buttons.forEach(btn => {
      if (btn.dataset.widget === widgetName) {
        btn.setAttribute('aria-expanded', String(isOpen));
      }
    });
  }

  init() {
    document.querySelectorAll('.ursa-panel[data-widget]').forEach(panel => {
      this.panels.set(panel.dataset.widget, panel);
    });

    // Everything starts closed; restoreState() below decides what opens. The
    // server markup already says so — this just makes sure the panels and
    // their buttons agree before anything reads either.
    for (const [widgetName, panel] of this.panels) {
      panel.hidden = true;
      this.setExpanded(widgetName, false);
    }

    // Bind button clicks
    this.buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const widgetName = btn.dataset.widget;
        this.toggle(widgetName);
      });
    });

    // Bind close buttons inside panel headers
    document.querySelectorAll('.ursa-panel .ursa-panel-close').forEach(closeBtn => {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = closeBtn.closest('.ursa-panel');
        if (panel) {
          this.closeWidget(panel.dataset.widget);
        }
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      for (const side of ['start', 'end']) {
        const active = this.getActive(side);
        if (!active || this.persistent.has(active)) continue;
        const panel = this.panels.get(active);
        if (panel && !panel.contains(e.target) &&
            !e.target.closest('.ursa-button[data-widget]')) {
          this.close(side);
        }
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        for (const side of ['start', 'end']) {
          const active = this.getActive(side);
          if (active && !this.persistent.has(active)) this.close(side);
        }
      }
    });

    // Initialize search widget content
    this.initSearchWidget();

    // Initialize recent activity widget
    this.initRecentActivityWidget();
    // `ursa serve` says recent activity changed: refetch in place
    document.addEventListener('ursa:data-updated', (e) => {
      if ((e.detail?.what || []).includes('recent-activity')) this.initRecentActivityWidget();
    });

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
   * Whether a widget should be showing, as far as the reader's own choices go:
   * what they last decided, or the default if they have not decided anything.
   */
  wantsToBeOpen(widgetName) {
    let saved;
    try {
      saved = localStorage.getItem(`ursa-widget-${widgetName}`);
    } catch (e) { /* localStorage not available */ }

    return saved === 'open' || (saved == null && this.defaultOpen.has(widgetName));
  }

  /**
   * The widget that owns a side of the page when nothing else is using it.
   */
  residentOf(side) {
    for (const widgetName of this.persistent) {
      if (this.panels.has(widgetName) && this.getSide(widgetName) === side) return widgetName;
    }
    return null;
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
      if (this.wantsToBeOpen(widgetName) && this.hasContent(widgetName)) {
        this.open(widgetName);
      }
    }
  }

  /**
   * Whether a widget has anything to show. A widget that has hidden its own
   * button has nothing — the TOC script does exactly that on a page with no
   * headings — and restoring it would put an empty panel on screen with no
   * button to shut it again. Only relevant on restore: a widget the reader
   * opens by hand plainly has a button to have clicked.
   */
  hasContent(widgetName) {
    const btn = document.querySelector(`.ursa-button[data-widget="${widgetName}"]`);
    return !btn || !btn.hidden;
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
   * Open a specific widget panel. Returns whether there was a panel to open.
   */
  open(widgetName) {
    const panel = this.panels.get(widgetName);
    if (!panel) return false;
    const side = this.getSide(widgetName);

    // Close any open widget on the same side first
    const currentActive = this.getActive(side);
    if (currentActive && currentActive !== widgetName) {
      this.deactivateContent(currentActive);
      // Save the closed widget's state — unless it is only lending its side out,
      // in which case it has not been closed and should not be written down as
      // closed. close() hands the side back when the borrower is done.
      if (!this.persistent.has(currentActive)) {
        this.saveState(currentActive, false);
      }
    }

    this.setActive(side, widgetName);

    // Show the panel and mark its button
    this.activateContent(widgetName);

    // Save state
    this.saveState(widgetName, true);

    // Fire event for other scripts to listen to
    document.dispatchEvent(new CustomEvent('widget-opened', { detail: { widget: widgetName, side } }));
    return true;
  }

  /**
   * Close a widget if it is the one open on its side.
   */
  closeWidget(widgetName) {
    if (!this.panels.has(widgetName)) return;
    const side = this.getSide(widgetName);
    if (this.getActive(side) === widgetName) this.close(side);
  }

  /**
   * Close the currently open widget on a given side.
   */
  close(side) {
    const active = this.getActive(side);
    if (!active) return;

    this.deactivateContent(active);

    // Save state
    this.saveState(active, false);

    this.setActive(side, null);

    // Fire event
    document.dispatchEvent(new CustomEvent('widget-closed', { detail: { widget: active, side } }));

    // Give the side back to its resident, if it has one and the reader has not
    // put it away themselves. Guarded against the resident being the very thing
    // just closed — otherwise closing the TOC would reopen it. (It cannot
    // recurse either way: the side is already empty by this point, so the open()
    // below finds nothing to displace.)
    const resident = this.residentOf(side);
    if (resident && resident !== active &&
        this.wantsToBeOpen(resident) && this.hasContent(resident)) {
      this.open(resident);
    }
  }

  /**
   * Show a widget's panel.
   */
  activateContent(widgetName) {
    const panel = this.panels.get(widgetName);
    if (!panel) return;

    panel.hidden = false;
    this.setExpanded(widgetName, true);

    // Widget-specific activation
    if (widgetName === 'search') {
      this.activateSearch();
    }
  }

  /**
   * Hide a widget's panel.
   */
  deactivateContent(widgetName) {
    const panel = this.panels.get(widgetName);
    if (!panel) return;

    panel.hidden = true;
    this.setExpanded(widgetName, false);

    // Widget-specific deactivation
    if (widgetName === 'search') {
      this.deactivateSearch();
    }
  }

  /**
   * Replace a panel's body — everything below its header — with the given
   * nodes.
   */
  setPanelBody(panel, ...nodes) {
    for (const child of [...panel.children]) {
      if (!child.classList.contains('ursa-panel-header')) child.remove();
    }
    panel.append(...nodes);
  }

  /**
   * A loading / empty / error line for a panel body.
   */
  panelMessage(text) {
    const p = document.createElement('p');
    p.className = 'ursa-panel-message';
    p.textContent = text;
    return p;
  }

  /**
   * Initialize search widget — render the panel placement of the search
   * component and hand it to search.js, which drives both placements the same
   * way. Whichever script runs first, the box ends up attached exactly once:
   * search.js attaches every `.ursa-search` present when it starts, and
   * attach() ignores one it already has.
   */
  initSearchWidget() {
    const panel = this.panels.get('search');
    if (!panel) return;

    let search = panel.querySelector('.ursa-search');
    if (!search) {
      search = document.createElement('search');
      search.className = 'ursa-search';
      search.dataset.placement = 'panel';
      search.innerHTML = `
        <input class="ursa-search-input" type="search" placeholder="Search…"
               aria-label="Search this site" autocomplete="off"
               role="combobox" aria-expanded="false" aria-controls="ursa-panel-search-results">
        <button class="ursa-button ursa-search-clear" type="button" aria-label="Clear search" hidden>×</button>
        <div class="ursa-search-results" id="ursa-panel-search-results" role="listbox"
             aria-label="Search results" hidden></div>`;
      this.setPanelBody(panel, search);
    }
    this._searchInput = search.querySelector('.ursa-search-input');

    window.globalSearch?.attach(search);
  }

  /**
   * Called when the search widget is activated.
   */
  activateSearch() {
    const input = this._searchInput;
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
    const panel = this.panels.get('recent-activity');
    if (!panel) return;

    this.setPanelBody(panel, this.panelMessage('Loading...'));

    fetch('/public/recent-activity.json')
      .then(res => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(items => {
        if (!items || items.length === 0) {
          this.setPanelBody(panel, this.panelMessage('No recent activity'));
          return;
        }
        const ul = document.createElement('ul');
        ul.className = 'ursa-linklist';
        for (const item of items) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = item.url;
          a.textContent = item.title || 'Untitled';
          const time = document.createElement('time');
          time.className = 'ursa-linklist-meta';
          const date = new Date(item.mtime);
          if (!Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
          time.textContent = this.formatRelativeTime(item.mtime);
          time.title = date.toLocaleString();
          li.appendChild(a);
          li.appendChild(time);
          ul.appendChild(li);
        }
        this.setPanelBody(panel, ul);
      })
      .catch(() => {
        this.setPanelBody(panel, this.panelMessage('Recent activity unavailable'));
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
    const panel = this.panels.get('suggested');
    if (!panel) return;

    const STORAGE_KEY = 'ursa-page-views';
    const MAX_SUGGESTIONS = 10;
    const currentUrl = window.location.pathname;
    const empty = () => this.setPanelBody(panel, this.panelMessage('Visit more pages to see suggestions'));

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        empty();
        return;
      }

      const pageViews = JSON.parse(stored);
      const entries = Object.entries(pageViews);

      if (entries.length === 0) {
        empty();
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
        empty();
        return;
      }

      const ul = document.createElement('ul');
      ul.className = 'ursa-linklist';

      for (const [url, data] of sorted) {
        const li = document.createElement('li');

        const a = document.createElement('a');
        a.href = url;
        a.textContent = data.title || url;

        const meta = document.createElement('span');
        meta.className = 'ursa-linklist-meta';
        meta.textContent = `${data.count} view${data.count !== 1 ? 's' : ''}`;
        meta.title = `Last visited: ${new Date(data.lastVisit).toLocaleString()}`;

        li.appendChild(a);
        li.appendChild(meta);
        ul.appendChild(li);
      }

      this.setPanelBody(panel, ul);
    } catch (e) {
      this.setPanelBody(panel, this.panelMessage('Unable to load suggestions'));
    }
  }
}

// Initialize widgets when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.widgetManager = new WidgetManager();
});
