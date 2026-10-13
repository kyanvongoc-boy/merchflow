'use strict';
// Only preferences are stored on this device. Form contents stay in memory.
(() => {
  const modal = document.querySelector('#modal');
  const nativeClose = modal.close.bind(modal);
  let baseline = '', trackedForm = null, saving = false, lastSync = null, syncFailed = false;
  const phrase = (vi, en) => typeof t === 'function' ? t(vi, en) : vi;
  const snapshot = form => JSON.stringify(Array.from(form?.querySelectorAll('input,select,textarea') || [])
    .filter(el => !el.matches('[data-evidence-search]'))
    .map(el => [el.name || el.id || el.dataset.cell || el.dataset.qkey || '', el.type,
      el.tagName === 'SELECT' ? Array.from(el.selectedOptions).map(o => o.value) : el.value,
      ['checkbox','radio'].includes(el.type) ? el.checked : null]));
  window.merchflowHasUnsavedChanges = () => saving || !!(modal.open && trackedForm?.isConnected && snapshot(trackedForm) !== baseline);
  let confirmation = null;
  window.merchflowConfirm = message => {
    if (confirmation) return Promise.resolve(false);
    return new Promise(resolve => {
      const prompt = document.createElement('dialog');
      prompt.className = 'mf-confirm';
      prompt.setAttribute('aria-labelledby','mf-confirm-title');
      prompt.innerHTML = '<h2 id="mf-confirm-title"></h2><p></p><div class="buttons"><button type="button" class="btn" data-confirm-cancel></button><button type="button" class="btn primary" data-confirm-discard></button></div>';
      prompt.querySelector('h2').textContent = phrase('Xác nhận thay đổi','Confirm change');
      prompt.querySelector('p').textContent = message;
      const cancel = prompt.querySelector('[data-confirm-cancel]'), discard = prompt.querySelector('[data-confirm-discard]');
      cancel.textContent = phrase('Giữ lại','Keep editing');
      discard.textContent = phrase('Bỏ thay đổi','Discard changes');
      const finish = answer => { prompt.close(); prompt.remove(); confirmation = null; resolve(answer); };
      cancel.onclick = () => finish(false);
      discard.onclick = () => finish(true);
      prompt.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
      confirmation = prompt; document.body.appendChild(prompt); prompt.showModal(); cancel.focus();
    });
  };
  window.merchflowCanLeaveEditor = () => {
    if (saving) { toast(phrase('Đang lưu. Vui lòng chờ kết quả.', 'Saving. Please wait for the result.')); return false; }
    return !window.merchflowHasUnsavedChanges();
  };
  window.merchflowRequestEditorClose = async afterClose => {
    if (saving) { window.merchflowCanLeaveEditor(); return false; }
    if (window.merchflowHasUnsavedChanges() && !await window.merchflowConfirm(phrase(
      'Bạn có nội dung chưa lưu. Bỏ thay đổi và rời biểu mẫu?', 'You have unsaved changes. Discard them and leave this form?'))) return false;
    nativeClose(); trackedForm = null; baseline = ''; afterClose?.(); return true;
  };
  window.merchflowTrackEditor = form => {
    trackedForm = form;
    // Quote and sheet editors finish drawing synchronously after formModal.
    queueMicrotask(() => { if (trackedForm === form) baseline = snapshot(form); });
  };
  window.merchflowSetSaving = value => { saving = value; if (trackedForm) trackedForm.inert = value; modal.setAttribute('aria-busy', String(value)); };
  window.merchflowAcceptEditor = () => { baseline = snapshot(trackedForm); saving = false; };
  modal.close = function (...args) {
    if (!window.merchflowCanLeaveEditor()) { if (!saving) window.merchflowRequestEditorClose(); return false; }
    nativeClose(...args); trackedForm = null; baseline = ''; return true;
  };
  modal.addEventListener('cancel', event => { event.preventDefault(); modal.close(); });
  window.addEventListener('beforeunload', event => {
    if (saving || window.merchflowHasUnsavedChanges()) { event.preventDefault(); event.returnValue = ''; }
  });
  window.merchflowSyncState = success => {
    if (success === true) { lastSync = new Date(); syncFailed = false; }
    if (success === false) syncFailed = true;
    const el = document.querySelector('#saveState');
    if (!el) return;
    const offline = !navigator.onLine;
    el.dataset.status = offline || syncFailed || !lastSync ? 'pending' : 'synced';
    el.textContent = offline ? phrase('Mất mạng · chưa đồng bộ','Offline · not synced') : syncFailed ?
      phrase('Chưa cập nhật được','Refresh unavailable') : lastSync ? phrase('Đã đồng bộ','Up to date') : phrase('Đang kết nối…','Connecting…');
    el.title = lastSync ? phrase('Đồng bộ gần nhất: ','Last synced: ') + lastSync.toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'vi-VN', {timeZone:'Asia/Bangkok'}) + ' · UTC+7' : '';
    const notice = document.querySelector('#connectionNotice');
    if (notice) {
      notice.hidden = !offline && !syncFailed;
      notice.textContent = offline ? phrase('Đang mất mạng. Nội dung đang nhập vẫn ở cửa sổ này; hãy kết nối lại để lưu.', 'You are offline. Your input remains in this window; reconnect to save.') : phrase('Chưa lấy được dữ liệu mới. Giữ cửa sổ đang nhập và thử làm mới khi kết nối ổn định.', 'New data is unavailable. Keep your current editor open and refresh when the connection recovers.');
    }
  };
  window.addEventListener('offline', () => window.merchflowSyncState());
  // Reconnection alone is not proof that the server has been reached.
  window.addEventListener('online', () => window.merchflowSyncState(false));
  window.addEventListener('merchflow:rendered', () => window.merchflowSyncState());
  document.addEventListener('input', event => {
    const search = event.target.closest('[data-evidence-search]');
    if (!search) return;
    const query = search.value.trim().toLocaleLowerCase();
    search.closest('.evidence-picker').querySelectorAll('.evidence-option').forEach(row => { row.hidden = !row.textContent.toLocaleLowerCase().includes(query); });
  });
  document.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-evidence-id]');
    if (!checkbox) return;
    const picker = checkbox.closest('.evidence-picker'), select = picker.querySelector('select');
    const option = Array.from(select.options).find(item => item.value === checkbox.dataset.evidenceId);
    if (!option) return;
    if (checkbox.checked && select.selectedOptions.length >= 30) {
      checkbox.checked = false; toast(phrase('Tối đa 30 nguồn tham chiếu.', 'Select up to 30 evidence sources.')); return;
    }
    option.selected = checkbox.checked;
    picker.querySelector('.evidence-count').textContent = select.selectedOptions.length + '/30';
  });
})();
