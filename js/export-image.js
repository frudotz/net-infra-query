// Renders the current result as a designed share card on a <canvas> and
// copies it to the clipboard (or downloads it where image clipboard writes
// are unsupported). Pure canvas drawing: user/upstream strings are only ever
// passed to fillText, so there is no HTML/SVG injection surface, and every
// string is length-capped and line-limited before measuring.

import { SITE_HOST, detailRows, display, formatQueriedAt, statusInfo } from './result-model.js';

const WIDTH = 1000;
const PAD = 56;
const SCALE = 2;
const MAX_TEXT = 400;

const C = {
    bg: '#0b0f14',
    panel: '#11161d',
    border: '#232b36',
    text: '#e6eaef',
    text2: '#b4bcc6',
    muted: '#8a94a1',
    accent: '#38bdf8',
    ok: '#3fb950',
    danger: '#f2655c',
    warn: '#d29922',
};

const SANS = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const font = (weight, size, family = SANS) => `${weight} ${size}px ${family}`;

/** Ensures Inter (incl. the latin-ext subset for Turkish) is loaded before drawing. */
async function ensureFonts() {
    if (typeof document === 'undefined' || !document.fonts?.load) return;
    const sample = 'ÇĞİÖŞÜçğıöşü Altyapı 0123456789';
    const loads = ['400 20px Inter', '500 20px Inter', '600 20px Inter', '700 20px Inter'].map((f) => document.fonts.load(f, sample).catch(() => {}));
    await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1500))]);
}

/**
 * Greedy word wrap with hard breaks for over-long tokens. At most `maxLines`
 * lines; the last line gets an ellipsis if text remains.
 */
export function wrapText(ctx, text, maxWidth, maxLines) {
    const source = String(text ?? '').slice(0, MAX_TEXT).replace(/\s+/g, ' ').trim();
    if (!source) return [];
    const words = source.split(' ');
    const lines = [];
    let line = '';
    const fits = (s) => ctx.measureText(s).width <= maxWidth;

    for (let i = 0; i < words.length; i++) {
        let word = words[i];
        const candidate = line ? `${line} ${word}` : word;
        if (fits(candidate)) {
            line = candidate;
            continue;
        }
        if (line) {
            lines.push(line);
            line = '';
            if (lines.length === maxLines) break;
        }
        // Break a single token that is wider than the line.
        while (!fits(word) && lines.length < maxLines) {
            let cut = word.length - 1;
            while (cut > 1 && !fits(word.slice(0, cut))) cut--;
            lines.push(word.slice(0, cut));
            word = word.slice(cut);
        }
        if (lines.length === maxLines) break;
        line = word;
    }
    if (line && lines.length < maxLines) lines.push(line);

    const consumed = lines.join(' ').replace(/\s+/g, '').length;
    const total = source.replace(/\s+/g, '').length;
    if (consumed < total && lines.length > 0) {
        let last = lines[lines.length - 1];
        while (last.length > 0 && !fits(`${last}…`)) last = last.slice(0, -1);
        lines[lines.length - 1] = `${last.trimEnd()}…`;
    }
    return lines;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/**
 * Lays out and (unless dryRun) paints the card. Returns the content height so
 * the canvas can be sized exactly in a first, measuring pass.
 */
function paint(ctx, vm, dryRun) {
    const inner = WIDTH - PAD * 2;
    const status = statusInfo(vm);
    let y = PAD;

    const text = (str, x, yy, { f, color, align = 'left' }) => {
        ctx.font = f;
        if (dryRun) return;
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(str, x, yy);
    };
    const rule = (yy) => {
        if (dryRun) return;
        ctx.fillStyle = C.border;
        ctx.fillRect(PAD, yy, inner, 1);
    };

    if (!dryRun) {
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, WIDTH, ctx.canvas.height / SCALE);
        ctx.fillStyle = C.accent;
        ctx.fillRect(0, 0, WIDTH, 4);
    }

    // Header: brand mark + name, site host on the right.
    if (!dryRun) {
        ctx.fillStyle = '#1c232d';
        roundRect(ctx, PAD, y, 32, 32, 6);
        ctx.fill();
        ctx.fillStyle = C.accent;
        ctx.fillRect(PAD + 8, y + 17, 3, 7);
        ctx.fillRect(PAD + 14.5, y + 13, 3, 11);
        ctx.fillRect(PAD + 21, y + 9, 3, 15);
    }
    text('Altyapı Sorgulama', PAD + 44, y + 24, { f: font(600, 22), color: C.text });
    text(SITE_HOST, WIDTH - PAD, y + 24, { f: font(500, 20), color: C.accent, align: 'right' });
    y += 32 + 28;
    rule(y);
    y += 32;

    // BBK + status chips.
    text('BBK', PAD, y + 18, { f: font(600, 15), color: C.muted });
    ctx.font = font(600, 15);
    const bbkX = PAD + ctx.measureText('BBK').width + 12;
    text(display(vm.bbk).slice(0, 32), bbkX, y + 19, { f: font(600, 22, MONO), color: C.text });

    const chips = [status.chip];
    if (status.sourceChip) chips.push({ text: status.sourceChip, tone: 'info' });
    let chipRight = WIDTH - PAD;
    for (const chip of chips.reverse()) {
        ctx.font = font(600, 14);
        const w = ctx.measureText(chip.text).width + 34;
        const x = chipRight - w;
        if (!dryRun) {
            const tone = chip.tone === 'ok' ? C.ok : chip.tone === 'warn' ? C.warn : C.text2;
            ctx.fillStyle = chip.tone === 'info' ? '#1c232d' : `${tone}24`;
            roundRect(ctx, x, y, w, 28, 5);
            ctx.fill();
            ctx.fillStyle = tone;
            ctx.beginPath();
            ctx.arc(x + 13, y + 14, 3.5, 0, Math.PI * 2);
            ctx.fill();
            text(chip.text, x + 23, y + 19, { f: font(600, 14), color: tone });
        }
        chipRight = x - 8;
    }
    y += 28 + 22;

    // Address.
    ctx.font = font(500, 26);
    const addressLines = wrapText(ctx, display(vm.address), inner, 3);
    for (const line of addressLines) {
        text(line, PAD, y + 26, { f: font(500, 26), color: vm.address ? C.text : C.muted });
        y += 36;
    }
    y += 24;
    rule(y);

    // Metrics band: speed (wide) | type | port.
    const metricTop = y + 28;
    const colW = [inner * 0.42, inner * 0.29, inner * 0.29];
    const metrics = [
        { label: 'MAKSİMUM HIZ', value: display(vm.maxSpeed), color: vm.maxSpeed ? C.accent : C.muted, size: 48 },
        { label: 'ALTYAPI TÜRÜ', value: display(vm.type), color: vm.type ? C.text : C.muted, size: 34 },
        {
            label: 'BOŞ PORT',
            value: display(vm.portStatus),
            color: vm.portStatus === 'Var' ? C.ok : vm.portStatus === 'Yok' ? C.danger : C.muted,
            size: 34,
        },
    ];
    let x = PAD;
    metrics.forEach((m, i) => {
        if (i > 0 && !dryRun) {
            ctx.fillStyle = C.border;
            ctx.fillRect(x - 24, metricTop - 4, 1, 92);
        }
        text(m.label, x, metricTop + 14, { f: font(600, 14), color: C.muted });
        ctx.font = font(700, m.size);
        const [valueLine] = wrapText(ctx, m.value, colW[i] - 40, 1);
        text(valueLine || '', x, metricTop + 14 + 14 + m.size, { f: font(700, m.size), color: m.color });
        x += colW[i];
    });
    y = metricTop + 100 + 20;
    rule(y);
    y += 8;

    // Details grid (two columns).
    const rows = detailRows(vm);
    const cellW = (inner - 40) / 2;
    for (let i = 0; i < rows.length; i += 2) {
        let rowHeight = 0;
        for (let j = 0; j < 2 && i + j < rows.length; j++) {
            const row = rows[i + j];
            const cx = PAD + j * (cellW + 40);
            text(row.label, cx, y + 34, { f: font(500, 16), color: C.muted });
            ctx.font = font(500, 22);
            const lines = wrapText(ctx, display(row.value), cellW, 2);
            lines.forEach((line, k) => text(line, cx, y + 34 + 34 + k * 30, { f: font(500, 22), color: row.value ? C.text : C.muted }));
            rowHeight = Math.max(rowHeight, 34 + 34 + (lines.length - 1) * 30 + 22);
        }
        y += rowHeight;
        rule(y);
    }

    // Notice (backup source / partial result).
    if (status.notice) {
        y += 24;
        ctx.font = font(400, 17);
        const lines = wrapText(ctx, status.notice, inner - 20, 3);
        if (!dryRun) {
            ctx.fillStyle = status.noticeTone === 'warn' ? C.warn : C.border;
            ctx.fillRect(PAD, y, 3, lines.length * 26 + 4);
        }
        lines.forEach((line, k) => text(line, PAD + 18, y + 20 + k * 26, { f: font(400, 17), color: C.text2 }));
        y += lines.length * 26 + 4;
    }

    // Footer (the details grid already ends with a rule when there is no notice).
    if (status.notice) {
        y += 32;
        rule(y);
    }
    y += 44;
    const when = formatQueriedAt(vm.queriedAt);
    text(when ? `Sorgu zamanı: ${when}` : 'Altyapı sorgu sonucu', PAD, y, { f: font(400, 17), color: C.muted });
    text(SITE_HOST, WIDTH - PAD, y, { f: font(700, 20), color: C.text, align: 'right' });
    y += PAD - 8;
    return Math.ceil(y);
}

export async function renderResultCanvas(vm, { doc = document } = {}) {
    await ensureFonts();
    const measure = doc.createElement('canvas').getContext('2d');
    const height = paint(measure, vm, true);
    const canvas = doc.createElement('canvas');
    canvas.width = WIDTH * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    paint(ctx, vm, false);
    return canvas;
}

export async function renderResultBlob(vm) {
    const canvas = await renderResultCanvas(vm);
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG oluşturulamadı'))), 'image/png');
    });
}

export function canCopyImage() {
    return Boolean(
        window.isSecureContext
        && navigator.clipboard?.write
        && typeof window.ClipboardItem === 'function'
        && (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports('image/png')),
    );
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function imageFilename(vm) {
    const safe = String(vm.bbk || 'sonuc').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 32) || 'sonuc';
    return `altyapi-${safe}.png`;
}

/**
 * Must be called directly from a click handler: Safari only allows
 * clipboard.write within the user gesture, so the (async) PNG is handed to
 * ClipboardItem as a promise instead of being awaited first.
 * Resolves to 'clipboard' or 'download'.
 */
export async function copyResultImage(vm) {
    const blobPromise = renderResultBlob(vm);
    if (canCopyImage()) {
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
            return 'clipboard';
        } catch {
            // Permission denied / unsupported in this context: fall back to download.
        }
    }
    downloadBlob(await blobPromise, imageFilename(vm));
    return 'download';
}
