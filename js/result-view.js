// Renders the result panel's four states (empty, loading, error, success).
// Only textContent is used for dynamic values.

import { detailRows, display, formatQueriedAt, statusInfo } from './result-model.js';
import { $ } from './ui.js';

const STATES = ['resultEmpty', 'resultLoading', 'resultError', 'resultSuccess'];
let slowTimer = null;

function show(id, state) {
    for (const s of STATES) $(s).hidden = s !== id;
    const section = $('resultsSection');
    section.setAttribute('aria-busy', String(id === 'resultLoading'));
    // Drives the state-specific accent (top rule colour) in CSS.
    section.dataset.state = state;
}

function setValue(el, value) {
    el.textContent = display(value);
    el.classList.toggle('is-missing', !value);
}

export function showLoading(label) {
    clearTimeout(slowTimer);
    $('loadingText').textContent = label;
    $('loadingSlowText').hidden = true;
    slowTimer = setTimeout(() => { $('loadingSlowText').hidden = false; }, 6000);
    show('resultLoading', 'loading');
}

const ERROR_TITLES = {
    NO_DATA: 'Kayıt bulunamadı',
    VALIDATION_ERROR: 'Geçersiz giriş',
    RATE_LIMITED: 'İstek sınırı aşıldı',
    DAILY_LIMIT: 'Günlük sorgu hakkı doldu',
    UPSTREAM_UNAVAILABLE: 'Altyapı kaynaklarına ulaşılamıyor',
    UPSTREAM_TIMEOUT: 'Kaynaklar yanıt vermedi',
    SERVICE_MISCONFIGURED: 'Servis geçici olarak kullanılamıyor',
    NETWORK: 'Bağlantı hatası',
    CLIENT_TIMEOUT: 'Yanıt gecikti',
    BOT_CHECK_FAILED: 'Güvenlik doğrulaması başarısız',
    SESSION_TIMEOUT: 'Güvenlik doğrulaması tamamlanamadı',
    UNAUTHORIZED: 'Oturum doğrulanamadı',
};

const RELOAD_CODES = new Set(['BOT_CHECK_FAILED', 'SESSION_TIMEOUT', 'UNAUTHORIZED', 'SESSION_FAILED']);

export function showError(err, { onRetry } = {}) {
    clearTimeout(slowTimer);
    const code = err?.code || 'UNKNOWN';
    $('errorTitle').textContent = ERROR_TITLES[code] || 'Sorgu tamamlanamadı';
    $('errorMessage').textContent = err?.message || 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.';
    const ref = $('errorRef');
    ref.hidden = !err?.requestId;
    ref.textContent = err?.requestId ? `Destek için referans: ${String(err.requestId).slice(0, 8)}` : '';

    const retryable = Boolean(onRetry) && (err?.retryable || ['UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'NETWORK', 'CLIENT_TIMEOUT', 'INTERNAL_ERROR'].includes(code));
    const retryBtn = $('errorRetryBtn');
    retryBtn.hidden = !retryable;
    retryBtn.onclick = retryable ? onRetry : null;
    const reloadBtn = $('errorReloadBtn');
    reloadBtn.hidden = !RELOAD_CODES.has(code);
    reloadBtn.onclick = () => window.location.reload();
    show('resultError', 'error');
}

export function showSuccess(vm) {
    clearTimeout(slowTimer);
    const status = statusInfo(vm);

    $('resBbk').textContent = display(vm.bbk);
    const time = $('resTime');
    time.dateTime = vm.queriedAt;
    time.textContent = formatQueriedAt(vm.queriedAt);
    $('resCachedNote').hidden = !vm.cached;

    const chip = $('resStatusChip');
    chip.textContent = status.chip.text;
    chip.className = `chip chip-${status.chip.tone}`;
    const sourceChip = $('resSourceChip');
    sourceChip.hidden = !status.sourceChip;
    sourceChip.textContent = status.sourceChip || '';
    sourceChip.title = status.sourceChip ? 'Birincil kaynak yanıt vermediği için yedek kaynak kullanıldı.' : '';

    setValue($('resAddress'), vm.address);
    setValue($('resSpeed'), vm.maxSpeed);
    const type = $('resType');
    setValue(type, vm.type);
    type.dataset.type = vm.type ? vm.type.toLowerCase() : '';
    const port = $('resPort');
    setValue(port, vm.portStatus);
    port.classList.toggle('port-yes', vm.portStatus === 'Var');
    port.classList.toggle('port-no', vm.portStatus === 'Yok');

    const ids = { santralAdi: 'resSantral', distance: 'resDistance', mudurlukAdi: 'resMudurluk', kabinTipi: 'resKabin' };
    for (const row of detailRows(vm)) setValue($(ids[row.key]), row.value);
    $('resDistanceRow').hidden = !vm.showDistance;

    const notice = $('resNotice');
    notice.hidden = !status.notice;
    notice.textContent = status.notice || '';
    notice.classList.toggle('is-info', status.noticeTone === 'info');

    show('resultSuccess', vm.partial ? 'partial' : 'success');
}
