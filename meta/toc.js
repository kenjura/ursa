(() => {
  const toc = document.getElementById('toc');
  if (!toc) return;

  const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
  const heads = links
    .map(a => document.getElementById(decodeURIComponent(a.hash.slice(1))))
    .filter(Boolean);

  const linkById = new Map(links.map(a => [decodeURIComponent(a.hash.slice(1)), a]));

  // === sticky top detector ===
  let STICKY_TOP = 48; // fallback
  const nav = document.getElementById('nav-global');

  function readStickyTop() {
    const b = nav?.getBoundingClientRect();
    // if nav is fixed at top, its bottom is the sticky line
    STICKY_TOP = b ? Math.max(0, Math.round(b.bottom)) : 48;
  }

  readStickyTop();
  window.addEventListener('resize', readStickyTop, { passive: true });
  if (nav && 'ResizeObserver' in window) {
    new ResizeObserver(readStickyTop).observe(nav);
  }

  // === build 1px sentinels just above each heading ===
  function ensureSentinels() {
    heads.forEach(h => {
      if (h.previousElementSibling?.classList.contains('toc-sentinel')) return;
      const s = document.createElement('div');
      s.className = 'toc-sentinel';
      s.style.position = 'relative';
      s.style.height = '1px';
      s.style.marginTop = `-${STICKY_TOP}px`; // place sentinel STICKY_TOP above h
      s.style.pointerEvents = 'none';
      s.dataset.forId = h.id;
      h.before(s);
    });
  }

  // === observer factory tied to current STICKY_TOP ===
  let observer = null;
  function (re)buildObserver() {
    if (observer) observer.disconnect();
    // ignore intersections near the bottom; we only care about the top line
    const bottomRM = -(window.innerHeight - 1) + 'px';
    observer = new IntersectionObserver(updateActiveFromSentinels, {
      root: null,
      rootMargin: `-${STICKY_TOP}px 0px ${bottomRM} 0px`,
      threshold: 0
    });
    document.querySelectorAll('.toc-sentinel').forEach(s => observer.observe(s));
  }

  function updateActiveFromSentinels() {
    // Pick the last sentinel whose top is <= 0 relative to the adjusted rootMargin,
    // i.e. the heading whose sticky line has been crossed.
    const sentinels = Array.from(document.querySelectorAll('.toc-sentinel'));
    let candidate = null;
    for (const s of sentinels) {
      const top = s.getBoundingClientRect().top - STICKY_TOP; // compare to sticky line
      if (top <= 0) candidate = s; else break;
    }
    const activeId = candidate ? candidate.dataset.forId : heads[0]?.id;
    links.forEach(a => a.classList.toggle('active', decodeURIComponent(a.hash.slice(1)) === activeId));
  }

  // keep anchor jumps clear of the sticky bar
  heads.forEach(h => h.style.scrollMarginTop = (STICKY_TOP + 8) + 'px');

  // initial setup
  ensureSentinels();
  (re)buildObserver();
  updateActiveFromSentinels();

  // react when sticky top changes
  let resizeTick = false;
  window.addEventListener('resize', () => {
    if (resizeTick) return;
    resizeTick = true;
    requestAnimationFrame(() => {
      resizeTick = false;
      readStickyTop();
      // update sentinel offsets
      document.querySelectorAll('.toc-sentinel').forEach(s => s.style.marginTop = `-${STICKY_TOP}px`);
      heads.forEach(h => h.style.scrollMarginTop = (STICKY_TOP + 8) + 'px');
      (re)buildObserver();
      updateActiveFromSentinels();
    });
  }, { passive: true });
})();
