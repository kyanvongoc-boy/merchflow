(function () {
  'use strict';
  if (window.MerchFlowInstall) return;
  let installPrompt = null;
  let registration = null;
  let installing = false;
  let confirmedInstalled = false;
  let reloadApproved = false;
  let updateDismissed = false;
  let updateBusy = false;
  let updateReady = false;
  let guideLanguage = null;
  let workerStatus = 'unavailable';
  const displayMode = window.matchMedia('(display-mode: standalone)');
  const guide = () => !!document.getElementById('install-guides');
  function language() {
    if (guideLanguage) return guideLanguage;
    try { return localStorage.getItem('merchflow-language') === 'en' ? 'en' : 'vi'; }
    catch { return document.documentElement.lang === 'en' ? 'en' : 'vi'; }
  }
  const text = (vi, en) => language() === 'en' ? en : vi;
  function isInstalled() { return confirmedInstalled || displayMode.matches || navigator.standalone === true; }
  function hasUnsavedChanges() {
    try {
      if (typeof window.merchflowHasUnsavedChanges === 'function') return !!window.merchflowHasUnsavedChanges();
      // The workspace can supply a stricter dirty-form guard; default to caution.
      return !!document.querySelector('dialog[open]');
    } catch { return true; }
  }
  function signal() {
    window.dispatchEvent(new CustomEvent('merchflow:install-state', { detail: { installed: isInstalled(), canPrompt: !!installPrompt, workerStatus } }));
  }
  function status(vi, en) {
    const node = document.getElementById('mf-install-status');
    if (node) { node.textContent = text(vi, en); node.hidden = false; }
  }
  function renderLanguage() {
    if (guide()) {
      document.documentElement.lang = language();
      document.title = text('MerchFlow · Cài ứng dụng', 'MerchFlow · Install');
      document.querySelectorAll('[data-install-lang]').forEach(node => { node.hidden = node.dataset.installLang !== language(); });
      const button = document.getElementById('mf-install-language');
      if (button) { button.textContent = language() === 'vi' ? 'EN' : 'VI'; button.setAttribute('aria-label', language() === 'vi' ? 'Switch to English' : 'Chuyển sang tiếng Việt'); }
    }
    if (isInstalled()) status('MerchFlow đã được cài. Bạn có thể tiếp tục vào Công việc.', 'MerchFlow is installed. Continue to Tasks whenever you are ready.');
    document.querySelectorAll('[data-merchflow-install]').forEach(button => {
      if (button.tagName === 'BUTTON') button.disabled = installing || isInstalled();
      button.setAttribute('aria-label', isInstalled() ? text('Đã mở dưới dạng ứng dụng', 'Already running as an app') : text('Cài MerchFlow hoặc xem hướng dẫn', 'Install MerchFlow or view the guide'));
    });
    renderUpdate();
  }
  function openGuide() {
    if (guide()) {
      const target = document.getElementById('install-guides');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: 'auto', block: 'start' });
    } else {
      // A separate tab keeps an unfinished workspace form intact.
      window.open('/install.html', '_blank', 'noopener,noreferrer');
    }
  }
  async function requestInstall(event) {
    if (installing || isInstalled()) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    if (!navigator.userActivation && !event?.isTrusted) return;
    if (!installPrompt) {
      status('Nếu chưa thấy hộp thoại cài, hãy dùng hướng dẫn bên dưới. Trình duyệt có thể chưa hỗ trợ nút cài hoặc ứng dụng đã được cài.', 'If no install dialog appears, follow the guide below. Your browser may not support this button, or the app may already be installed.');
      openGuide();
      return;
    }
    const prompt = installPrompt;
    installPrompt = null;
    installing = true;
    renderLanguage();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') {
        status('Đã chấp nhận yêu cầu cài. Hoàn tất các bước của trình duyệt rồi mở biểu tượng MerchFlow.', 'Installation was accepted. Finish your browser’s steps, then open the MerchFlow icon.');
      } else {
        status('Đã đóng yêu cầu cài. Bạn vẫn có thể dùng MerchFlow trong trình duyệt hoặc cài lại từ menu.', 'Installation was dismissed. Continue in your browser or install later from its menu.');
      }
    } catch {
      status('Chưa mở được hộp thoại cài. Hãy dùng menu trình duyệt theo hướng dẫn bên dưới.', 'The installation dialog could not open. Use the browser menu described below.');
    } finally { installing = false; renderLanguage(); signal(); }
  }
  function updatePanel() {
    let panel = document.getElementById('mf-install-update');
    if (panel) return panel;
    panel = document.createElement('aside');
    panel.id = 'mf-install-update';
    panel.className = 'mf-install-update';
    panel.setAttribute('aria-label', text('Cập nhật MerchFlow', 'MerchFlow update'));
    panel.innerHTML = '<p id="mf-install-update-title" role="status" aria-live="polite"></p><div class="mf-install-update-actions"><button type="button" class="mf-install-primary" id="mf-install-update-apply"></button><button type="button" id="mf-install-update-later"></button></div><p class="mf-install-update-note" id="mf-install-update-note" role="status" hidden></p>';
    document.body.appendChild(panel);
    panel.querySelector('#mf-install-update-apply').addEventListener('click', applyUpdate);
    panel.querySelector('#mf-install-update-later').addEventListener('click', () => { updateDismissed = true; panel.hidden = true; });
    return panel;
  }
  function renderUpdate() {
    if ((!registration?.waiting && !updateReady) || updateDismissed) return;
    const panel = updatePanel();
    panel.hidden = false;
    panel.setAttribute('aria-label', text('Cập nhật MerchFlow', 'MerchFlow update'));
    panel.querySelector('#mf-install-update-title').textContent = text('Có phiên bản MerchFlow mới. Tải lại khi bạn đã lưu công việc.', 'A MerchFlow update is ready. Reload after saving your work.');
    panel.querySelector('#mf-install-update-apply').textContent = updateBusy ? text('Đang cập nhật…', 'Updating…') : updateReady ? text('Tải lại ứng dụng', 'Reload app') : text('Cập nhật & tải lại', 'Update & reload');
    panel.querySelector('#mf-install-update-apply').disabled = updateBusy;
    panel.querySelector('#mf-install-update-later').textContent = text('Để sau', 'Later');
  }
  function updateNote(vi, en) {
    const note = updatePanel().querySelector('#mf-install-update-note');
    note.textContent = text(vi, en); note.hidden = false;
  }
  function applyUpdate() {
    if (hasUnsavedChanges()) {
      updateNote('Hãy lưu hoặc đóng biểu mẫu đang chỉnh sửa trước khi cập nhật.', 'Save or close the form you are editing before updating.');
      return;
    }
    if (updateReady) { location.reload(); return; }
    if (!registration?.waiting || updateBusy) return;
    reloadApproved = true;
    updateBusy = true;
    renderUpdate();
    registration.waiting.postMessage({ type: 'MERCHFLOW_APPLY_UPDATE' });
    window.setTimeout(() => {
      if (!reloadApproved) return;
      reloadApproved = false; updateBusy = false; renderUpdate();
      updateNote('Chưa xác nhận được cập nhật. Bạn có thể thử lại sau khi lưu công việc.', 'The update has not been confirmed. Try again after saving your work.');
    }, 12000);
  }
  async function checkForUpdate() {
    if (!registration) return false;
    try { await registration.update(); updateDismissed = false; renderUpdate(); return true; }
    catch { return false; }
  }
  async function registerWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      workerStatus = 'registered';
      renderUpdate();
      registration.addEventListener('updatefound', () => {
        const candidate = registration.installing;
        if (!candidate) return;
        candidate.addEventListener('statechange', () => {
          if (candidate.state === 'installed' && navigator.serviceWorker.controller) {
            updateDismissed = false; renderUpdate();
          }
        });
      });
    } catch { workerStatus = 'failed'; }
    signal();
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; renderLanguage(); signal();
  });
  window.addEventListener('appinstalled', () => {
    confirmedInstalled = true; installPrompt = null; renderLanguage(); signal();
  });
  displayMode.addEventListener?.('change', () => { renderLanguage(); signal(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadApproved) return;
    reloadApproved = false; updateBusy = false;
    if (hasUnsavedChanges()) {
      updateReady = true;
      renderUpdate();
      updateNote('Cập nhật đã sẵn sàng. Lưu công việc rồi tải lại trang khi thuận tiện.', 'The update is ready. Save your work, then reload when convenient.');
      return;
    }
    location.reload();
  });
  window.addEventListener('storage', event => { if (event.key === 'merchflow-language') { guideLanguage = null; renderLanguage(); } });
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-merchflow-install]');
    if (button) { event.preventDefault(); requestInstall(event); }
    if (event.target?.closest?.('#language')) window.setTimeout(renderLanguage, 0);
  });
  window.MerchFlowInstall = Object.freeze({ requestInstall, openGuide, isInstalled, checkForUpdate, getState: () => ({ installed: isInstalled(), canPrompt: !!installPrompt, workerStatus }) });
  function start() {
    document.getElementById('mf-install-language')?.addEventListener('click', () => {
      const next = language() === 'vi' ? 'en' : 'vi';
      guideLanguage = next;
      try { localStorage.setItem('merchflow-language', next); } catch { document.documentElement.lang = next; }
      const message = document.getElementById('mf-install-status'); if (message) message.hidden = true;
      renderLanguage();
    });
    const agent = navigator.userAgent || '';
    const platform = /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1) ? 'ios' : /Android/.test(agent) ? 'android' : /Mac/.test(agent) ? 'mac' : /Win/.test(agent) ? 'windows' : '';
    if (platform) document.querySelector('[data-platform="' + platform + '"]')?.classList.add('is-current');
    renderLanguage(); registerWorker();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
