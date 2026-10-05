// Converts an API result (current schema, or older schemas still present in
// users' localStorage) into one view model consumed by both the on-page
// result view and the image export. No DOM access here.

export const SITE_HOST = 'altyapi.frudotz.com';

const UNKNOWN = new Set(['', '-', '—', 'belirsiz', 'bilinmiyor', 'n/a', 'null', 'undefined', 'adres bulunamadı.', 'yükleniyor...']);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Normalises a display value; returns null for missing/placeholder values. */
export function clean(value, maxLength = 300) {
    if (value === null || value === undefined || typeof value === 'object') return null;
    const s = String(value).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
    if (UNKNOWN.has(s.toLocaleLowerCase('tr'))) return null;
    return s.length > maxLength ? `${s.slice(0, maxLength - 1)}…` : s;
}

function typeLabel(type) {
    if (!type) return null;
    const ascii = type.replace(/[İı]/g, 'I').toUpperCase();
    if (ascii.includes('FIBER')) return 'Fiber';
    if (ascii.includes('VDSL')) return 'VDSL';
    if (ascii.includes('ADSL')) return 'ADSL';
    return type;
}

export const FIELD_LABELS = Object.freeze({
    address: 'Adres',
    maxSpeed: 'Maksimum hız',
    type: 'Altyapı türü',
    portStatus: 'Boş port',
    santralAdi: 'Santral',
    distance: 'Santral mesafesi',
    mudurlukAdi: 'Müdürlük',
    kabinTipi: 'FTTX tipi',
});

/**
 * @param {object} data   `data` from the API (or a stored lastQuery.data)
 * @param {object} meta   `meta` from the API: { source, cached, missing }
 * @param {object} opts   { bbk, queriedAt }
 */
export function toViewModel(data, meta = {}, opts = {}) {
    const d = data && typeof data === 'object' ? data : {};
    const type = typeLabel(clean(d.type, 40) || clean(d.exchange?.name, 40));
    const isFiber = type === 'Fiber';

    let portStatus = clean(d.portStatus, 10);
    if (!portStatus && d.port && typeof d.port === 'object') portStatus = d.port.status === 'available' ? 'Var' : 'Yok';
    if (portStatus && portStatus !== 'Var' && portStatus !== 'Yok') portStatus = null;

    // Product rule kept from the original UI: fiber lines are shown as 1000 Mbps.
    const maxSpeed = isFiber ? '1000 Mbps' : clean(d.maxSpeed, 40) || clean(d.port?.speedLabel, 40);
    let distance = clean(d.distance, 40);
    if (!distance && d.exchange?.distanceM) distance = clean(`${d.exchange.distanceM} Metre`, 40);

    const vm = {
        bbk: clean(d.bbk, 32) || clean(opts.bbk, 32),
        address: clean(d.address?.text, 400),
        type,
        isFiber,
        portStatus,
        maxSpeed,
        // Distance is not meaningful for fiber; the original UI hid it too.
        showDistance: !isFiber,
        distance: isFiber ? null : distance,
        santralAdi: clean(d.santralAdi, 120),
        mudurlukAdi: clean(d.mudurlukAdi, 120),
        kabinTipi: clean(d.kabinTipi, 60),
        source: meta?.source === 'backup' ? 'backup' : 'primary',
        cached: Boolean(meta?.cached),
        queriedAt: opts.queriedAt || new Date().toISOString(),
    };

    // Display order, so messages list fields the way the page shows them.
    const checked = ['address', 'maxSpeed', 'type', 'portStatus', 'santralAdi', 'distance', 'mudurlukAdi', 'kabinTipi'];
    vm.missing = checked.filter((k) => (k !== 'distance' || vm.showDistance) && !vm[k]);
    vm.partial = vm.missing.length > 0;
    return vm;
}

/** Ordered secondary fields shared by the page and the exported image. */
export function detailRows(vm) {
    const rows = [
        { key: 'santralAdi', label: FIELD_LABELS.santralAdi, value: vm.santralAdi },
        { key: 'distance', label: FIELD_LABELS.distance, value: vm.distance, hidden: !vm.showDistance },
        { key: 'mudurlukAdi', label: FIELD_LABELS.mudurlukAdi, value: vm.mudurlukAdi },
        { key: 'kabinTipi', label: FIELD_LABELS.kabinTipi, value: vm.kabinTipi },
    ];
    return rows.filter((r) => !r.hidden);
}

export function statusInfo(vm) {
    const missingLabels = vm.missing.map((k) => FIELD_LABELS[k]).filter(Boolean);
    const notes = [];
    if (vm.source === 'backup') notes.push('Birincil veri kaynağı yanıt vermediği için sonuç yedek kaynaktan alındı.');
    if (vm.partial) notes.push(`Kaynakta bulunamayan bilgiler: ${missingLabels.join(', ')}.`);
    return {
        chip: vm.partial ? { text: 'Kısmi sonuç', tone: 'warn' } : { text: 'Başarılı', tone: 'ok' },
        sourceChip: vm.source === 'backup' ? 'Yedek kaynak' : null,
        notice: notes.join(' ') || null,
        noticeTone: vm.partial ? 'warn' : 'info',
    };
}

const dateFormatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatQueriedAt(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : dateFormatter.format(d);
}

export const display = (v) => v || 'Bilinmiyor';

export function toPlainText(vm) {
    const lines = [
        `Altyapı Sorgu Sonucu — ${SITE_HOST}`,
        `BBK: ${display(vm.bbk)}`,
        `Adres: ${display(vm.address)}`,
        `Maksimum hız: ${display(vm.maxSpeed)}`,
        `Altyapı türü: ${display(vm.type)}`,
        `Boş port: ${display(vm.portStatus)}`,
        ...detailRows(vm).map((r) => `${r.label}: ${display(r.value)}`),
    ];
    if (vm.source === 'backup') lines.push('Not: Sonuç yedek veri kaynağından alındı.');
    const when = formatQueriedAt(vm.queriedAt);
    if (when) lines.push(`Sorgu zamanı: ${when}`);
    return lines.join('\n');
}
