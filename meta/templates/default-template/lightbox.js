/**
 * Image lightbox.
 *
 * Adds a zoom and a download button to every article image on hover, and a
 * full-screen viewer behind the zoom button.
 *
 * Article images are served as downscaled WebP previews (see
 * helper/imageProcessor.js), wrapped in <a class="image-link" href="original">.
 * The viewer therefore loads the anchor's href, not the img's own src — the
 * preview is only used as an instant placeholder while the original arrives.
 */
(() => {
  // Rendered smaller than this in either axis and it is an icon, not a picture.
  const MIN_RENDERED_SIZE = 80;
  const ZOOM_STEP = 1.5;
  const IMAGE_HREF = /\.(jpe?g|png|gif|webp|svg|avif|bmp|ico)(?:[?#]|$)/i;

  const ICON_ZOOM =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 L21 21" />' +
    '<path d="M7.5 10.5h6M10.5 7.5v6" /></svg>';
  const ICON_DOWNLOAD =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M12 3.5v11" /><path d="M7.5 10.5 12 15l4.5-4.5" />' +
    '<path d="M4.5 18.5h15" /></svg>';
  const ICON_CLOSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
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

  /** The full-resolution URL for an article image. */
  function fullSizeUrl(img) {
    const link = img.closest('a');
    const href = link && link.getAttribute('href');
    if (link && href && (link.classList.contains('image-link') || IMAGE_HREF.test(href))) {
      return link.href;
    }
    return img.currentSrc || img.src;
  }

  function runWhenSized(img, fn) {
    if (img.complete && img.naturalWidth) fn();
    else img.addEventListener('load', fn, { once: true });
  }

  // --- hover controls -------------------------------------------------------

  function buildControls(img, url) {
    const bar = document.createElement('span');
    bar.className = 'ursa-image-controls';

    const zoom = document.createElement('button');
    zoom.type = 'button';
    zoom.className = 'ursa-image-btn';
    zoom.title = 'View full size';
    zoom.setAttribute('aria-label', 'View full size');
    zoom.innerHTML = ICON_ZOOM;
    zoom.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      open(img, url);
    });

    const download = document.createElement('a');
    download.className = 'ursa-image-btn';
    download.href = url;
    download.download = fileNameFor(url);
    download.title = 'Download image';
    download.setAttribute('aria-label', 'Download image');
    download.innerHTML = ICON_DOWNLOAD;
    // Stop the click reaching an enclosing <a class="image-link">.
    download.addEventListener('click', (e) => e.stopPropagation());

    bar.appendChild(zoom);
    bar.appendChild(download);
    return bar;
  }

  function decorate(img) {
    if (img.dataset.ursaLightbox) return;
    if (img.closest('[data-no-lightbox]')) return;

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
      // controls sit outside it and their clicks are not swallowed by the link.
      const link = img.closest('a.image-link');
      const wrapped = link && link.parentNode ? link : img;
      const frame = document.createElement('span');
      frame.className = 'ursa-image-frame';
      wrapped.parentNode.insertBefore(frame, wrapped);
      frame.appendChild(wrapped);
      frame.appendChild(buildControls(img, url));
    });
  }

  // --- viewer ---------------------------------------------------------------

  function ensureViewer() {
    if (viewer) return viewer;

    const el = document.createElement('div');
    el.className = 'ursa-lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Image viewer');
    el.hidden = true;
    el.innerHTML =
      '<div class="ursa-lightbox-backdrop"></div>' +
      '<div class="ursa-lightbox-stage" tabindex="-1">' +
        '<img class="ursa-lightbox-image" alt="">' +
      '</div>' +
      '<div class="ursa-lightbox-loading" hidden><span class="ursa-spinner"></span></div>' +
      '<div class="ursa-lightbox-toolbar">' +
        '<span class="ursa-lightbox-zoom" hidden>' +
          '<button type="button" class="ursa-lightbox-btn" data-zoom="out" title="Zoom out" aria-label="Zoom out">&minus;</button>' +
          '<span class="ursa-lightbox-level">100%</span>' +
          '<button type="button" class="ursa-lightbox-btn" data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>' +
        '</span>' +
        '<a class="ursa-lightbox-btn ursa-lightbox-download" download title="Download image" aria-label="Download image">' + ICON_DOWNLOAD + '</a>' +
      '</div>' +
      '<button type="button" class="ursa-lightbox-close" title="Close (Esc)" aria-label="Close">' + ICON_CLOSE + '</button>';
    document.body.appendChild(el);

    viewer = {
      el,
      stage: el.querySelector('.ursa-lightbox-stage'),
      img: el.querySelector('.ursa-lightbox-image'),
      loading: el.querySelector('.ursa-lightbox-loading'),
      zoomGroup: el.querySelector('.ursa-lightbox-zoom'),
      level: el.querySelector('.ursa-lightbox-level'),
      zoomIn: el.querySelector('[data-zoom="in"]'),
      zoomOut: el.querySelector('[data-zoom="out"]'),
      download: el.querySelector('.ursa-lightbox-download'),
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

    el.querySelector('.ursa-lightbox-backdrop').addEventListener('click', close);
    el.querySelector('.ursa-lightbox-close').addEventListener('click', close);
    // Letterbox area around the image closes too; a drag that ends there does not.
    viewer.stage.addEventListener('click', (e) => {
      if (e.target === viewer.stage && !viewer.dragged) close();
    });
    viewer.zoomIn.addEventListener('click', () => zoomBy(ZOOM_STEP));
    viewer.zoomOut.addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
    viewer.img.addEventListener('dblclick', () => {
      if (!viewer.zoomable) return;
      zoomTo(viewer.atFit ? 1 : viewer.fitScale);
    });

    enablePanning(viewer.stage);
    window.addEventListener('resize', () => {
      if (!el.hidden && viewer.ready) relayout();
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
      stage.classList.add('is-panning');
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
      stage.classList.remove('is-panning');
      try { stage.releasePointerCapture(e.pointerId); } catch {}
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  /**
   * Run a layout pass now and again on the next frame. A dialog that has just
   * been unhidden can still report a flex-unresolved stage width in the same
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
    viewer.stage.classList.toggle('is-pannable', viewer.scale > viewer.fitScale + 0.001);
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

  function open(img, url) {
    const v = ensureViewer();
    const token = ++v.token;

    v.lastFocus = document.activeElement;
    v.img.alt = img.alt || '';
    v.download.href = url;
    v.download.download = fileNameFor(url);
    v.ready = false;
    v.zoomable = false;
    v.zoomGroup.hidden = true;
    v.stage.scrollTop = 0;
    v.stage.scrollLeft = 0;

    // Reveal first: the stage cannot be measured while the dialog is hidden.
    v.img.classList.add('is-placeholder');
    v.img.removeAttribute('style');
    v.loading.hidden = false;
    v.el.hidden = false;
    document.body.classList.add('ursa-lightbox-open');
    document.addEventListener('keydown', onKeydown);
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
      v.img.classList.remove('is-placeholder');
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
    if (!viewer || viewer.el.hidden) return;
    viewer.token++; // abandon any in-flight load
    viewer.el.hidden = true;
    viewer.img.removeAttribute('src');
    viewer.loading.hidden = true;
    document.body.classList.remove('ursa-lightbox-open');
    document.removeEventListener('keydown', onKeydown);
    if (viewer.lastFocus && viewer.lastFocus.focus) viewer.lastFocus.focus();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === '+' || e.key === '=') {
      zoomBy(ZOOM_STEP);
    } else if (e.key === '-' || e.key === '_') {
      zoomBy(1 / ZOOM_STEP);
    } else if (e.key === 'Tab') {
      trapFocus(e);
    }
  }

  /** Keep Tab inside the dialog while it is open. */
  function trapFocus(e) {
    const focusable = Array.from(viewer.el.querySelectorAll('button, a[href]'))
      .filter((el) => !el.disabled && el.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    // Anywhere but a control of the dialog — the stage, or the page behind it.
    if (focusable.indexOf(active) === -1) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // --- init -----------------------------------------------------------------

  function init() {
    const article = document.querySelector('article#main-content');
    if (!article) return;
    article.querySelectorAll('img').forEach(decorate);
    // Build the dialog up front so the first open measures a laid-out stage.
    ensureViewer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
