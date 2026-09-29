// Content-change hook
//
// The template's scripts read the document once, on DOMContentLoaded: sticky.js
// collects the headings it will mark data-ursa-stuck, toc.js builds the table
// of contents from them. Anything that adds content to the document after that
// point — an island that fetches data and renders a list with its own headings —
// is invisible to them unless it says so.
//
// This is how it says so. A script that has changed the document calls
//
//     window.ursa.contentChanged(root)
//
// where `root` is the element whose contents changed (optional; defaults to the
// document, `.ursa-doc`). That dispatches `ursa:content-changed` on `document`,
// with the root in `event.detail.root`, and each template script that keeps a
// view of the document listens for it and re-reads what it needs. Calls made
// in the same task are coalesced into one event (a macrotask, not an animation
// frame, so it also fires in a background tab), so a component that renders in
// several steps can call it freely.
//
// Dispatching the event directly works just as well; the helper exists so a
// caller does not have to know the event's name.
(() => {
  const EVENT = 'ursa:content-changed';
  let queued = null;

  function contentChanged(root) {
    if (root && !(root instanceof Element)) root = null;
    // Coalesce: keep the broadest root seen so far
    if (queued) {
      if (queued.root && root && queued.root !== root && !queued.root.contains(root)) {
        queued.root = null;
      }
      return;
    }
    queued = { root: root || null };
    setTimeout(() => {
      const detail = { root: queued.root || document.querySelector('.ursa-doc') };
      queued = null;
      document.dispatchEvent(new CustomEvent(EVENT, { detail }));
    });
  }

  window.ursa = Object.assign(window.ursa || {}, { contentChanged, CONTENT_CHANGED_EVENT: EVENT });
})();
