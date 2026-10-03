// Fuzzy matching of reverse-geocoded names against the address lists
// (moved unchanged in behaviour from the original app.js). Pure functions.

export function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    // Defensive bound: names are short, but never build huge matrices.
    a = a.slice(0, 200);
    b = b.slice(0, 200);
    let prev = Array.from({ length: a.length + 1 }, (_, j) => j);
    for (let i = 1; i <= b.length; i++) {
        const cur = [i];
        for (let j = 1; j <= a.length; j++) {
            cur[j] = b[i - 1] === a[j - 1]
                ? prev[j - 1]
                : Math.min(prev[j - 1] + 1, cur[j - 1] + 1, prev[j] + 1);
        }
        prev = cur;
    }
    return prev[a.length];
}

export function normalizeStr(str) {
    if (!str) return '';
    // Strip suffixes map providers add (mahallesi, sokağı, ilçesi, …).
    return String(str).replace(/İ/g, 'I').replace(/ı/g, 'i').toLowerCase()
        .replace(/\b(mah(\.|alle|allesi)?)\b/ig, '')
        .replace(/\b(sok(\.|ak|ağı|agi|aği)?)\b/ig, '')
        .replace(/\b(sk(\.)?)\b/ig, '')
        .replace(/\b(cad(\.|de|desi)?)\b/ig, '')
        .replace(/\b(cd(\.)?)\b/ig, '')
        .replace(/\b(bulv(\.|ar|arı|ari)?)\b/ig, '')
        .replace(/\b(il[cç]es[iı])\b/ig, '')
        .replace(/\b(il[iı])\b/ig, '')
        .replace(/\b(k[oö]y[uü])\b/ig, '')
        .replace(/\b(beldes[iı])\b/ig, '')
        .replace(/\b(buca[gğ][iı])\b/ig, '')
        .replace(/[-_./]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

export function extractAlphaNumCode(str) {
    let s = (str || '').replace(/\b(no|numara|bina|blok)\b/ig, '');
    s = s.replace(/[^0-9a-zçğöşü]/g, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(/\b(\d+)\s+([a-zçğöşü])\b/g, '$1$2');
    return s.split(' ').find((t) => /\d/.test(t)) || '';
}

/**
 * Returns { match, score (0-100), minDistance } for the option whose name is
 * closest to `targetStr`. With strictNumeric, options whose street/building
 * number differs from the target's are skipped. `buildingNo` additionally
 * rewrites the target into TT's "NO :8" form; it used to be applied to
 * street names too, which made e.g. "Moda Caddesi" unable to match "MODA CAD.".
 */
export function findBestMatch(targetStr, optionsArray, strictNumeric = false, { buildingNo = false } = {}) {
    let bestMatch = null;
    let minDistance = Infinity;

    const cleanTarget = String(targetStr || '').split('_')[0].trim();
    let targetNorm = normalizeStr(cleanTarget);
    if (buildingNo && targetNorm) {
        const baseNorm = targetNorm.replace(/no/g, '').trim();
        if (baseNorm) targetNorm = `no :${baseNorm}`;
    }
    const targetCodes = extractAlphaNumCode(targetNorm);

    for (const opt of optionsArray || []) {
        const text = opt.name || '';
        const optNorm = normalizeStr(text.split('_')[0].trim());
        if (!optNorm) continue;
        if (strictNumeric) {
            const optCodes = extractAlphaNumCode(optNorm);
            if (targetCodes && optCodes && targetCodes !== optCodes) continue;
        }
        if (optNorm === targetNorm) {
            bestMatch = opt;
            minDistance = 0;
            break;
        }
        const dist = levenshtein(targetNorm, optNorm);
        if (dist < minDistance) {
            minDistance = dist;
            bestMatch = opt;
        }
    }

    const maxLength = Math.max(targetNorm.length, bestMatch ? normalizeStr((bestMatch.name || '').split('_')[0]).length : 1, 1);
    let score = bestMatch ? Math.max(0, 100 - Math.round((minDistance / maxLength) * 100)) : 0;
    if (strictNumeric && bestMatch && targetCodes) {
        const bestCodes = extractAlphaNumCode(normalizeStr(bestMatch.name || ''));
        if (bestCodes === targetCodes) score = Math.max(score, 85);
    }
    return { match: bestMatch, score, minDistance };
}
