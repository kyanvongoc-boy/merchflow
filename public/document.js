'use strict';
const $ = id => document.getElementById(id);
let lang = 'vi';
try { lang = localStorage.getItem('merchflow-language') === 'en' ? 'en' : 'vi'; } catch {}
const t = (vi,en) => lang === 'vi' ? vi : en;
const id = new URLSearchParams(location.search).get('id') || '';
let doc = null, page = 0, zoom = 100;
function labels() {
  document.documentElement.lang = lang;
  $('back').textContent = t('← Thư viện','← Library');
  $('language').textContent = lang === 'vi' ? 'EN' : 'VI';
  $('download').textContent = t('↓ Tải PDF gốc','↓ Download original PDF');
  $('pageLabel').textContent = t('Trang','Page');
  $('fit').textContent = t('Vừa chiều rộng','Fit width');
  $('textLabel').textContent = t('Văn bản trích xuất của trang này','Extracted text of this page');
  $('previous').ariaLabel = t('Trang trước','Previous page');
  $('next').ariaLabel = t('Trang sau','Next page');
  $('zoomIn').ariaLabel = t('Phóng to','Zoom in');
  $('zoomOut').ariaLabel = t('Thu nhỏ','Zoom out');
  $('page').ariaLabel = t('Chọn trang','Select page');
  $('viewport').ariaLabel = t('Trang gốc, có thể cuộn','Original page, scrollable');
}
function resize() {
  $('original').style.width = zoom + '%';
  $('zoom').textContent = zoom + '%';
  $('zoomOut').disabled = zoom <= 50;
  $('zoomIn').disabled = zoom >= 300;
}
function render() {
  if (!doc) return;
  $('title').textContent = doc.name;
  document.title = doc.customer + ' · MerchFlow';
  $('page').value = String(page);
  $('total').textContent = '/ ' + doc.pages.length;
  $('previous').disabled = page === 0;
  $('next').disabled = page === doc.pages.length - 1;
  $('original').alt = t('Trang gốc','Original page') + ' ' + (page+1) + ' · ' + doc.name;
  $('original').src = '/source-pages/' + id + '-' + (page+1) + '.webp';
  $('text').textContent = doc.pages[page];
  $('viewport').scrollTop = 0;
  $('viewport').scrollLeft = 0;
  $('status').textContent = t('Đang tải trang gốc…','Loading original page…');
  resize();
}
$('original').addEventListener('load', () => {
  $('status').textContent = t('Bản xem từ PDF gốc · Phóng to để đọc chi tiết; tải PDF để lưu bản gốc.','Preview rendered from the original PDF · Zoom in for details; download the PDF for the original file.');
});
$('original').addEventListener('error', () => {
  $('status').textContent = t('Chưa tải được ảnh trang. Bạn có thể tải PDF gốc hoặc xem văn bản bên dưới.','Could not load the page image. Download the original PDF or view the extracted text below.');
});
$('previous').onclick = () => { if (page > 0) { page--; render(); } };
$('next').onclick = () => { if (doc && page < doc.pages.length - 1) { page++; render(); } };
$('page').onchange = () => { page = Number($('page').value); render(); };
$('zoomIn').onclick = () => { zoom = Math.min(300,zoom+25); resize(); };
$('zoomOut').onclick = () => { zoom = Math.max(50,zoom-25); resize(); };
$('fit').onclick = () => { zoom = 100; resize(); };
$('language').onclick = () => { lang = lang === 'vi' ? 'en' : 'vi'; try { localStorage.setItem('merchflow-language',lang); } catch {} labels(); render(); };
async function init() {
  labels();
  if (!/^[a-f0-9]{20}$/.test(id)) { $('status').textContent = t('Đường dẫn tài liệu không hợp lệ. Hãy mở lại từ thư viện.','Invalid document link. Open a document from the library.'); $('title').textContent = 'MerchFlow'; return; }
  try {
    const response = await fetch('/api/documents/' + id, {signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(response.status === 401 ? t('Phiên đã hết hạn. Quay lại thư viện để đăng nhập.','Your session expired. Return to the library to sign in.') : t('Chưa tải được tài liệu. Hãy thử lại từ thư viện.','Could not load this document. Try again from the library.'));
    doc = await response.json();
    $('page').replaceChildren(...doc.pages.map((_,i) => new Option(String(i+1),String(i))));
    $('download').href = '/sources/' + id + '.pdf';
    $('download').download = doc.name;
    $('download').hidden = $('toolbar').hidden = $('content').hidden = false;
    render();
  } catch (error) { $('title').textContent = 'MerchFlow'; $('status').textContent = error.name === 'TimeoutError' ? t('Tải tài liệu quá lâu. Hãy thử lại từ thư viện.','Loading timed out. Try again from the library.') : error.message; }
}
init();
