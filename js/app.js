// Entry point: wires the form, tabs, result view, last-query card, export
// actions, theme toggle and service worker.

import { ApiError, fetchInfra } from './api.js';
import { createAddressForm } from './address-form.js';
import { copyResultImage } from './export-image.js';
import { createMapPicker } from './map-picker.js';
import { formatQueriedAt, toPlainText, toViewModel } from './result-model.js';
import { showError, showLoading, showSuccess } from './result-view.js';
import { $, announce, flashLabel, setButtonBusy, showToast } from './ui.js';

const BBK_RE = /^\d{1,15}$/;
const LAST_QUERY_KEY = 'lastQuery';
const BBK_MODE_IL = '7'; // The original UI sent il=7 for direct BBK lookups; kept for the generic adapter.

let currentVm = null;
let mode = 'address';
let querying = false;

// ---------- theme ----------

function initTheme() {
    const btn = $('themeToggle');
    const root = document.documentElement;
    const sync = () => btn.setAttribute('aria-label', root.classList.contains('dark') ? 'Açık temaya geç' : 'Koyu temaya geç');
    sync();
    btn.addEventListener('click', () => {
        const next = root.classList.contains('dark') ? 'light' : 'dark';
        root.classList.remove('dark', 'light');
        root.classList.add(next);
        try { localStorage.setItem('theme', next); } catch { /* ignore */ }
        sync();
    });
}

// ---------- tabs ----------

function initTabs() {
    const tabs = [$('tabAddressBtn'), $('tabBbkBtn')];
    const panels = { tabAddressBtn: $('panelAddress'), tabBbkBtn: $('panelBbk') };
    const select = (tab, focus) => {
        for (const t of tabs) {
            const active = t === tab;
            t.setAttribute('aria-selected', String(active));
            t.tabIndex = active ? 0 : -1;
            panels[t.id].hidden = !active;
        }
        mode = tab.id === 'tabBbkBtn' ? 'bbk' : 'address';
        if (focus) tab.focus();
    };
    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => select(tab, false));
        tab.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                select(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true);
            } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                select(tabs[e.key === 'Home' ? 0 : tabs.length - 1], true);
            }
        });
    });
}

// ---------- last query (localStorage format kept from the original UI) ----------

function readLastQuery() {
    try {
        const saved = JSON.parse(localStorage.getItem(LAST_QUERY_KEY) || 'null');
        return saved && typeof saved === 'object' && saved.data ? saved : null;
    } catch {
        return null;
    }
}

function saveLastQuery(bbk, il, body, isRefresh) {
    const today = new Date().toISOString().slice(0, 10);
    const existing = readLastQuery() || {};
    const record = {
        date: today,
        bbk,
        il,
        data: body.data,
        meta: { source: body.meta?.source, cached: body.meta?.cached },
        queriedAt: new Date().toISOString(),
        hasRefreshedToday: isRefresh ? true : Boolean(existing.hasRefreshedToday && existing.bbk === bbk && existing.date === today),
    };
    try { localStorage.setItem(LAST_QUERY_KEY, JSON.stringify(record)); } catch { /* storage full/blocked */ }
}

function lastQueryVm(saved) {
    return toViewModel(saved.data, saved.meta || {}, { bbk: saved.bbk, queriedAt: saved.queriedAt || `${saved.date}T12:00:00` });
}

function renderLastQuery() {
    const section = $('lastQuerySection');
    const saved = readLastQuery();
    if (!saved) {
        section.hidden = true;
        return;
    }
    const vm = lastQueryVm(saved);
    $('lastQueryAddressText').textContent = vm.address || `BBK ${vm.bbk || '—'}`;
    $('lastQuerySpeed').textContent = `Tür: ${vm.type || '—'}`;
    $('lastQueryFiber').textContent = `Hız: ${vm.maxSpeed || '—'}`;
    $('lastQueryDate').textContent = saved.queriedAt ? formatQueriedAt(saved.queriedAt) : saved.date || '';
    const btn = $('refreshLastQueryBtn');
    const today = new Date().toISOString().slice(0, 10);
    const locked = saved.date === today && saved.hasRefreshedToday;
    btn.disabled = locked;
    btn.title = locked ? 'Günde yalnızca bir kez güncelleyebilirsiniz.' : 'Sonucu yeniden sorgula';
    section.hidden = false;
}

// ---------- query ----------

async function runQuery(bbk, il, { isRefresh = false } = {}) {
    if (querying) return;
    querying = true;
    const submitBtn = $('submitBtn');
    setButtonBusy(submitBtn, true, 'Sorgulanıyor…');
    showLoading(`BBK ${bbk} sorgulanıyor…`);
    announce('Sorgulanıyor');
    if (window.matchMedia('(max-width: 920px)').matches) $('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
        const body = await fetchInfra(bbk, il);
        currentVm = toViewModel(body.data, body.meta, { bbk });
        showSuccess(currentVm);
        saveLastQuery(bbk, il, body, isRefresh);
        renderLastQuery();
        announce(`Sonuç hazır: ${currentVm.type || 'altyapı türü bilinmiyor'}, ${currentVm.maxSpeed || 'hız bilinmiyor'}`);
    } catch (err) {
        const apiErr = err instanceof ApiError ? err : new ApiError('Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', { code: 'UNKNOWN' });
        if (!(err instanceof ApiError)) console.error(err);
        showError(apiErr, { onRetry: () => runQuery(bbk, il, { isRefresh }) });
        announce(apiErr.message);
    } finally {
        querying = false;
        setButtonBusy(submitBtn, false);
    }
}

function setBbkError(message) {
    const input = $('bbkInput');
    const msg = $('bbk-msg');
    msg.textContent = message || '';
    msg.classList.toggle('is-error', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
}

function initForm(addressForm) {
    const input = $('bbkInput');
    input.addEventListener('input', () => {
        // Allow pasted numbers with spaces; keep only digits.
        const digits = input.value.replace(/\D+/g, '');
        if (digits !== input.value) input.value = digits;
        setBbkError('');
    });

    $('infrastructureForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (mode === 'bbk') {
            const bbk = input.value.trim();
            if (!bbk) {
                setBbkError('BBK numarası girin.');
                input.focus();
                return;
            }
            if (!BBK_RE.test(bbk)) {
                setBbkError('BBK numarası yalnızca rakamlardan oluşmalı (en fazla 15 hane).');
                input.focus();
                return;
            }
            runQuery(bbk, BBK_MODE_IL);
            return;
        }
        const missing = addressForm.firstIncomplete();
        if (missing) {
            if (missing.select.disabled) showToast('Adres adımlarını sırayla tamamlayın.', 'warning');
            missing.select.focus();
            return;
        }
        runQuery(addressForm.value('apartment'), addressForm.value('province'));
    });
}

// ---------- export ----------

function initExport() {
    const imageBtn = $('copyImageBtn');
    imageBtn.addEventListener('click', async () => {
        if (!currentVm || imageBtn.disabled) return;
        setButtonBusy(imageBtn, true);
        try {
            // Called synchronously within the click so Safari permits the clipboard write.
            const method = await copyResultImage(currentVm);
            setButtonBusy(imageBtn, false);
            if (method === 'clipboard') {
                flashLabel(imageBtn, 'Kopyalandı');
                showToast('Sonuç görseli panoya kopyalandı.', 'success');
            } else {
                flashLabel(imageBtn, 'İndirildi');
                showToast('Tarayıcınız görsel kopyalamayı desteklemediği için görsel indirildi.', 'info');
            }
        } catch (err) {
            console.error(err);
            setButtonBusy(imageBtn, false);
            showToast('Görsel oluşturulamadı. Lütfen tekrar deneyin.', 'error');
        }
    });

    const textBtn = $('copyTextBtn');
    textBtn.addEventListener('click', async () => {
        if (!currentVm) return;
        try {
            await navigator.clipboard.writeText(toPlainText(currentVm));
            flashLabel(textBtn, 'Kopyalandı');
            showToast('Sonuç metni panoya kopyalandı.', 'success');
        } catch {
            showToast('Metin kopyalanamadı. Tarayıcınız pano erişimine izin vermiyor olabilir.', 'error');
        }
    });
}

// ---------- boot ----------

function initLastQuery() {
    renderLastQuery();
    $('lastQueryCard').addEventListener('click', () => {
        const saved = readLastQuery();
        if (!saved) return;
        currentVm = lastQueryVm(saved);
        showSuccess(currentVm);
        $('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('refreshLastQueryBtn').addEventListener('click', () => {
        const saved = readLastQuery();
        if (saved?.bbk && saved?.il) runQuery(String(saved.bbk), String(saved.il), { isRefresh: true });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    $('year').textContent = String(new Date().getFullYear());
    initTheme();
    initTabs();
    const addressForm = createAddressForm();
    initForm(addressForm);
    initExport();
    initLastQuery();
    createMapPicker(addressForm);

    // The request waits for the Turnstile-backed session; on failure the
    // province field shows the reason with a retry action.
    addressForm.load(0).catch(() => {});
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ });
    });
}
