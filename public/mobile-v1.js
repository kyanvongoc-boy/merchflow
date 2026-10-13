'use strict';

// Presentation only. No records, credentials, mail or browser storage are read.
// Load after studio.js; the existing render/actions functions remain authoritative.
(() => {
  const compact = window.matchMedia('(max-width: 900px)');
  const root = document.documentElement;
  const sidebar = document.getElementById('sidebar');
  const menu = document.getElementById('menuBtn');
  const main = document.querySelector('.app > main');
  if (!sidebar || !menu || !main) return;

  const label = (vi, en) => root.lang === 'en' ? en : vi;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'mf-drawer-close';
  close.textContent = '×';
  sidebar.prepend(close);
  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'mf-drawer-backdrop';
  backdrop.tabIndex = -1;
  backdrop.hidden = true;
  // The labelled close button is inside the focus trap.
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.append(backdrop);
  menu.setAttribute('aria-controls', 'sidebar');

  const hasDialog = () => !!document.querySelector('dialog[open]');
  const layouts = {compact: null, wide: null};
  let needsTaskRender = false;
  let drawerOpen = false;
  let frame = 0;

  function labels() {
    menu.setAttribute('aria-label', label('Mở menu điều hướng', 'Open navigation menu'));
    close.setAttribute('aria-label', label('Đóng menu điều hướng', 'Close navigation menu'));
    sidebar.setAttribute('aria-label', label('Điều hướng MerchFlow', 'MerchFlow navigation'));
  }

  function syncDrawer() {
    const open = compact.matches && sidebar.classList.contains('open');
    const entering = open && !drawerOpen;
    drawerOpen = open;
    sidebar.inert = compact.matches && !open;
    main.inert = open;
    backdrop.hidden = !open;
    menu.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('mf-drawer-open', open);
    if (open) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      if (entering && !hasDialog()) close.focus({preventScroll: true});
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
    }
  }

  function closeDrawer(restoreFocus = true) {
    sidebar.classList.remove('open');
    syncDrawer();
    if (restoreFocus && compact.matches && !hasDialog()) menu.focus({preventScroll: true});
  }

  close.addEventListener('click', () => closeDrawer());
  backdrop.addEventListener('click', () => closeDrawer());
  new MutationObserver(syncDrawer).observe(sidebar, {attributes: true, attributeFilter: ['class']});
  new MutationObserver(labels).observe(root, {attributes: true, attributeFilter: ['lang']});

  document.addEventListener('keydown', event => {
    if (!drawerOpen || hasDialog()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(sidebar.querySelectorAll('a[href],button:not([disabled]),[tabindex="0"]'))
      .filter(item => !item.hidden && item.getClientRects().length > 0);
    const first = items[0], last = items[items.length - 1];
    if (!first) return;
    if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });

  // Respect an explicit layout choice separately for phone/tablet and desktop.
  if (typeof studioLayout !== 'undefined') layouts.wide = studioLayout;
  if (typeof actions !== 'undefined' && typeof actions['studio-layout'] === 'function') {
    const chooseLayout = actions['studio-layout'];
    actions['studio-layout'] = function (key) {
      if (key === 'board' || key === 'list') layouts[compact.matches ? 'compact' : 'wide'] = key;
      return chooseLayout.call(this, key);
    };
  }

  function renderTasksIfSafe() {
    if (!needsTaskRender || hasDialog()) return;
    needsTaskRender = false;
    if (typeof state !== 'undefined' && state && typeof view !== 'undefined' && view === 'tasks' && typeof render === 'function') render();
  }

  function applyLayout() {
    if (typeof studioLayout === 'undefined') return;
    const next = layouts[compact.matches ? 'compact' : 'wide'] || (compact.matches ? 'list' : 'board');
    if (studioLayout !== next) {
      studioLayout = next;
      needsTaskRender = true;
      renderTasksIfSafe();
    }
  }

  function syncViewport() {
    frame = 0;
    const viewport = window.visualViewport;
    if (compact.matches && viewport && viewport.scale === 1) {
      root.style.setProperty('--mf-viewport-height', Math.round(viewport.height) + 'px');
      root.style.setProperty('--mf-viewport-top', Math.max(0, Math.round(viewport.offsetTop)) + 'px');
      const active = document.activeElement;
      if (hasDialog() && active?.matches('input,textarea,select') && active.closest('dialog[open]')) {
        active.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'auto'});
      }
    } else {
      // Native zoom owns the viewport while magnified; do not move content under it.
      root.style.removeProperty('--mf-viewport-height');
      root.style.removeProperty('--mf-viewport-top');
    }
  }

  function queueViewport() {
    if (!frame) frame = requestAnimationFrame(syncViewport);
  }

  compact.addEventListener('change', () => {
    if (!compact.matches) closeDrawer(false);
    syncDrawer();
    applyLayout();
    queueViewport();
  });
  document.addEventListener('close', renderTasksIfSafe, true);
  window.addEventListener('hashchange', () => {
    closeDrawer(false);
    // The workspace's normal hash handler renders the selected layout.
    needsTaskRender = false;
  });
  window.visualViewport?.addEventListener('resize', queueViewport);
  window.visualViewport?.addEventListener('scroll', queueViewport);
  window.addEventListener('resize', queueViewport);
  labels();
  syncDrawer();
  applyLayout();
  queueViewport();
})();
