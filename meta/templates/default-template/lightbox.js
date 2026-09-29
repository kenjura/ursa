/**
 * Image lightbox.
 *
 * Wraps every document image in span.ursa-image-frame with a view and a
 * download action shown on hover, and puts a full-screen viewer — a modal
 * <dialog class="ursa-lightbox"> — behind the view action.
 *
 * Document images are served as downscaled WebP previews (see
 * helper/imageProcessor.js), wrapped in <a class="ursa-image-link" href="original">.
 * The viewer therefore loads the anchor's href, not the img's own src — the
 * preview is only used as an instant placeholder while the original arrives.
 */
(() => {
  // Rendered smaller than this in either axis and it is an icon, not a picture.
  const MIN_RENDERED_SIZE = 80;
  const ZOOM_STEP = 1.5;
  const IMAGE_HREF = /\.(jpe?g|png|gif|webp|svg|avif|bmp|ico)(?:[?#]|$)/i;

  const ICON_VIEW =
    '<svg class="ursa-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M4 8v-2a2 2 0 0 1 2 -2h2" /><path d="M4 16v2a2 2 0 0 0 2 2h2" />' +
    '<path d="M16 4h2a2 2 0 0 1 2 2v2" /><path d="M16 20h2a2 2 0 0 0 2 -2v-2" /></svg>';
  const ICON_DOWNLOAD =
    '<svg class="ursa-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M12 3.5v11" /><path d="M7.5 10.5 12 15l4.5-4.5" />' +
    '<path d="M4.5 18.5h15" /></svg>';
  const ICON_CLOSE =
    '<svg class="ursa-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13" /></svg>';

  let viewer = null; // built on first use

  /** Filename to offer the download as, taken from the URL. */
  function fileNameFor(url) {
    try {
      const name = new URL(url, window.location.href).pathname.split('/').pop();
      return decodeURIComponent(name) || 'image';
    } catch {
      return 'image';
    }
  }

  /** Same file, ignoring cache-busting query strings? */
  function samePath(a, b) {
    try {
      const ua = new URL(a, window.location.href);
      const ub = new URL(b, window.location.href);
      return ua.origin === ub.origin && ua.pathname === ub.pathname;
    } catch {
      return a === b;
    }
  }

  /** The full-resolution URL for a document image. */
  function fullSizeUrl(img) {
    const link = img.closest('a');
    const href = link && link.getAttribute('href');
    if (link && href && (link.classList.contains('ursa-image-link') || IMAGE_HREF.test(href))) {
      return link.href;
    }
    return img.currentSrc || img.src;
  }

  function runWhenSized(img, fn) {
    if (img.complete && img.naturalWidth) fn();
    else img.addEventListener('load', fn, { once: true });
  }

  // --- image actions --------------------------------------------------------

  function buildActions(img, url) {
    const bar = document.createElement('span');
    bar.className = 'ursa-image-actions';

    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'ursa-image-action';
    view.dataset.action = 'view';
    view.title = 'View full size';
    view.setAttribute('aria-label', 'View full size');
    view.innerHTML = ICON_VIEW;
    view.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      open(img, url, view);
    });

    // A link rather than a button: download is what an <a download> does.
    const download = document.createElement('a');
    download.className = 'ursa-image-action';
    download.dataset.action = 'download';
    download.href = url;
    download.download = fileNameFor(url);
    download.title = 'Download image';
    download.setAttribute('aria-label', 'Download image');
    download.innerHTML = ICON_DOWNLOAD;
    // Stop the click reaching an enclosing <a class="ursa-image-link">.
    download.addEventListener('click', (e) => e.stopPropagation());

    bar.appendChild(view);
    bar.appendChild(download);
    return bar;
  }

  function decorate(img) {
    if (img.dataset.ursaLightbox) return;
    if (img.closest('[data-no-lightbox]')) return;
    // Ursa's CSS does not reach inside .ursa-unstyled, so actions injected
    // there would render unstyled.  Leave those images alone entirely.
    if (img.closest('.ursa-unstyled')) return;

    const url = fullSizeUrl(img);
    if (!url) return;

    runWhenSized(img, () => {
      const rect = img.getBoundingClientRect();
      // Fall back to the intrinsic size for images that are not laid out yet.
      const w = rect.width || img.naturalWidth;
      const h = rect.height || img.naturalHeight;
      if (Math.min(w, h) < MIN_RENDERED_SIZE) return;
      if (img.dataset.ursaLightbox) return;
      img.dataset.ursaLightbox = 'on';

      // Wrap the anchor rather than the image when there is one, so the
      // actions sit outside it and their clicks are not swallowed by the link.
      const link = img.closest('a.ursa-image-link');
      const wrapped = link && link.parentNode ? link : img;
      const frame = document.createElement('span');
      frame.className = 'ursa-image-frame';
      wrapped.parentNode.insertBefore(frame, wrapped);
      frame.appendChild(wrapped);
      frame.appendChild(buildActions(img, url));
    });
  }

  // --- viewer ---------------------------------------------------------------

  function ensureViewer() {
    if (viewer) return viewer;

    // showModal() puts it in the top layer with a ::backdrop, makes the page
    // behind it inert (so focus stays inside), and turns Escape into a
    // `cancel` event; close() hands focus back to whatever opened it.
    const el = document.createElement('dialog');
    el.className = 'ursa-lightbox';
    el.setAttribute('aria-label', 'Image viewer');
    el.innerHTML =
      '<div class="ursa-lightbox-stage" tabindex="-1">' +
        '<img class="ursa-lightbox-image" alt="">' +
      '</div>' +
      '<div class="ursa-lightbox-loading" hidden><span class="ursa-spinner"></span></div>' +
      '<div class="ursa-lightbox-toolbar">' +
        '<span class="ursa-lightbox-zoom" hidden>' +
          '<button type="button" class="ursa-lightbox-button" data-action="zoom-out" title="Zoom out" aria-label="Zoom out">&minus;</button>' +
          '<output class="ursa-lightbox-level">100%</output>' +
          '<button type="button" class="ursa-lightbox-button" data-action="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>' +
        '</span>' +
        '<a class="ursa-lightbox-button" data-action="download" download title="Download image" aria-label="Download image">' + ICON_DOWNLOAD + '</a>' +
      '</div>' +
      '<button type="button" class="ursa-lightbox-button" data-action="close" title="Close (Esc)" aria-label="Close">' + ICON_CLOSE + '</button>';
    // A direct child of the root, which is what the stylesheet's scroll lock
    // (.ursa:has(> .ursa-lightbox[open])) looks for.
    document.body.appendChild(el);

    viewer = {
      el,
      stage: el.querySelector('.ursa-lightbox-stage'),
      img: el.querySelector('.ursa-lightbox-image'),
      loading: el.querySelector('.ursa-lightbox-loading'),
      zoomGroup: el.querySelector('.ursa-lightbox-zoom'),
      level: el.querySelector('.ursa-lightbox-level'),
      zoomIn: el.querySelector('[data-action="zoom-in"]'),
      zoomOut: el.querySelector('[data-action="zoom-out"]'),
      download: el.querySelector('[data-action="download"]'),
      natural: { w: 0, h: 0 },
      scale: 1,
      fitScale: 1,
      ready: false,
      zoomable: false,
      atFit: true,
      lastFocus: null,
      token: 0,
      dragged: false,
    };

    el.querySelector('[data-action="close"]').addEventListener('click', close);
    // The dialog fills the viewport, so its own ::backdrop is never clicked;
    // the letterbox area around the image is the backdrop in effect, and
    // closes. A drag that ends there does not.
    el.addEventListener('click', (e) => {
      if ((e.target === viewer.stage || e.target === el) && !viewer.dragged) close();
    });
    viewer.zoomIn.addEventListener('click', () => zoomBy(ZOOM_STEP));
    viewer.zoomOut.addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
    viewer.img.addEventListener('dblclick', () => {
      if (!viewer.zoomable) return;
      zoomTo(viewer.atFit ? 1 : viewer.fitScale);
    });
    el.addEventListener('keydown', onKeydown);
    // Escape: let the browser close the dialog, and tidy up on `close`, which
    // fires however it was closed.
    el.addEventListener('close', onClosed);

    enablePanning(viewer.stage);
    window.addEventListener('resize', () => {
      if (el.open && viewer.ready) relayout();
    });

    return viewer;
  }

  /** Drag anywhere on the stage to pan a zoomed-in image. */
  function enablePanning(stage) {
    let panning = false;
    let start = null;

    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // Cleared on every press, not just pannable ones: a stale flag from an
      // earlier pan would otherwise swallow the next click-to-close.
      viewer.dragged = false;
      if (stage.scrollWidth <= stage.clientWidth && stage.scrollHeight <= stage.clientHeight) return;
      panning = true;
      start = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
      stage.setPointerCapture(e.pointerId);
      stage.dataset.panning = '';
    });

    stage.addEventListener('pointermove', (e) => {
      if (!panning) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) viewer.dragged = true;
      stage.scrollLeft = start.left - dx;
      stage.scrollTop = start.top - dy;
    });

    const end = (e) => {
      if (!panning) return;
      panning = false;
      delete stage.dataset.panning;
      try { stage.releasePointerCapture(e.pointerId); } catch {}
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  /**
   * Run a layout pass now and again on the next frame. A dialog that has just
   * been opened can still report a flex-unresolved stage width in the same
   * task, which would size the image to nothing.
   */
  function layoutTwice(fn) {
    fn();
    requestAnimationFrame(fn);
  }

  /** Space available for the image, inside the stage's padding. */
  function stageSize() {
    const style = getComputedStyle(viewer.stage);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    return {
      w: Math.max(1, viewer.stage.clientWidth - padX),
      h: Math.max(1, viewer.stage.clientHeight - padY),
    };
  }

  function containScale(w, h) {
    const stage = stageSize();
    return Math.min(stage.w / w, stage.h / h);
  }

  function applyScale(scale) {
    viewer.scale = scale;
    viewer.img.style.width = Math.round(viewer.natural.w * scale) + 'px';
    viewer.img.style.height = Math.round(viewer.natural.h * scale) + 'px';
    viewer.atFit = Math.abs(scale - viewer.fitScale) < 0.001;
    updateZoomControls();
  }

  function updateZoomControls() {
    viewer.zoomGroup.hidden = !viewer.zoomable;
    viewer.level.textContent = Math.round(viewer.scale * 100) + '%';
    viewer.zoomIn.disabled = viewer.scale >= 1 - 0.001;
    viewer.zoomOut.disabled = viewer.scale <= viewer.fitScale + 0.001;
    viewer.stage.toggleAttribute('data-pannable', viewer.scale > viewer.fitScale + 0.001);
  }

  /** Zoom, keeping whatever is at the centre of the stage at the centre. */
  function zoomTo(next) {
    const stage = viewer.stage;
    const clamped = Math.min(1, Math.max(viewer.fitScale, next));
    if (Math.abs(clamped - viewer.scale) < 0.001) return;

    const before = viewer.img.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const centreX = stageRect.left + stageRect.width / 2;
    const centreY = stageRect.top + stageRect.height / 2;
    const pointX = (centreX - before.left) / viewer.scale;
    const pointY = (centreY - before.top) / viewer.scale;

    applyScale(clamped);

    const after = viewer.img.getBoundingClientRect();
    stage.scrollLeft += after.left + pointX * clamped - centreX;
    stage.scrollTop += after.top + pointY * clamped - centreY;
  }

  function zoomBy(factor) {
    if (!viewer.ready || !viewer.zoomable) return;
    zoomTo(viewer.scale * factor);
  }

  /** Fit the loaded original: native resolution if it fits, contained if not. */
  function relayout() {
    const wasAtFit = viewer.atFit;
    viewer.fitScale = containScale(viewer.natural.w, viewer.natural.h);
    // Zoom controls are only meaningful while there is unseen resolution left.
    viewer.zoomable = viewer.fitScale < 1 - 0.001;
    const target = wasAtFit
      ? Math.min(1, viewer.fitScale)
      : Math.min(1, Math.max(viewer.fitScale, viewer.scale));
    applyScale(target);
    viewer.atFit = Math.abs(target - Math.min(1, viewer.fitScale)) < 0.001;
  }

  function open(img, url, opener) {
    const v = ensureViewer();
    const token = ++v.token;

    v.lastFocus = opener || document.activeElement;
    v.img.alt = img.alt || '';
    v.download.href = url;
    v.download.download = fileNameFor(url);
    v.ready = false;
    v.zoomable = false;
    v.zoomGroup.hidden = true;
    v.stage.scrollTop = 0;
    v.stage.scrollLeft = 0;

    // Open first: the stage cannot be measured while the dialog is closed.
    v.img.toggleAttribute('data-placeholder', true);
    v.img.removeAttribute('style');
    v.loading.hidden = false;
    if (!v.el.open) v.el.showModal();
    v.stage.focus({ preventScroll: true });

    // Show the already-loaded preview stretched to fill the stage, so there is
    // something on screen while the (potentially large) original downloads.
    const placeholder = img.currentSrc || img.src;
    if (placeholder && !samePath(placeholder, url) && img.naturalWidth) {
      v.img.src = placeholder;
      v.natural = { w: img.naturalWidth, h: img.naturalHeight };
      layoutTwice(() => {
        if (token !== v.token || v.ready) return; // superseded by the original
        v.fitScale = containScale(v.natural.w, v.natural.h);
        applyScale(v.fitScale);
      });
    }

    const full = new Image();
    full.onload = () => {
      if (token !== v.token) return; // a later image won the race
      v.img.removeAttribute('data-placeholder');
      v.loading.hidden = true;
      v.img.src = url;
      v.natural = { w: full.naturalWidth, h: full.naturalHeight };
      v.ready = true;
      v.atFit = true;
      layoutTwice(() => {
        if (token !== v.token) return;
        relayout();
      });
    };
    full.onerror = () => {
      if (token !== v.token) return;
      v.loading.hidden = true;
    };
    full.src = url;
  }

  function close() {
    if (viewer && viewer.el.open) viewer.el.close();
  }

  function onClosed() {
    viewer.token++; // abandon any in-flight load
    viewer.img.removeAttribute('src');
    viewer.loading.hidden = true;
    delete viewer.stage.dataset.panning;
    // The browser restores focus on close too, but to whatever was focused
    // when showModal() ran; the opener is the right place even if that was not.
    if (viewer.lastFocus && viewer.lastFocus.isConnected && viewer.lastFocus.focus) {
      viewer.lastFocus.focus();
    }
  }

  function onKeydown(e) {
    if (e.key === '+' || e.key === '=') {
      zoomBy(ZOOM_STEP);
    } else if (e.key === '-' || e.key === '_') {
      zoomBy(1 / ZOOM_STEP);
    }
  }

  // --- init -----------------------------------------------------------------

  function init() {
    const doc = document.querySelector('.ursa-doc');
    if (!doc) return;
    doc.querySelectorAll('img').forEach(decorate);
    // Build the dialog up front so the first open measures a laid-out stage.
    ensureViewer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
