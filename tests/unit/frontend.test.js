import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toViewModel, clean, detailRows, statusInfo, toPlainText } from '../../js/result-model.js';
import { findBestMatch, levenshtein, normalizeStr } from '../../js/address-match.js';
import { wrapText } from '../../js/export-image.js';

const data = {
    type: 'VDSL', portStatus: 'Var', maxSpeed: '50 Mbps', distance: '742 Metre', bbk: '123',
    santralAdi: 'MODA', mudurlukAdi: 'KADIKÖY', kabinTipi: 'FTTC', address: { text: 'CAFERAĞA MAH.' },
};

test('view model: complete primary result', () => {
    const vm = toViewModel(data, { source: 'primary' });
    assert.equal(vm.partial, false);
    assert.deepEqual(vm.missing, []);
    assert.equal(statusInfo(vm).chip.text, 'Başarılı');
    assert.equal(statusInfo(vm).notice, null);
});

test('view model: placeholders and control characters', () => {
    assert.equal(clean('Belirsiz'), null);
    assert.equal(clean(' - '), null);
    assert.equal(clean('Adres bulunamadı.'), null);
    assert.equal(clean({ x: 1 }), null);
    assert.equal(clean('a‮b\u0000c'), 'a b c');
    assert.equal(clean('x'.repeat(500), 10).length, 10);
    const vm = toViewModel({ ...data, santralAdi: 'Belirsiz', address: { text: 'Adres bulunamadı.' } }, { source: 'backup' });
    assert.deepEqual(vm.missing, ['address', 'santralAdi']);
    const s = statusInfo(vm);
    assert.equal(s.chip.text, 'Kısmi sonuç');
    assert.equal(s.sourceChip, 'Yedek kaynak');
    assert.match(s.notice, /yedek kaynaktan.*Adres, Santral\./);
});

test('view model: fiber rule and Turkish casing', () => {
    for (const type of ['Fiber', 'FİBER', 'fiber']) {
        const vm = toViewModel({ ...data, type, maxSpeed: '1 Gbps' });
        assert.equal(vm.type, 'Fiber');
        assert.equal(vm.maxSpeed, '1000 Mbps');
        assert.equal(vm.showDistance, false);
        assert.ok(!detailRows(vm).some((r) => r.key === 'distance'));
    }
});

test('view model: legacy schema and garbage input', () => {
    const vm = toViewModel({ exchange: { name: 'ADSL', distanceM: 900 }, port: { status: 'available', speedLabel: '8 Mbps' } }, {}, { bbk: '9' });
    assert.equal(vm.type, 'ADSL');
    assert.equal(vm.portStatus, 'Var');
    assert.equal(vm.maxSpeed, '8 Mbps');
    assert.equal(vm.distance, '900 Metre');
    assert.equal(vm.bbk, '9');
    const empty = toViewModel(null);
    assert.equal(empty.partial, true);
    assert.equal(toViewModel({ portStatus: '<b>x</b>' }).portStatus, null);
});

test('plain-text export', () => {
    const text = toPlainText(toViewModel(data, { source: 'backup' }, { queriedAt: '2026-10-03T19:41:00Z' }));
    assert.match(text, /^Altyapı Sorgu Sonucu — altyapi\.frudotz\.com/);
    assert.match(text, /Santral mesafesi: 742 Metre/);
    assert.match(text, /yedek veri kaynağından/);
    assert.match(text, /Sorgu zamanı: 3 Ekim 2026/);
});

test('address matching', () => {
    assert.equal(levenshtein('kitten', 'sitting'), 3);
    assert.equal(normalizeStr('Caferağa Mahallesi'), 'caferağa');
    const streets = [{ id: '1', name: 'MODA CAD.' }, { id: '2', name: 'GÜNEŞLİBAHÇE SK.' }];
    assert.equal(findBestMatch('Moda Caddesi', streets, true).match.id, '1');
    const buildings = [{ id: 'a', name: 'NO :12' }, { id: 'b', name: 'NO :14A' }];
    const b = findBestMatch('12', buildings, true, { buildingNo: true });
    assert.equal(b.match.id, 'a');
    assert.ok(b.score > 70);
    assert.equal(findBestMatch('x', [], false).score, 0);
});

test('wrapText: wraps, hard-breaks long tokens, ellipsizes, bounds work', () => {
    const ctx = { measureText: (s) => ({ width: s.length * 10 }) };
    assert.deepEqual(wrapText(ctx, 'aaa bbb ccc', 70, 3), ['aaa bbb', 'ccc']);
    const long = wrapText(ctx, 'x'.repeat(100), 50, 2);
    assert.equal(long.length, 2);
    assert.ok(long.every((l) => l.length * 10 <= 50));
    assert.ok(long[1].endsWith('…'));
    assert.deepEqual(wrapText(ctx, '', 50, 2), []);
    const t0 = Date.now();
    wrapText(ctx, 'Ğ'.repeat(1_000_000), 300, 3);
    assert.ok(Date.now() - t0 < 200);
});
